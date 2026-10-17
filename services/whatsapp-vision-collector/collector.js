import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  extractMessageContent,
  normalizeMessageContent,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import http from 'node:http';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import 'dotenv/config';
import { parseListingWithVision, looksLikeSalePost, stripPriceFromText, hasPriceInText, transcribeVideoAudio } from './parser.js';
import { uploadWhatsAppMedia } from './cloudinary.js';
import { BuySellListingsApi } from './buysell-api.js';
import { sendSellerCommandResult, sendSellerConfirmation, sendSellerBatchConfirmation } from './notifier.js';
import { KeyedTaskQueue } from './queue.js';

const api = new BuySellListingsApi();
const targetGroups = new Set();
const reportedUnapprovedGroups = new Set();
const groupRefreshMs = 60_000;
let lastGroupRefreshAt = 0;
let groupRefreshPromise = null;

// Built-in list of approved groups
const defaultKnownGroups = [
  '120363405967163832@g.us',
  '2348115894343-1610476263@g.us',
  '120363423548052642@g.us',
  '120363420805394892@g.us',
  '120363418168443320@g.us',
  '120363426664187889@g.us',
  '120363409064832008@g.us',
  '120363405923643530@g.us',
  '120363176089818281@g.us',
  '120363272312108397@g.us',
  '120363422514509383@g.us',
  '120363304586013963@g.us',
  '120363425601990856@g.us',
  '120363408122221974@g.us',
];

const envTargetGroups = (process.env.WHATSAPP_TARGET_GROUPS || '')
  .split(',')
  .map(g => g.trim())
  .filter(g => g.endsWith('@g.us'));

const monitorAllGroups = String(process.env.WHATSAPP_MONITOR_ALL_GROUPS || 'true').toLowerCase() === 'true';
const mediaIntakeConcurrency = Math.max(1, Math.min(Number(process.env.WHATSAPP_MEDIA_INTAKE_CONCURRENCY || 2), 4));
const stagingConcurrency = Math.max(1, Math.min(Number(process.env.WHATSAPP_STAGING_CONCURRENCY || 2), 4));
const listingWorkerConcurrency = Math.max(1, Math.min(Number(process.env.WHATSAPP_LISTING_WORKER_CONCURRENCY || 1), 3));
const queuePollMs = Math.max(1_000, Number(process.env.WHATSAPP_QUEUE_POLL_MS || 3_000));
const priceFollowUpWindowMs = Math.max(60_000, Number(process.env.WHATSAPP_PRICE_FOLLOWUP_WINDOW_MS || 10 * 60_000));
const queueWorkerId = `vision-${randomBytes(10).toString('hex')}`;

const mediaIntakeQueue = new KeyedTaskQueue({
  name: 'whatsapp-media-intake',
  concurrency: mediaIntakeConcurrency,
  onError: (error, key) => console.error(`[Vision Intake] ${key}:`, error?.message || error),
});
const listingStagingQueue = new KeyedTaskQueue({
  name: 'whatsapp-listing-staging',
  concurrency: stagingConcurrency,
  onError: (error, key) => console.error(`[Vision Staging] ${key}:`, error?.message || error),
});
let listingWorkersActive = 0;
let listingClaimInFlight = false;
let listingQueuePollTimer = null;
let whatsappConnected = false;

// Keep retry counters across a socket reconnect. Baileys creates this cache per
// socket by default, which can make a transient reconnect retry the same
// encrypted message from scratch.
const messageRetryCounterEntries = new Map();
const messageRetryCounterCache = {
  get(key) {
    const entry = messageRetryCounterEntries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      messageRetryCounterEntries.delete(key);
      return undefined;
    }
    return entry.value;
  },
  set(key, value) {
    messageRetryCounterEntries.set(key, {
      value,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    if (messageRetryCounterEntries.size > 1_000) {
      messageRetryCounterEntries.delete(messageRetryCounterEntries.keys().next().value);
    }
  },
  del(key) {
    messageRetryCounterEntries.delete(key);
  },
  flushAll() {
    messageRetryCounterEntries.clear();
  },
};

let activeSocket = null;
let reconnectTimer = null;
let collectorIsStarting = false;
let warnedAboutSessionStorage = false;

// libsignal writes complete session objects (including private key material) to
// the process console when it recovers a stale session. Baileys' pino logger
// cannot control those direct console calls, so redact only those known events.
function installSignalLogRedaction() {
  const sensitiveSignalEvent = /^(?:Session error:|Closing session:|Removing old closed session:|Session already closed|Failed to decrypt message with any known session)/i;
  const recoveredSignalEvent = /^Decrypted message with closed session\.?$/i;
  let lastStaleNoticeAt = 0;
  let throttledStaleCount = 0;

  for (const method of ['error', 'warn', 'info']) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      const message = typeof args[0] === 'string' ? args[0] : '';
      if (sensitiveSignalEvent.test(message)) {
        throttledStaleCount++;
        const now = Date.now();
        if (now - lastStaleNoticeAt > 30_000) {
          lastStaleNoticeAt = now;
          const countInfo = throttledStaleCount > 1 ? ` (${throttledStaleCount} events throttled)` : '';
          throttledStaleCount = 0;
          original(`[WhatsApp Signal] Stale or desynced session detected for incoming message(s); sessions re-negotiating in background (details redacted${countInfo}).`);
        }
        return;
      }
      if (recoveredSignalEvent.test(message)) {
        original('[WhatsApp Signal] Recovered a message with a closed session.');
        return;
      }
      original(...args);
    };
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startVisionCollector().catch(error => {
      console.error('[Bot 2] WhatsApp Vision collector failed to reconnect:', error?.message || error);
    });
  }, 3_000);
}

