import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  extractMessageContent,
  fetchLatestWaWebVersion,
  normalizeMessageContent,
} from '@whiskeysockets/baileys';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import zlib from 'node:zlib';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import sharp from 'sharp';
import 'dotenv/config';
import { parseListingWithVision, looksLikeSalePost, stripPriceFromText, hasPriceInText, transcribeVideoAudio } from './parser.js';
import { uploadWhatsAppMedia } from './cloudinary.js';
import { BuySellListingsApi } from './buysell-api.js';
import { sendSellerCommandResult, sendSellerConfirmation, sendSellerBatchConfirmation } from './notifier.js';
import { KeyedTaskQueue } from './queue.js';
import { authStoreMode, openAuthState } from './auth-store.js';

const api = new BuySellListingsApi();
const targetGroups = new Set();
const reportedUnapprovedGroups = new Set();
const groupRefreshMs = Math.max(300_000, Number(process.env.WHATSAPP_GROUP_REFRESH_MS || 600_000));
let lastGroupRefreshAt = 0;
let groupRefreshPromise = null;

// Strict 2MB media ceiling to keep egress/ingress well below Render's 5GB monthly limit
const MAX_MEDIA_BYTES = Math.max(500_000, Number(process.env.MAX_MEDIA_BYTES || 2_097_152));

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

// Adaptive polling: poll every 3-4s when work is active; back off to 25s when idle (saves ~90% of polling bandwidth)
const activePollMs = Math.max(2_000, Number(process.env.WHATSAPP_QUEUE_POLL_MS || 4_000));
const idlePollMs = Math.max(10_000, Number(process.env.WHATSAPP_IDLE_POLL_MS || 25_000));
let currentPollIntervalMs = idlePollMs;

const priceFollowUpWindowMs = Math.max(60_000, Number(process.env.WHATSAPP_PRICE_FOLLOWUP_WINDOW_MS || 10 * 60_000));
const queueWorkerId = `vision-${randomBytes(10).toString('hex')}`;

/**
 * Resizes and compresses image buffers to max 1280px progressive mozjpeg (quality 75).
 * Drops payload size by 85-95% (e.g. 1.8MB -> ~90KB) before Cloudinary upload.
 */
async function compressImageBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return buffer;
  try {
    const compressed = await sharp(buffer)
      .rotate()
      .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75, progressive: true, mozjpeg: true })
      .toBuffer();
    const originalKb = Math.round(buffer.length / 1024);
    const compressedKb = Math.round(compressed.length / 1024);
    const savings = Math.round((1 - compressed.length / buffer.length) * 100);
    console.info(`[Image Compress] Downsized ${originalKb}KB -> ${compressedKb}KB (-${savings}%) for network transmission.`);
    return compressed;
  } catch (err) {
    console.warn('[Image Compress] Optimization failed, keeping original:', err?.message || err);
    return buffer;
  }
}

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
let reconnectAttempts = 0;
let keepAliveTimer = null;
let collectorIsStarting = false;
let warnedAboutSessionStorage = false;
let activeAuth = null;

// Live pairing state for web dashboard /pair and session recovery
let latestPairingCode = null;
let pairingCodeGeneratedAt = null;
let pairingTargetPhone = null;
let latestPairingError = null;
let activePairingCodeRaw = null;
let pairingCodeRequestTimer = null;
let pairingCodeRequestSocket = null;
let pairingCodeRequestAttempts = 0;
const PAIRING_CODE_REUSE_WINDOW_MS = 55_000;

function clearPairingCodeRequestTimer() {
  if (pairingCodeRequestTimer) {
    clearTimeout(pairingCodeRequestTimer);
    pairingCodeRequestTimer = null;
  }
}

function schedulePairingCodeRequest(sock, phoneNumber, delayMs = 0, reason = 'initial request', codeToReuse = null) {
  clearPairingCodeRequestTimer();
  pairingCodeRequestTimer = setTimeout(() => {
    pairingCodeRequestTimer = null;
    void requestPairingCode(sock, phoneNumber, reason, codeToReuse);
  }, delayMs);
}

function canReuseActivePairingCode(phoneNumber) {
  const ageMs = pairingCodeGeneratedAt ? Date.now() - pairingCodeGeneratedAt : Number.POSITIVE_INFINITY;
  return Boolean(
    phoneNumber
    && phoneNumber === pairingTargetPhone
    && /^[A-Z0-9]{8}$/.test(activePairingCodeRaw || '')
    && ageMs >= 0
    && ageMs < PAIRING_CODE_REUSE_WINDOW_MS,
  );
}