installSignalLogRedaction();

// In-memory message store to satisfy Baileys retry requests and avoid Signal session Bad MAC desync
const messageStore = new Map();
function saveMessage(message) {
  const id = message?.key?.id;
  if (!id) return;
  messageStore.set(id, message);
  if (messageStore.size > 500) {
    const oldestKey = messageStore.keys().next().value;
    messageStore.delete(oldestKey);
  }
}

// Multi-message buffering for photos and follow-up prices / descriptions
const pendingBundles = new Map();
const recentUncaptionedMedia = new Map();
const recentPendingTexts = new Map();
const bundleWindowMs = 4_000;

async function refreshTargetGroups(force = false) {
  const now = Date.now();
  if (!force && now - lastGroupRefreshAt < groupRefreshMs) return targetGroups;
  if (groupRefreshPromise) return groupRefreshPromise;

  lastGroupRefreshAt = now;
  groupRefreshPromise = api.listTargetGroups()
    .then((result) => {
      const groups = Array.isArray(result?.groups) ? result.groups : [];
      targetGroups.clear();
      groups.forEach((groupJid) => {
        const normalized = String(groupJid || '').trim();
        if (normalized) targetGroups.add(normalized);
      });
      defaultKnownGroups.forEach(g => targetGroups.add(g));
      envTargetGroups.forEach(g => targetGroups.add(g));

      console.info(`[Vision Groups] Monitoring ${targetGroups.size} WhatsApp group${targetGroups.size === 1 ? '' : 's'}.${monitorAllGroups ? ' (Auto-monitoring ALL groups)' : ''}`);
      return targetGroups;
    })
    .catch((err) => {
      console.warn('[Vision Groups] Could not load groups from server, using local list:', err?.message || err);
      defaultKnownGroups.forEach(g => targetGroups.add(g));
      envTargetGroups.forEach(g => targetGroups.add(g));
      return targetGroups;
    })
    .finally(() => {
      groupRefreshPromise = null;
    });
  return groupRefreshPromise;
}

function unwrapMessage(message) {
  let content = message?.message;
  if (!content) return {};
  try {
    content = normalizeMessageContent(content) || content;
    content = extractMessageContent(content) || content;
  } catch {}
  return content || {};
}

function messageText(message) {
  const content = unwrapMessage(message);
  return String(
    content.conversation
    || content.extendedTextMessage?.text
    || content.imageMessage?.caption
    || content.videoMessage?.caption
    || content.documentMessage?.caption
    || '',
  ).trim();
}

function mediaDetails(message) {
  const content = unwrapMessage(message);
  if (content.imageMessage) return { kind: 'image', media: content.imageMessage };
  if (content.videoMessage) {
    const preview = content.videoMessage.jpegThumbnail;
    return {
      kind: 'video',
      media: content.videoMessage,
      previewBuffer: Buffer.isBuffer(preview) ? preview : preview ? Buffer.from(preview) : null,
    };
  }
  return null;
}

function sourceId(groupJid, senderJid, messageIds, index = 0) {
  const identifiers = [...new Set((messageIds || []).filter(Boolean))].sort().join('|');
  const digest = createHash('sha256').update(`${groupJid}|${senderJid}|${identifiers}`).digest('hex');
  return index > 0 ? `wa_vis_${digest}_${index}` : `wa_vis_${digest}`;
}

function rawPhone(senderJid) {
  const number = String(senderJid || '').split('@')[0].replace(/\D/g, '');
  return number || null;
}

async function processListing(bundle, sock) {
  const hasVisualMedia = Array.isArray(bundle?.media) && bundle.media.some(m => (m?.kind === 'image' || m?.kind === 'video' || m?.type === 'image' || m?.type === 'video') && (m?.buffer || m?.url || m?.vision_urls?.length));
  if (!bundle || (!bundle.text && !hasVisualMedia)) return { state: 'completed', message: 'Empty bundle skipped.', itemCount: 0 };
  if (!looksLikeSalePost(bundle.text, hasVisualMedia)) return { state: 'completed', message: 'Not a sale post.', itemCount: 0 };

  console.info(`[Vision Analysis] Scanning post from ${bundle.senderJid} (media: ${bundle.media?.length || 0}, text: "${(bundle.text || '').slice(0, 50).replace(/\n/g, ' ')}")...`);

  const parsed = await parseListingWithVision({
    text: bundle.text,
    media: bundle.media,
    audioTranscript: bundle.audioTranscript,
  });

  if (!parsed?.is_commercial_listing) {
    console.info(`[Skipped] ${bundle.senderJid}: Vision AI determined this is not a commercial sale post.`);
    return { state: 'completed', message: 'Vision determined this is not a commercial sale post.', itemCount: 0 };
  }

  // Extract all valid items parsed from this post
  const rawItems = Array.isArray(parsed.items) && parsed.items.length > 0
    ? parsed.items
    : (parsed.title && parsed.price ? [parsed] : []);

  const validItems = rawItems.filter(item => Number.isFinite(Number(item?.price)) && Number(item.price) > 0);

  if (validItems.length === 0) {
    console.info(`[Needs price] ${bundle.senderJid}: Product detected, but no fixed price was found.`);
    return { state: 'needs_price', message: 'A product was detected but no fixed price was found.', itemCount: rawItems.length };
  }

  console.info(`[Vision Found] Detected ${validItems.length} product(s) from ${bundle.senderJid}`);

  // Media has already been saved before this durable job was enqueued. This
  // keeps retries independent of WhatsApp's expiring media download links.
  const uploadedMedia = (bundle.media || []).filter(item => item?.url && item?.type);
  const createdListings = [];
  const importErrors = [];

  // Ingest each identified product separately
  for (let i = 0; i < validItems.length; i++) {
    const item = validItems[i];
    const itemSourceId = bundle.sourceKey
      ? (i > 0 ? `${bundle.sourceKey}_${i}` : bundle.sourceKey)
      : sourceId(bundle.groupJid, bundle.senderJid, bundle.messageIds, i);

    // Ensure title and description never contain the price
    const finalTitle = stripPriceFromText(item.title) || 'Marketplace Item';
    const finalDescription = stripPriceFromText(item.description) || finalTitle;

    // Map media: if multiple products and multiple images, assign respective image; otherwise all media
    let itemMedia = uploadedMedia;
    if (validItems.length > 1 && uploadedMedia.length > 1) {
      const targetIdx = Number.isInteger(item.image_index) && item.image_index >= 0 && item.image_index < uploadedMedia.length
        ? item.image_index
        : (i < uploadedMedia.length ? i : 0);
      itemMedia = [uploadedMedia[targetIdx]].filter(Boolean);
    }

    const manageToken = randomBytes(32).toString('base64url');

    try {
      const listing = await api.ingest({
        source_message_id: itemSourceId,
        group_jid: bundle.groupJid,
        sender_jid: bundle.senderJid,
        sender_phone: parsed.seller_phone || rawPhone(bundle.senderJid),
        manage_token: manageToken,
        title: finalTitle,
        description: finalDescription,
        price: Number(item.price),
        category: item.category,
        condition: item.condition,
        brand: item.brand,
        location: item.location || parsed.location,
        specs: item.specs,
        negotiable: false,
        media: itemMedia,
        seller_id: process.env.WHATSAPP_LISTINGS_SELLER_ID || 'e525b6d9-4f81-4522-822d-119151671dba',
      });

      if (!listing?.created) {
        console.info(`[Deduplicated] ${itemSourceId}`);
        continue;
      }

      console.info(`[Vision Imported] Product #${i + 1}/${validItems.length} (${listing.product_id}): ${listing.product?.name || finalTitle} (₦${Number(item.price).toLocaleString()})`);
      createdListings.push({ listing, manageToken, item, finalTitle });

      // Pacing delay between ingesting each product to avoid DB/rate-limit spikes
      if (i < validItems.length - 1) {
        await new Promise(r => setTimeout(r, 600));
      }
    } catch (error) {
      console.error(`[Vision Product import failed] ${bundle.senderJid} (${finalTitle}):`, error?.message || error);
      importErrors.push(error);
    }
  }

  if (importErrors.length > 0) {
    throw new Error(`${importErrors.length} product import${importErrors.length === 1 ? '' : 's'} failed.`);
  }

  // Notify seller of imported listing(s)
  if (createdListings.length > 0 && sock) {
    await sendSellerBatchConfirmation(sock, {
      senderJid: bundle.senderJid,
      listings: createdListings,
      publicSiteUrl: process.env.PUBLIC_SITE_URL,
    });
  }
  return { state: 'completed', message: 'Listing imported.', itemCount: validItems.length };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function bundleSourceKey(bundle) {
  return bundle.sourceKey || sourceId(bundle.groupJid, bundle.senderJid, bundle.messageIds, 0);
}

async function retryOperation(action, label, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const pause = Math.min(15_000, 750 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 300));
        console.warn(`[Retry] ${label} attempt ${attempt}/${attempts} failed; retrying in ${pause}ms.`);
        await delay(pause);
      }
    }
  }
  throw lastError || new Error(`${label} failed.`);
}