async function requestPairingCode(sock, phoneNumber, reason = 'manual request', codeToReuse = null) {
  if (!phoneNumber || sock !== activeSocket || whatsappConnected || pairingCodeRequestSocket === sock) return false;

  pairingCodeRequestSocket = sock;
  try {
    const code = await sock.requestPairingCode(phoneNumber, codeToReuse || undefined);
    // A reset/reconnect can replace the socket while WhatsApp is processing the
    // request. Never let that stale request replace the new session's code.
    if (sock !== activeSocket || whatsappConnected) return false;
    const rawCode = String(code || '').replace(/-/g, '').toUpperCase();
    const formatted = rawCode.match(/.{1,4}/g)?.join('-') || code;
    activePairingCodeRaw = rawCode;
    latestPairingCode = formatted;
    pairingCodeGeneratedAt = Date.now();
    latestPairingError = null;
    pairingTargetPhone = phoneNumber;
    pairingCodeRequestAttempts = 0;

    console.log('\n============================================================');
    console.log(`[BOT 2 VISION] WHATSAPP PAIRING CODE FOR +${phoneNumber}: ${formatted}`);
    console.log('============================================================');
    console.log(`On your phone for Bot 2 (+${phoneNumber}):`);
    console.log('1. Open WhatsApp -> Settings -> Linked Devices');
    console.log('2. Ensure you have under 4 linked devices (remove old ones if needed)');
    console.log('3. Tap "Link a device"');
    console.log('4. Tap "Link with phone number instead" at the bottom');
    console.log(`5. Enter code within 60s: ${formatted}\n`);
    return true;
  } catch (err) {
    latestPairingError = err?.message || String(err);
    console.error(`[Bot 2] Failed to request pairing code (${reason}):`, latestPairingError);

    // Render and WhatsApp can take longer than the original fixed 3-second wait
    // to open the pairing socket. Retry the request a few times on the same fresh
    // session so the phone receives a pairing prompt without the user resetting it.
    if (sock === activeSocket && !whatsappConnected && pairingCodeRequestAttempts < 3) {
      const retryDelays = [5_000, 10_000, 20_000];
      const retryDelay = retryDelays[pairingCodeRequestAttempts++];
      schedulePairingCodeRequest(sock, phoneNumber, retryDelay, 'automatic retry', codeToReuse);
    }
    return false;
  } finally {
    if (pairingCodeRequestSocket === sock) pairingCodeRequestSocket = null;
  }
}

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

// The WhatsApp Web version bundled with Baileys goes stale between releases.
// WhatsApp still opens the socket for an outdated client but rejects the
// phone-number link step ("Couldn't link device"), so use the live version.
let cachedWaWebVersion = null;
async function resolveWaWebVersion() {
  try {
    const { version, isLatest } = await fetchLatestWaWebVersion({ timeout: 10_000 });
    if (isLatest && Array.isArray(version)) {
      cachedWaWebVersion = version;
      console.info(`[Bot 2] Using WhatsApp Web version ${version.join('.')}.`);
    }
  } catch (error) {
    console.warn('[Bot 2] Could not fetch the latest WhatsApp Web version:', error?.message || error);
  }
  return cachedWaWebVersion || undefined;
}

function safeCloseSocket(sock) {
  if (!sock) return;
  try {
    sock.ev.removeAllListeners();
  } catch {}
  try {
    if (sock.ws) {
      sock.ws.removeAllListeners?.();
      sock.ws.close();
    }
  } catch {}
}

function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function startKeepAlive(sock) {
  stopKeepAlive();
  // WhatsApp drops idle WebSocket connections after ~10-20 min. Periodic presence pings keep it alive.
  keepAliveTimer = setInterval(async () => {
    if (activeSocket === sock && whatsappConnected) {
      try {
        await sock.sendPresenceUpdate('available');
      } catch (err) {
        console.warn('[Bot 2 KeepAlive] Periodic presence ping failed:', err?.message || err);
      }
    }
  }, 30_000);
}