async function stageBundleMedia(bundle) {
  const sourceKey = bundleSourceKey(bundle);
  const uploadedMedia = [];
  const transcripts = [];
  for (let index = 0; index < (bundle.media || []).length; index += 1) {
    const item = bundle.media[index];
    if (!Buffer.isBuffer(item?.buffer) || item.buffer.length === 0) {
      throw new Error(`Media ${index + 1} was empty before staging.`);
    }
    if (item.kind === 'video') {
      const transcript = await transcribeVideoAudio({ buffer: item.buffer, mimeType: item.mimeType });
      if (transcript) transcripts.push(transcript);
    }
    const upload = await retryOperation(
      () => uploadWhatsAppMedia({
        buffer: item.buffer,
        kind: item.kind,
        mimeType: item.mimeType,
        sourceId: sourceKey,
        index,
      }),
      `Cloudinary media ${index + 1}`,
    );
    uploadedMedia.push(upload);
  }
  return { uploadedMedia, audioTranscript: transcripts.join('\n\n') };
}

function queueBundleForStaging(bundle) {
  const key = `${bundle.groupJid}:${bundle.senderJid}`;
  void listingStagingQueue.enqueue(key, async () => {
    const sourceKey = bundleSourceKey(bundle);
    const { uploadedMedia, audioTranscript } = await stageBundleMedia(bundle);
    const queued = await api.queueListing({
      dedupe_key: sourceKey,
      group_jid: bundle.groupJid,
      sender_jid: bundle.senderJid,
      sender_phone: rawPhone(bundle.senderJid),
      message_ids: [...new Set(bundle.messageIds || [])],
      payload: {
        text: bundle.text || '',
        audio_transcript: audioTranscript,
        media: uploadedMedia,
      },
    });
    console.info(`[Vision Queue] ${queued?.updated ? 'Updated' : 'Queued'} ${sourceKey} (${uploadedMedia.length} media file${uploadedMedia.length === 1 ? '' : 's'}).`);
    scheduleListingJobPump();
  }).catch(error => {
    const attempt = Number(bundle.stagingAttempts || 0) + 1;
    if (attempt < 5) {
      const pause = Math.min(60_000, 2_000 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 500));
      console.warn(`[Vision Staging] ${bundle.senderJid} failed; retrying staged upload in ${Math.ceil(pause / 1000)}s.`);
      setTimeout(() => queueBundleForStaging({ ...bundle, stagingAttempts: attempt }), pause);
      return;
    }
    console.error(`[Vision Staging] ${bundle.senderJid} failed after ${attempt} attempts:`, error?.message || error);
  });
}

function listingRetryDelaySeconds(attempt) {
  const exponential = Math.min(3_600, 30 * (2 ** Math.max(0, attempt - 1)));
  return exponential + Math.floor(Math.random() * 15);
}