function scheduleReconnect(immediate = false) {
  if (reconnectTimer) return;

  // Delays with exponential backoff: 1s (immediate/515 restart), 3s, 5s, 10s, 20s, 30s, up to 60s
  const delays = [3_000, 5_000, 10_000, 20_000, 30_000, 60_000];
  const delay = immediate ? 1_000 : delays[Math.min(reconnectAttempts, delays.length - 1)];

  console.info(`[Bot 2] WhatsApp reconnect scheduled in ${(delay / 1000).toFixed(0)}s (retry attempt #${reconnectAttempts + 1})...`);

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await startVisionCollector();
    } catch (error) {
      console.error('[Bot 2] WhatsApp Vision collector failed to reconnect:', error?.message || error);
      reconnectAttempts++;
      scheduleReconnect(false);
    }
  }, delay);
}

// Process-level crash guards to ensure Bot 2 never dies from unexpected network or socket exceptions
process.on('uncaughtException', (err) => {
  console.error('[Bot 2 CrashGuard] Uncaught Exception:', err?.message || err);
  if (err?.stack) console.error(err.stack);
  if (!whatsappConnected && !reconnectTimer) {
    scheduleReconnect(false);
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('[Bot 2 CrashGuard] Unhandled Rejection:', reason?.message || reason);
  if (reason?.stack) console.error(reason.stack);
});

process.on('SIGINT', () => {
  console.info('[Bot 2] Received SIGINT. Shutting down gracefully...');
  stopKeepAlive();
  safeCloseSocket(activeSocket);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.info('[Bot 2] Received SIGTERM. Shutting down gracefully...');
  stopKeepAlive();
  safeCloseSocket(activeSocket);
  process.exit(0);
});

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
  if (content.imageMessage) {
    const rawLen = content.imageMessage.fileLength;
    const fileLength = Number(rawLen?.low ?? rawLen ?? 0);
    return { kind: 'image', media: content.imageMessage, fileLength };
  }
  if (content.videoMessage) {
    const rawLen = content.videoMessage.fileLength;
    const fileLength = Number(rawLen?.low ?? rawLen ?? 0);
    const preview = content.videoMessage.jpegThumbnail;
    return {
      kind: 'video',
      media: content.videoMessage,
      fileLength,
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

function normalizeWhatsAppPhoneNumber(raw) {
  let cleaned = String(raw || '').replace(/\D/g, '');
  if (!cleaned) return '';
  // Convert Nigerian domestic format (e.g. 09061484256) to international (2349061484256)
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = `234${cleaned.slice(1)}`;
  } else if (cleaned.length === 10 && !cleaned.startsWith('234')) {
    cleaned = `234${cleaned}`;
  }
  return cleaned;
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
      const hasSufficientText = bundle.text && bundle.text.length > 20 && looksLikeSalePost(bundle.text, false);
      if (!hasSufficientText) {
        const transcript = await transcribeVideoAudio({ buffer: item.buffer, mimeType: item.mimeType });
        if (transcript) transcripts.push(transcript);
      } else {
        console.info('[Video Skip Audio] Seller already provided written description; skipping Whisper transcription to save bandwidth.');
      }
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
    wakeQueuePump();
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
  if (!whatsappConnected || !activeSocket || listingClaimInFlight) return false;
  listingClaimInFlight = true;
  let hadWork = false;
  try {
    while (listingWorkersActive < listingWorkerConcurrency) {
      const claimed = await api.claimListingJobs({ workerId: queueWorkerId, limit: 1, leaseSeconds: 900 });
      const job = Array.isArray(claimed?.jobs) ? claimed.jobs[0] : null;
      if (!job) break;
      hadWork = true;
      listingWorkersActive += 1;
      void processClaimedListingJob(job).finally(() => {
        listingWorkersActive -= 1;
        wakeQueuePump();
      });
    }
  } catch (error) {
    console.warn('[Vision Queue] Could not claim listing jobs:', error?.message || error);
  } finally {
    listingClaimInFlight = false;
  }
  return hadWork;
}

function wakeQueuePump() {
  currentPollIntervalMs = activePollMs;
  if (listingQueuePollTimer) clearTimeout(listingQueuePollTimer);
  listingQueuePollTimer = setTimeout(runQueuePollStep, 50);
}

function scheduleListingJobPump() {
  wakeQueuePump();
}

async function runQueuePollStep() {
  listingQueuePollTimer = null;
  const hadWork = await pumpListingJobs();
  if (hadWork) {
    currentPollIntervalMs = activePollMs;
  } else {
    // Smooth exponential backoff to reduce idle bandwidth by ~90%
    currentPollIntervalMs = Math.min(idlePollMs, Math.round(currentPollIntervalMs * 1.5));
  }
  listingQueuePollTimer = setTimeout(runQueuePollStep, currentPollIntervalMs);
}

function startListingQueuePolling() {
  if (listingQueuePollTimer) return;
  runQueuePollStep();
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
    if (details.fileLength && details.fileLength > MAX_MEDIA_BYTES) {
      console.warn(`[Vision Media Skip] ${senderJid} sent ${details.kind} of ${(details.fileLength / 1024 / 1024).toFixed(2)}MB (> 2MB limit). Skipping download to conserve bandwidth.`);
    } else {
      try {
        mediaBuffer = await downloadIncomingMedia(message);
        if (mediaBuffer && mediaBuffer.length > MAX_MEDIA_BYTES) {
          console.warn(`[Vision Media Skip] Downloaded ${details.kind} from ${senderJid} exceeds 2MB limit (${(mediaBuffer.length / 1024 / 1024).toFixed(2)}MB). Discarding.`);
          mediaBuffer = null;
        } else if (mediaBuffer && details.kind === 'image') {
          mediaBuffer = await compressImageBuffer(mediaBuffer);
        }
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
  if (collectorIsStarting) return;
  if (activeSocket && whatsappConnected) return;
  collectorIsStarting = true;

  try {
    if (activeSocket) {
      clearPairingCodeRequestTimer();
      safeCloseSocket(activeSocket);
      activeSocket = null;
    }

    try {
      await refreshTargetGroups(true);
    } catch (error) {
      console.warn('[Vision Groups] Started without approved-group list:', error?.message || error);
    }

    const sessionDir = process.env.SESSION_DIR || './wa_vision_auth_session';
    if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
    if (!process.env.SESSION_DIR && authStoreMode() === 'file' && !warnedAboutSessionStorage) {
      warnedAboutSessionStorage = true;
      console.warn('[Session] SESSION_DIR is unset. Use a persistent disk path or WHATSAPP_AUTH_STORE=supabase in production so WhatsApp does not need to be re-paired after a restart.');
    }

    let rawConfigPhone = (process.env.WHATSAPP_PHONE_NUMBER || '').trim();
    let phoneNumber = normalizeWhatsAppPhoneNumber(rawConfigPhone);
    // Bot 2 defaults to 2349061484256 if unset or if Bot 1's number (2348080302256) was mistakenly copied in
    if (!phoneNumber || phoneNumber === '2348080302256') {
      phoneNumber = '2349061484256';
    }
    if (pairingTargetPhone) {
      phoneNumber = pairingTargetPhone;
    }
    pairingTargetPhone = phoneNumber;
    const pairingTargetFile = `${sessionDir}/pairing_target.txt`;

    let auth = await openAuthState({ api, sessionDir });
    activeAuth = auth;
    console.info(`[Session] WhatsApp session stored in ${auth.description}.`);
    let state = auth.state;
    let saveCreds = auth.saveCreds;

    // If session is NOT registered, ensure clean crypto keys for pairing
    if (!state.creds.registered && phoneNumber) {
      let previousTarget = '';
      try {
        if (existsSync(pairingTargetFile)) {
          previousTarget = readFileSync(pairingTargetFile, 'utf-8').trim();
        }
      } catch {}

      // Preserve the active pairing key for a short reconnect. Resetting it while
      // the user is typing the displayed code invalidates that code and results in
      // WhatsApp's "Couldn't link device" error. Old/expired attempts still get a
      // clean session because WhatsApp codes have a short lifetime.
      const hasOldPairingState = Boolean(state.creds.me || state.creds.pairingCode);
      const phoneMismatch = Boolean(previousTarget && previousTarget !== phoneNumber);
      const resumeActivePairing = !phoneMismatch && hasOldPairingState && canReuseActivePairingCode(phoneNumber);

      if (phoneMismatch || (hasOldPairingState && !resumeActivePairing)) {
        console.warn(`[Session] Resetting un-registered session files for +${phoneNumber} to guarantee clean pairing keys...`);
        await auth.clear();
        auth = await openAuthState({ api, sessionDir });
        activeAuth = auth;
        state = auth.state;
        saveCreds = auth.saveCreds;
      } else if (resumeActivePairing) {
        console.info(`[Session] Reusing the active pairing code for +${phoneNumber} after a transient reconnect.`);
      }
      try { writeFileSync(pairingTargetFile, phoneNumber, 'utf-8'); } catch {}
    }

    const waWebVersion = await resolveWaWebVersion();
    const sock = makeWASocket({
      ...(waWebVersion ? { version: waWebVersion } : {}),
      logger: pino({ level: 'silent' }),
      auth: state,
      // WhatsApp rejects phone-number linking for the Ubuntu identity
      // ("Couldn't link device"); the macOS identity pairs successfully.
      browser: Browsers.macOS('Chrome'),
      markOnlineOnConnect: true,
      syncFullHistory: false,
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 60_000,
      keepAliveIntervalMs: 25_000,
      retryRequestDelayMs: 5_000,
      msgRetryCounterCache: messageRetryCounterCache,
      shouldIgnoreJid: (jid) => jid.endsWith('@broadcast') || jid.endsWith('@newsletter'),
      getMessage: async (key) => {
        const msg = messageStore.get(key.id);
        return msg?.message || undefined;
      },
    });
    activeSocket = sock;
    let credsSavePromise = Promise.resolve();
    let pairingCodeRequestedOnSocket = false;
    const pairingCodeForReconnect = canReuseActivePairingCode(phoneNumber) ? activePairingCodeRaw : null;
    sock.ev.on('creds.update', () => {
      // The post-pairing restart can arrive immediately after the credential
      // update. Serialize disk writes so the next socket always sees the new keys.
      credsSavePromise = credsSavePromise
        .then(() => saveCreds())
        .catch(error => console.error('[Session] Could not persist WhatsApp credentials:', error?.message || error));
    });

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      // Baileys emits a QR reference even for phone-number pairing. Waiting for
      // this event ensures the WebSocket is ready before registering the code.
      // Requesting it from a fixed startup timer can produce a code that the
      // phone displays but WhatsApp never accepts.
      if (qr && phoneNumber && !state.creds.registered && !pairingCodeRequestedOnSocket) {
        pairingCodeRequestedOnSocket = true;
        pairingCodeRequestAttempts = 0;
        schedulePairingCodeRequest(
          sock,
          phoneNumber,
          0,
          pairingCodeForReconnect ? 'transient reconnect' : 'QR-ready pairing request',
          pairingCodeForReconnect,
        );
      }
      if (qr && !phoneNumber) {
        console.log('[BOT 2 VISION] Scan this QR code to link:');
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'open') {
        whatsappConnected = true;
        reconnectAttempts = 0;
        clearPairingCodeRequestTimer();
        latestPairingCode = null;
        pairingCodeGeneratedAt = null;
        activePairingCodeRaw = null;
        console.log(`BUYSELL WhatsApp Vision Collector (Bot 2) is active and connected as +${sock?.user?.id?.split(':')[0] || phoneNumber}.`);
        sock.sendPresenceUpdate('available').catch(() => {});
        startKeepAlive(sock);
        startListingQueuePolling();
      }
      if (connection === 'close') {
        await credsSavePromise;
        whatsappConnected = false;
        clearPairingCodeRequestTimer();
        stopKeepAlive();
        const code = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = code === DisconnectReason.loggedOut;
        const isRestartRequired = code === DisconnectReason.restartRequired;

        console.warn(`[Bot 2] WhatsApp connection closed (code: ${code ?? 'unknown'}, reason: ${lastDisconnect?.error?.message || 'unknown'}).`);

        if (activeSocket === sock) {
          activeSocket = null;
        }
        safeCloseSocket(sock);

        if (isLoggedOut) {
          console.warn('[Session] Session unlinked. Resetting stored session and requesting a fresh pairing.');
          try { await auth.clear(); } catch (error) { console.error('[Session] Could not clear the stored session:', error?.message || error); }
          reconnectAttempts = 0;
          scheduleReconnect(false);
        } else if (isRestartRequired) {
          console.info('[Bot 2] Restart required by WhatsApp. Reconnecting immediately...');
          scheduleReconnect(true);
        } else {
          reconnectAttempts++;
          scheduleReconnect(false);
        }
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

function sendCompressedResponse(req, res, statusCode, payload) {
  if (req.method === 'HEAD') {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      Vary: 'Accept-Encoding',
    });
    res.end();
    return;
  }

  const jsonString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const acceptEncoding = String(req.headers['accept-encoding'] || '');
  const buffer = Buffer.from(jsonString, 'utf-8');

  res.setHeader('Vary', 'Accept-Encoding');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (/\bbr\b/i.test(acceptEncoding)) {
    try {
      const compressed = zlib.brotliCompressSync(buffer);
      res.writeHead(statusCode, {
        'Content-Encoding': 'br',
        'Content-Length': compressed.length,
      });
      res.end(compressed);
      return;
    } catch {}
  }

  if (/\bgzip\b/i.test(acceptEncoding)) {
    try {
      const compressed = zlib.gzipSync(buffer);
      res.writeHead(statusCode, {
        'Content-Encoding': 'gzip',
        'Content-Length': compressed.length,
      });
      res.end(compressed);
      return;
    } catch {}
  }

  if (/\bdeflate\b/i.test(acceptEncoding)) {
    try {
      const compressed = zlib.deflateSync(buffer);
      res.writeHead(statusCode, {
        'Content-Encoding': 'deflate',
        'Content-Length': compressed.length,
      });
      res.end(compressed);
      return;
    } catch {}
  }

  res.writeHead(statusCode, {
    'Content-Length': buffer.length,
  });
  res.end(buffer);
}

const port = process.env.PORT || null;
if (port) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // Ask WhatsApp to send the phone-link prompt again without discarding the
    // active pairing handshake. This is safer and faster than resetting keys.
    if (pathname === '/request-pairing-code') {
      if (!whatsappConnected && activeSocket && pairingTargetPhone) {
        await requestPairingCode(activeSocket, pairingTargetPhone, 'manual dashboard request');
      }
      res.writeHead(302, { Location: '/pair' });
      res.end();
      return;
    }

    // Reset session endpoint to force clean cryptographic keys without redeploying
    if (pathname === '/reset-session') {
      if (whatsappConnected) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h3>Bot 2 is already connected to WhatsApp!</h3><p>Unlink from your phone if you wish to re-pair.</p><p><a href="/pair">Go back</a></p>');
        return;
      }
      const requestedPhone = url.searchParams.get('phone');
      if (requestedPhone) {
        const cleaned = normalizeWhatsAppPhoneNumber(requestedPhone);
        if (cleaned) {
          pairingTargetPhone = cleaned;
          console.info(`[HTTP] Target phone updated to +${pairingTargetPhone}`);
        }
      }
      // This page is unauthenticated. Never let it wipe a linked session (now
      // durable in Supabase) just because the socket is briefly reconnecting.
      if (activeAuth?.state?.creds?.registered) {
        res.writeHead(409, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h3>Bot 2 already has a linked WhatsApp session and is reconnecting.</h3><p>To re-pair, unlink the device from your phone first; the bot then resets itself.</p><p><a href="/pair">Go back</a></p>');
        return;
      }
      console.warn('[HTTP] Manual session reset requested. Wiping unlinked session files...');
      stopKeepAlive();
      clearPairingCodeRequestTimer();
      pairingCodeRequestAttempts = 0;
      if (activeSocket) {
        safeCloseSocket(activeSocket);
        activeSocket = null;
      }
      try {
        const auth = activeAuth || await openAuthState({ api, sessionDir: process.env.SESSION_DIR || './wa_vision_auth_session' });
        await auth.clear();
      } catch (error) {
        console.error('[HTTP] Could not clear the stored session:', error?.message || error);
      }
      latestPairingCode = null;
      pairingCodeGeneratedAt = null;
      activePairingCodeRaw = null;
      latestPairingError = null;
      reconnectAttempts = 0;
      scheduleReconnect(true);
      res.writeHead(302, { Location: '/pair' });
      res.end();
      return;
    }

    if (pathname === '/pair/status') {
      const codeAgeSeconds = pairingCodeGeneratedAt ? Math.round((Date.now() - pairingCodeGeneratedAt) / 1000) : null;
      sendCompressedResponse(req, res, 200, {
        connected: whatsappConnected,
        code: latestPairingCode,
        code_age_seconds: codeAgeSeconds,
        code_expired: codeAgeSeconds !== null && codeAgeSeconds > 60,
        error: latestPairingError,
      });
      return;
    }

    // Interactive web pairing dashboard
    if (pathname === '/pair' || (pathname === '/' && req.headers.accept?.includes('text/html'))) {
      const isConnected = whatsappConnected;
      const targetPhone = pairingTargetPhone || normalizeWhatsAppPhoneNumber(process.env.WHATSAPP_PHONE_NUMBER) || '2349061484256';
      const code = latestPairingCode;
      const rawCode = code ? code.replace(/-/g, '') : '';
      const codeAge = pairingCodeGeneratedAt ? Math.round((Date.now() - pairingCodeGeneratedAt) / 1000) : null;
      const codeExpired = codeAge !== null && codeAge > 60;
      const remainingSec = codeAge ? Math.max(0, 60 - codeAge) : 60;

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BUYSELL Bot 2 - WhatsApp Pairing</title>
  <meta http-equiv="refresh" content="${isConnected ? '30' : '15'}">
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b1120; color: #f8fafc; margin: 0; padding: 20px; display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; }
    .card { background: #1e293b; border-radius: 18px; padding: 26px; max-width: 480px; width: 100%; box-shadow: 0 12px 30px rgba(0,0,0,0.5); border: 1px solid #334155; }
    h1 { font-size: 21px; margin-top: 0; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; color: #38bdf8; }
    .status { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 700; margin-bottom: 18px; }
    .status.online { background: #064e3b; color: #34d399; }
    .status.waiting { background: #78350f; color: #fbbf24; }
    .code-box { background: #030712; border: 2px dashed #38bdf8; border-radius: 14px; padding: 20px; text-align: center; margin: 18px 0; }
    .code { font-size: 34px; font-weight: 900; letter-spacing: 5px; color: #38bdf8; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .timer { font-size: 13px; color: #94a3b8; margin-top: 8px; }
    .btn { display: inline-flex; align-items: center; justify-content: center; background: #2563eb; color: #fff; text-decoration: none; padding: 10px 16px; border-radius: 8px; font-weight: 600; font-size: 14px; border: none; cursor: pointer; transition: background 0.2s; }
    .btn:hover { background: #1d4ed8; }
    .btn-secondary { background: #334155; }
    .btn-secondary:hover { background: #475569; }
    .steps { background: #0f172a; border-radius: 12px; padding: 14px 18px; margin: 18px 0; font-size: 14px; line-height: 1.6; border: 1px solid #1e293b; }
    .steps ol { margin: 6px 0 0; padding-left: 20px; }
    .steps li { margin-bottom: 6px; }
    .warn { background: #450a0a; border: 1px solid #991b1b; border-radius: 10px; padding: 12px 16px; color: #fca5a5; font-size: 13px; line-height: 1.5; margin-top: 16px; }
    .phone-input { flex: 1; min-width: 150px; padding: 10px 14px; border-radius: 8px; border: 1px solid #475569; background: #030712; color: #fff; font-size: 14px; font-family: monospace; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🤖 BUYSELL Bot 2 Collector</h1>
    ${isConnected ? `
      <div class="status online">● Connected & Active (+${targetPhone})</div>
      <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6;">WhatsApp Vision Collector is actively monitoring WhatsApp seller groups and indexing products with AI.</p>
    ` : `
      <div class="status waiting">⏳ Awaiting WhatsApp Linking</div>
      <p style="margin: 0; color: #94a3b8; font-size: 14px;">Target phone: <strong style="color: #f8fafc;">+${targetPhone}</strong></p>
      
      <div class="code-box">
        <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #94a3b8; margin-bottom: 6px;">Active 8-Character Pairing Code</div>
        <div class="code">${code || 'Generating...'}</div>
        <div class="timer">
          ${code ? (codeExpired
            ? '<strong style="color:#f87171;">⚠️ Code expired (>60s). Click "Generate Fresh Code" below.</strong>'
            : `⏳ Valid for another <strong>${remainingSec}s</strong> (auto-refreshes every 5s)`)
          : 'Connecting to WhatsApp pairing server...'}
        </div>
        ${code ? `
          <button type="button" class="btn btn-secondary" style="margin-top: 12px; font-size: 12px; padding: 6px 14px;" onclick="navigator.clipboard.writeText('${rawCode}'); this.innerText='✓ Copied!'; setTimeout(() => this.innerText='📋 Copy Code', 2000);">
            📋 Copy Code
          </button>
        ` : ''}
      </div>

      ${latestPairingError ? `
        <div class="warn" style="margin-bottom: 16px;">
          <strong>Pairing Error:</strong> ${latestPairingError}
        </div>
      ` : ''}

      <div class="steps">
        <strong style="color: #38bdf8;">On phone +${targetPhone}:</strong>
        <ol>
          <li>Open WhatsApp &rarr; <strong>Settings</strong> (or <strong>⋮</strong> menu) &rarr; <strong>Linked Devices</strong>.</li>
          <li><strong>Check limit:</strong> If you already have 4 linked devices, log out of one.</li>
          <li>Tap <strong>Link a device</strong>.</li>
          <li>Tap <strong>"Link with phone number instead"</strong> at the bottom.</li>
          <li>Type code: <strong style="color: #38bdf8; font-family: monospace; font-size: 15px;">${code || '...'}</strong></li>
        </ol>
      </div>

      <form action="/request-pairing-code" method="GET" style="margin-top: 14px;">
        <button type="submit" class="btn btn-secondary" style="width: 100%;">Send pairing prompt / fresh code again</button>
      </form>
      <p style="margin: 8px 0 0; color: #94a3b8; font-size: 12px; line-height: 1.45;">If the phone notification is delayed or hidden, stay on the WhatsApp code-entry screen and use the code shown above. This button asks WhatsApp to send the linking prompt again without deleting the current session.</p>

      <form action="/reset-session" method="GET" style="margin-top: 14px;">
        <label style="display: block; font-size: 12px; color: #94a3b8; margin-bottom: 6px;">Last resort only — changing the phone number or WhatsApp says it could not link?</label>
        <div style="display: flex; gap: 8px;">
          <input type="tel" name="phone" value="${targetPhone}" placeholder="09061484256" class="phone-input" />
          <button type="submit" class="btn">🔄 New Code</button>
        </div>
      </form>

      <div class="warn">
        💡 <strong>Tip:</strong> If WhatsApp displays <em>"Couldn't link device"</em>, tap <strong>New Code</strong> above to reset the crypto handshake keys, and make sure your phone has fewer than 4 linked devices.
      </div>
    `}
  </div>
  ${isConnected ? '' : `<script>
    const pairingSnapshot = ${JSON.stringify({ code, error: latestPairingError })};
    setInterval(() => {
      fetch('/pair/status', { cache: 'no-store' })
        .then(response => response.ok ? response.json() : null)
        .then(status => {
          if (status && (status.connected || status.code !== pairingSnapshot.code || status.error !== pairingSnapshot.error)) {
            window.location.reload();
          }
        })
        .catch(() => {});
    }, 2500);
  </script>`}
</body>
</html>`;

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // Default JSON health check
    sendCompressedResponse(req, res, 200, {
      status: 'ok',
      service: 'buysell-whatsapp-vision-collector',
      vision_enabled: true,
      model: process.env.GROQ_MODEL || 'qwen/qwen3.8-27b',
      groups_monitored: targetGroups.size,
      all_groups_monitored: monitorAllGroups,
      whatsapp_connected: whatsappConnected,
      reconnect_attempts: reconnectAttempts,
      pairing: {
        connected: whatsappConnected,
        target_phone: pairingTargetPhone || normalizeWhatsAppPhoneNumber(process.env.WHATSAPP_PHONE_NUMBER) || '2349061484256',
        code: latestPairingCode,
        generated_seconds_ago: pairingCodeGeneratedAt ? Math.round((Date.now() - pairingCodeGeneratedAt) / 1000) : null,
        error: latestPairingError,
      },
      poll_interval_ms: currentPollIntervalMs,
      max_media_bytes: MAX_MEDIA_BYTES,
      queue: {
        media_intake: mediaIntakeQueue.snapshot,
        listing_staging: listingStagingQueue.snapshot,
        listing_workers_active: listingWorkersActive,
        listing_worker_concurrency: listingWorkerConcurrency,
      },
      uptime: Math.round(process.uptime()),
    });
  });
  server.listen(port, () => {
    console.info(`[HTTP] Vision Collector health check listening on port ${port} (Pairing UI available at /pair)`);
  });
}

// Keep-awake ping for cloud hosts like Render free tier
const selfPingUrl = process.env.SELF_PING_URL || process.env.RENDER_EXTERNAL_URL || null;
if (selfPingUrl) {
  console.info(`[SelfPing] Self-ping active for keep-awake: ${selfPingUrl}`);
  setInterval(() => {
    fetch(selfPingUrl, {
      method: 'GET',
      headers: { 'Accept-Encoding': 'gzip, deflate, br' },
    }).catch(() => {});
  }, 12 * 60_000);
}

startVisionCollector().catch(error => {
  console.error('[Bot 2] WhatsApp Vision collector initial start failed:', error?.message || error);
  scheduleReconnect(false);
});