async function processClaimedListingJob(job) {
  const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {};
  const media = Array.isArray(payload.media) ? payload.media : [];
  const bundle = {
    groupJid: job.group_jid,
    senderJid: job.sender_jid,
    messageIds: Array.isArray(job.message_ids) ? job.message_ids : [],
    sourceKey: job.dedupe_key,
    text: String(payload.text || ''),
    audioTranscript: String(payload.audio_transcript || ''),
    media,
  };

  try {
    const outcome = await processListing(bundle, activeSocket);
    await api.finishListingJob({
      jobId: job.id,
      lockToken: job.lock_token,
      state: outcome?.state === 'needs_price' ? 'needs_price' : 'completed',
      result: { message: outcome?.message || 'Listing handled.', item_count: outcome?.itemCount || 0 },
    });
  } catch (error) {
    const attempts = Number(job.attempts || 1);
    const maxAttempts = Number(job.max_attempts || 5);
    const terminal = attempts >= maxAttempts;
    await api.finishListingJob({
      jobId: job.id,
      lockToken: job.lock_token,
      state: terminal ? 'failed' : 'retry',
      error: error?.message || String(error),
      retryInSeconds: listingRetryDelaySeconds(attempts),
      result: { message: terminal ? 'Worker retry limit reached.' : 'Worker failed; retry scheduled.' },
    }).catch(finishError => {
      console.warn(`[Vision Queue] Could not mark job ${job?.id || ''} as ${terminal ? 'failed' : 'retry'}:`, finishError?.message || finishError);
    });
    console.error(`[Vision Queue] Job ${job?.id || ''} failed:`, error?.message || error);
  }
}

async function pumpListingJobs() {
  if (!whatsappConnected || !activeSocket || listingClaimInFlight) return;
  listingClaimInFlight = true;
  try {
    while (listingWorkersActive < listingWorkerConcurrency) {
      const claimed = await api.claimListingJobs({ workerId: queueWorkerId, limit: 1, leaseSeconds: 900 });
      const job = Array.isArray(claimed?.jobs) ? claimed.jobs[0] : null;
      if (!job) break;
      listingWorkersActive += 1;
      void processClaimedListingJob(job).finally(() => {
        listingWorkersActive -= 1;
        scheduleListingJobPump();
      });
    }
  } catch (error) {
    console.warn('[Vision Queue] Could not claim listing jobs:', error?.message || error);
  } finally {
    listingClaimInFlight = false;
  }
}

function scheduleListingJobPump() {
  void pumpListingJobs();
}

function startListingQueuePolling() {
  if (listingQueuePollTimer) return;
  listingQueuePollTimer = setInterval(scheduleListingJobPump, queuePollMs);
  scheduleListingJobPump();
}

function recentCandidates(key) {
  return recentUncaptionedMedia.get(key) || [];
}

function retainUncaptionedCandidate(key, bundle) {
  const candidate = {
    media: [...bundle.media],
    messageIds: [...bundle.messageIds],
    sourceKey: bundleSourceKey(bundle),
    expiresTimer: null,
  };
  const candidates = recentCandidates(key);
  candidates.push(candidate);
  recentUncaptionedMedia.set(key, candidates);
  candidate.expiresTimer = setTimeout(() => {
    const current = recentCandidates(key);
    const remaining = current.filter(entry => entry !== candidate);
    if (remaining.length) recentUncaptionedMedia.set(key, remaining);
    else recentUncaptionedMedia.delete(key);
  }, priceFollowUpWindowMs);
  return candidate;
}

function takeLatestUncaptionedCandidate(key) {
  const candidates = recentCandidates(key);
  const candidate = candidates.pop() || null;
  if (candidates.length) recentUncaptionedMedia.set(key, candidates);
  else recentUncaptionedMedia.delete(key);
  if (candidate?.expiresTimer) clearTimeout(candidate.expiresTimer);
  return candidate;
}

function retainPendingTextCandidate(key, bundle) {
  const candidate = {
    bundle: { ...bundle, texts: [...bundle.texts], messageIds: [...bundle.messageIds] },
    expiresTimer: null,
  };
  recentPendingTexts.set(key, candidate);
  candidate.expiresTimer = setTimeout(() => {
    if (recentPendingTexts.get(key) === candidate) {
      recentPendingTexts.delete(key);
      console.info(`[Vision Queue] Staging text-only listing from ${bundle.senderJid} (no media sent within 30s)...`);
      queueBundleForStaging({
        ...bundle,
        text: bundle.texts.join('\n').trim(),
        sourceKey: bundleSourceKey(bundle),
      });
    }
  }, 30_000);
  return candidate;
}

function takePendingTextCandidate(key) {
  const candidate = recentPendingTexts.get(key);
  if (candidate) {
    recentPendingTexts.delete(key);
    if (candidate.expiresTimer) clearTimeout(candidate.expiresTimer);
    return candidate.bundle;
  }
  return null;
}

function flushBundle(bundle) {
  const key = `${bundle.groupJid}:${bundle.senderJid}`;
  const combinedText = bundle.texts.join('\n').trim();

  // Case 1: Photos/videos posted without text -> wait 45s for seller description/price follow-up
  if (!combinedText) {
    if (bundle.media.length > 0) {
      console.info(`[Vision Buffer] ${bundle.senderJid} posted ${bundle.media.length} media file(s) without text. Waiting 45s for follow-up description/price...`);
      const candidate = retainUncaptionedCandidate(key, bundle);
      setTimeout(() => {
        // A price or description already consumed this album into a new bundle.
        if (!recentCandidates(key).includes(candidate)) return;
        console.info(`[Vision Scan] Queueing media from ${bundle.senderJid} for visual price and product analysis...`);
        queueBundleForStaging({
          ...bundle,
          text: '',
          sourceKey: bundleSourceKey(bundle),
        });
      }, 45_000);
    }
    return;
  }

  // Case 2: Text posted without media -> wait up to 30s for seller to attach photos/videos
  if (bundle.media.length === 0) {
    console.info(`[Vision Buffer] ${bundle.senderJid} posted listing text without media. Waiting 30s for matching photos/video...`);
    retainPendingTextCandidate(key, bundle);
    return;
  }

  // Case 3: Both media and text are present -> queue immediately
  queueBundleForStaging({
    ...bundle,
    text: combinedText,
    sourceKey: bundleSourceKey(bundle),
  });
}

function queueListingItem({ groupJid, senderJid, messageId, details, text }) {
  const key = `${groupJid}:${senderJid}`;
  const cleanText = String(text || '').trim();
  let bundle = pendingBundles.get(key);
  const latestCandidate = recentCandidates(key).at(-1);
  const mediaContext = Boolean(details || bundle?.media.length || latestCandidate?.media.length);
  const msgHasPrice = hasPriceInText(cleanText, { mediaContext });

  // If an existing bundle already has a price and the next message introduces
  // another price, treat it as a new listing without blocking its ingestion.
  const bundleHasPrice = bundle && bundle.texts.some(entry => hasPriceInText(entry, { mediaContext: Boolean(bundle.media.length) }));
  if (bundle && bundleHasPrice && msgHasPrice) {
    clearTimeout(bundle.timer);
    pendingBundles.delete(key);
    flushBundle(bundle);
    bundle = null;
  }

  if (!bundle) {
    bundle = {
      groupJid,
      senderJid,
      texts: [],
      media: [],
      messageIds: [],
      sourceKey: null,
      timer: null,
    };
    pendingBundles.set(key, bundle);
  }

  // If this message brings media, merge any recently pending text from this seller!
  if (details) {
    const pendingText = takePendingTextCandidate(key);
    if (pendingText) {
      for (const t of pendingText.texts) {
        if (!bundle.texts.includes(t)) bundle.texts.push(t);
      }
      for (const mId of pendingText.messageIds) {
        if (!bundle.messageIds.includes(mId)) bundle.messageIds.push(mId);
      }
      if (!bundle.sourceKey && pendingText.sourceKey) bundle.sourceKey = pendingText.sourceKey;
    }
  }

  // If this message brings text, merge any uncaptioned media album from this seller!
  if (cleanText && latestCandidate) {
    const cached = takeLatestUncaptionedCandidate(key);
    if (cached) {
      bundle.media.push(...cached.media);
      bundle.messageIds.push(...cached.messageIds);
      bundle.sourceKey = cached.sourceKey;
    }
  }

  if (messageId && !bundle.messageIds.includes(messageId)) bundle.messageIds.push(messageId);
  if (details) {
    bundle.media.push(details);
    if (!bundle.sourceKey && messageId) bundle.sourceKey = sourceId(groupJid, senderJid, [messageId], 0);
  }
  if (cleanText && !bundle.texts.includes(cleanText)) bundle.texts.push(cleanText);

  if (bundle.timer) clearTimeout(bundle.timer);
  const hasBoth = bundle.media.length > 0 && bundle.texts.length > 0;
  const debounceMs = (hasBoth && msgHasPrice) ? 2_500 : bundleWindowMs;
  bundle.timer = setTimeout(() => {
    pendingBundles.delete(key);
    flushBundle(bundle);
  }, debounceMs);
}

async function handleSellerCommand(sock, remoteJid, command) {
  try {
    const result = await api.sellerCommand({ senderJid: remoteJid, command });
    await sendSellerCommandResult(sock, remoteJid, command, result);
  } catch (error) {
    console.error('[Seller command]', error?.message || error);
    await sock.sendMessage(remoteJid, { text: 'I could not update that listing right now. Please try again shortly.' }).catch(() => {});
  }
}

async function downloadIncomingMedia(message) {
  return retryOperation(async () => {
    try {
      return await downloadMediaMessage({ message: unwrapMessage(message) }, 'buffer', {}, { logger: pino({ level: 'silent' }) });
    } catch {
      return downloadMediaMessage(message, 'buffer', {}, { logger: pino({ level: 'silent' }) });
    }
  }, 'WhatsApp media download');
}

async function processQueuedIncomingMessage({ sock, message, remoteJid, senderJid, details, text, intakeAttempts = 0 }) {
  try {
    await refreshTargetGroups();
  } catch (error) {
    console.error('[Vision Group config]', error?.message || error);
    return;
  }

  if (!monitorAllGroups && !targetGroups.has(remoteJid)) {
    if (!reportedUnapprovedGroups.has(remoteJid)) {
      reportedUnapprovedGroups.add(remoteJid);
      console.info(`[Vision Group Detected] ID: ${remoteJid} (Not in approved list)`);
    }
    return;
  }

  let mediaBuffer = null;
  if (details) {
    try {
      mediaBuffer = await downloadIncomingMedia(message);
    } catch (error) {
      console.error('[Vision Media download]', error?.message || error);
      if (intakeAttempts < 4) {
        const pause = Math.min(60_000, 2_000 * (2 ** intakeAttempts) + Math.floor(Math.random() * 500));
        console.warn(`[Vision Intake] Requeueing media download for ${senderJid} in ${Math.ceil(pause / 1000)}s.`);
        setTimeout(() => {
          void mediaIntakeQueue.enqueue(`${remoteJid}:${senderJid}`, () => processQueuedIncomingMessage({
            sock,
            message,
            remoteJid,
            senderJid,
            details,
            text,
            intakeAttempts: intakeAttempts + 1,
          })).catch(() => {});
        }, pause);
      }
      if (text && looksLikeSalePost(text, false)) {
        console.warn(`[Vision Media download] Media could not be downloaded for ${senderJid}, proceeding with text listing.`);
      } else {
        return;
      }
    }
  }

  const itemDetails = mediaBuffer ? {
    buffer: mediaBuffer,
    kind: details.kind,
    mimeType: details.media?.mimetype || '',
    previewBuffer: details.previewBuffer || null,
  } : null;

  // Do not create durable jobs for ordinary text conversation. Media remains
  // eligible even without text so flyer OCR and video analysis can decide.
  // A plain follow-up description is retained when a recent album or pending text is waiting.
  const hasRecentAlbum = recentCandidates(`${remoteJid}:${senderJid}`).length > 0;
  const hasPendingText = recentPendingTexts.has(`${remoteJid}:${senderJid}`);
  if (!itemDetails && !hasRecentAlbum && !hasPendingText && !looksLikeSalePost(text, false)) return;

  queueListingItem({
    groupJid: remoteJid,
    senderJid,
    messageId: message.key?.id,
    details: itemDetails,
    text,
  });
}

function onMessage(sock, message) {
  const remoteJid = message?.key?.remoteJid;
  if (!remoteJid) return;
  const isFromMe = Boolean(message?.key?.fromMe);
  const text = messageText(message);

  if (remoteJid.endsWith('@s.whatsapp.net')) {
    if (isFromMe) return;
    const command = text.toUpperCase();
    if (!['SOLD', 'DELETE'].includes(command)) return;
    void mediaIntakeQueue.enqueue(`command:${remoteJid}`, () => handleSellerCommand(sock, remoteJid, command)).catch(() => {});
    return;
  }

  if (!remoteJid.endsWith('@g.us')) return;
  const myPhone = sock?.user?.id ? sock.user.id.split(':')[0] : '';
  const myJid = myPhone ? `${myPhone}@s.whatsapp.net` : '';
  const senderJid = isFromMe
    ? (myJid || message?.key?.participant || remoteJid)
    : (message?.key?.participant || remoteJid);

  const details = mediaDetails(message);

  console.info(`[Vision Message] In ${remoteJid} from ${senderJid} (hasMedia: ${Boolean(details)}, fromMe: ${isFromMe}): "${text.slice(0, 50).replace(/\n/g, ' ')}"`);
  const queueKey = `${remoteJid}:${senderJid}`;
  void mediaIntakeQueue.enqueue(queueKey, () => processQueuedIncomingMessage({
    sock,
    message,
    remoteJid,
    senderJid,
    details,
    text,
  })).catch(() => {});
}

async function startVisionCollector() {
  if (collectorIsStarting || activeSocket) return;
  collectorIsStarting = true;

  try {
    try {
      await refreshTargetGroups(true);
    } catch (error) {
      console.warn('[Vision Groups] Started without approved-group list:', error?.message || error);
    }

    const sessionDir = process.env.SESSION_DIR || './wa_vision_auth_session';
    if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
    if (!process.env.SESSION_DIR && !warnedAboutSessionStorage) {
      warnedAboutSessionStorage = true;
      console.warn('[Session] SESSION_DIR is unset. Use a persistent disk path in production so WhatsApp does not need to be re-paired after a restart.');
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const phoneNumber = (process.env.WHATSAPP_PHONE_NUMBER || '').replace(/\D/g, '');

    const sock = makeWASocket({
      logger: pino({ level: 'silent' }),
      auth: state,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: true,
      syncFullHistory: false,
      msgRetryCounterCache: messageRetryCounterCache,
      shouldIgnoreJid: (jid) => jid.endsWith('@broadcast') || jid.endsWith('@newsletter'),
      getMessage: async (key) => {
        const msg = messageStore.get(key.id);
        return msg?.message || undefined;
      },
    });
    activeSocket = sock;
    sock.ev.on('creds.update', saveCreds);

    if (phoneNumber && !state.creds.registered) {
      setTimeout(async () => {
        if (sock !== activeSocket) return;
        try {
          const code = await sock.requestPairingCode(phoneNumber);
          const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
          console.log('\n============================================================');
          console.log(`[BOT 2 VISION] WHATSAPP PAIRING CODE: ${formatted}`);
          console.log('============================================================');
          console.log('On your phone for Bot 2:');
          console.log('1. Open WhatsApp -> Settings -> Linked Devices');
          console.log('2. Tap "Link a device"');
          console.log('3. Tap "Link with phone number instead" at the bottom');
          console.log(`4. Enter code: ${formatted}\n`);
        } catch (err) {
          console.error('[Bot 2] Failed to request pairing code:', err?.message || err);
        }
      }, 3000);
    }

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr && !phoneNumber) {
        console.log('[BOT 2 VISION] Scan this QR code to link:');
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'open') {
        whatsappConnected = true;
        console.log('BUYSELL WhatsApp Vision Collector (Bot 2) is active and monitoring groups.');
        sock.sendPresenceUpdate('available').catch(() => {});
        startListingQueuePolling();
      }
      if (connection === 'close') {
        if (sock !== activeSocket) return;
        whatsappConnected = false;
        activeSocket = null;
        const code = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = code === DisconnectReason.loggedOut;
        console.warn(`[Bot 2] WhatsApp connection closed (${code || 'unknown'}). Reconnect: true`);
        if (isLoggedOut) {
          console.warn('[Session] Session unlinked. Resetting session directory and requesting a fresh pairing.');
          try { rmSync(sessionDir, { recursive: true, force: true }); } catch {}
        }
        try { sock.ws?.close(); } catch {}
        scheduleReconnect();
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' && type !== 'append') return;
      for (const message of messages) {
        saveMessage(message);
        // Accept the WhatsApp event immediately. Downloading, transcription,
        // Cloudinary staging, and Vision work continue in their own queues.
        onMessage(sock, message);
      }
    });
  } finally {
    collectorIsStarting = false;
  }
}

const port = process.env.PORT || null;
if (port) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'buysell-whatsapp-vision-collector',
      vision_enabled: true,
      model: process.env.GROQ_MODEL || 'qwen/qwen3.8-27b',
      groups_monitored: targetGroups.size,
      all_groups_monitored: monitorAllGroups,
      whatsapp_connected: whatsappConnected,
      queue: {
        media_intake: mediaIntakeQueue.snapshot,
        listing_staging: listingStagingQueue.snapshot,
        listing_workers_active: listingWorkersActive,
        listing_worker_concurrency: listingWorkerConcurrency,
      },
      uptime: Math.round(process.uptime()),
    }));
  });
  server.listen(port, () => {
    console.info(`[HTTP] Vision Collector health check listening on port ${port}`);
  });
}

startVisionCollector().catch(error => {
  console.error('[Bot 2] WhatsApp Vision collector failed to start:', error?.message || error);
  process.exitCode = 1;
});
