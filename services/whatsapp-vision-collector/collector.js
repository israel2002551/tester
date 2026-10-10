import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  extractMessageContent,
  normalizeMessageContent,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { createHash, randomBytes } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import http from 'node:http';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import 'dotenv/config';
import { parseListingWithVision, looksLikeSalePost, stripPriceFromText, hasPriceInText } from './parser.js';
import { uploadWhatsAppMedia } from './cloudinary.js';
import { BuySellListingsApi } from './buysell-api.js';
import { sendSellerCommandResult, sendSellerConfirmation, sendSellerBatchConfirmation } from './notifier.js';

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
  if (content.videoMessage) return { kind: 'video', media: content.videoMessage };
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
  const hasImages = Array.isArray(bundle?.media) && bundle.media.some(m => m?.kind === 'image' && m?.buffer);
  if (!bundle || (!bundle.text && !hasImages)) return;
  if (!looksLikeSalePost(bundle.text, hasImages)) return;

  console.info(`[Vision Analysis] Scanning post from ${bundle.senderJid} (images: ${bundle.media?.length || 0}, text: "${(bundle.text || '').slice(0, 50).replace(/\n/g, ' ')}")...`);

  const parsed = await parseListingWithVision({
    text: bundle.text,
    media: bundle.media,
  });

  if (!parsed?.is_commercial_listing) {
    console.info(`[Skipped] ${bundle.senderJid}: Vision AI determined this is not a commercial sale post.`);
    return;
  }

  // Extract all valid items parsed from this post
  const rawItems = Array.isArray(parsed.items) && parsed.items.length > 0
    ? parsed.items
    : (parsed.title && parsed.price ? [parsed] : []);

  const validItems = rawItems.filter(item => Number.isFinite(Number(item?.price)) && Number(item.price) > 0);

  if (validItems.length === 0) {
    console.info(`[Skipped] ${bundle.senderJid}: No priced products found in post text or image.`);
    return;
  }

  console.info(`[Vision Found] Detected ${validItems.length} product(s) from ${bundle.senderJid}`);

  // Base identifier for Cloudinary uploads
  const baseId = sourceId(bundle.groupJid, bundle.senderJid, bundle.messageIds, 0);

  let uploadedMedia = [];
  try {
    uploadedMedia = await Promise.all((bundle.media || []).map((item, index) => uploadWhatsAppMedia({
      buffer: item.buffer,
      kind: item.kind,
      mimeType: item.mimeType,
      sourceId: baseId,
      index,
    })));
  } catch (err) {
    console.error(`[Vision Cloudinary upload] ${bundle.senderJid}:`, err?.message || err);
  }

  const createdListings = [];

  // Ingest each identified product separately
  for (let i = 0; i < validItems.length; i++) {
    const item = validItems[i];
    const itemSourceId = sourceId(bundle.groupJid, bundle.senderJid, bundle.messageIds, i);

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
    }
  }

  // Notify seller of imported listing(s)
  if (createdListings.length > 0) {
    await sendSellerBatchConfirmation(sock, {
      senderJid: bundle.senderJid,
      listings: createdListings,
      publicSiteUrl: process.env.PUBLIC_SITE_URL,
    });
  }
}

async function flushBundle(bundle, sock) {
  const key = `${bundle.groupJid}:${bundle.senderJid}`;
  const combinedText = bundle.texts.join('\n').trim();

  // If media was sent without any text, hold for 25s in case seller sends price separately
  if (!combinedText) {
    if (bundle.media.length > 0) {
      console.info(`[Vision Buffer] ${bundle.senderJid} posted ${bundle.media.length} image(s) without text. Waiting 25s for price follow-up...`);
      const timer = setTimeout(async () => {
        recentUncaptionedMedia.delete(key);
        console.info(`[Vision Scan] Scanning image from ${bundle.senderJid} for visible price or flyer text...`);
        await processListing({
          groupJid: bundle.groupJid,
          senderJid: bundle.senderJid,
          text: '',
          media: bundle.media,
          messageIds: bundle.messageIds,
        }, sock);
      }, 25_000);

      recentUncaptionedMedia.set(key, {
        media: bundle.media,
        messageIds: bundle.messageIds,
        timer,
      });
    }
    return;
  }

  await processListing({
    groupJid: bundle.groupJid,
    senderJid: bundle.senderJid,
    text: combinedText,
    media: bundle.media,
    messageIds: bundle.messageIds,
  }, sock);
}

function queueListingItem({ groupJid, senderJid, messageId, details, text, sock }) {
  const key = `${groupJid}:${senderJid}`;
  const cleanText = String(text || '').trim();
  const msgHasPrice = hasPriceInText(cleanText);

  let bundle = pendingBundles.get(key);

  // If an existing bundle ALREADY contains a price, AND this new message ALSO introduces a price:
  // The seller is posting a separate product! Immediately flush the previous bundle and start fresh.
  const bundleHasPrice = bundle && bundle.texts.some(t => hasPriceInText(t));
  if (bundle && bundleHasPrice && msgHasPrice) {
    clearTimeout(bundle.timer);
    pendingBundles.delete(key);
    flushBundle(bundle, sock);
    bundle = null;
  }

  if (!bundle) {
    bundle = {
      groupJid,
      senderJid,
      texts: [],
      media: [],
      messageIds: [],
      timer: null,
    };
    pendingBundles.set(key, bundle);
  }

  if (messageId && !bundle.messageIds.includes(messageId)) {
    bundle.messageIds.push(messageId);
  }

  // If there was uncaptioned media buffered recently for this sender, attach it!
  if (recentUncaptionedMedia.has(key)) {
    const cached = recentUncaptionedMedia.get(key);
    clearTimeout(cached.timer);
    recentUncaptionedMedia.delete(key);
    bundle.media.push(...cached.media);
    bundle.messageIds.push(...cached.messageIds);
  }

  if (details) {
    bundle.media.push(details);
  }

  if (cleanText) {
    if (!bundle.texts.includes(cleanText)) {
      bundle.texts.push(cleanText);
    }
  }

  if (bundle.timer) clearTimeout(bundle.timer);

  // For complete single-photo posts with price, debounce 2.5s; otherwise normal 4s
  const debounceMs = (details && msgHasPrice) ? 2_500 : bundleWindowMs;

  bundle.timer = setTimeout(async () => {
    pendingBundles.delete(key);
    await flushBundle(bundle, sock);
  }, debounceMs);
}

async function onMessage(sock, message) {
  const remoteJid = message?.key?.remoteJid;
  if (!remoteJid) return;
  const isFromMe = Boolean(message?.key?.fromMe);
  const text = messageText(message);

  if (remoteJid.endsWith('@s.whatsapp.net')) {
    if (isFromMe) return;
    const command = text.toUpperCase();
    if (!['SOLD', 'DELETE'].includes(command)) return;
    try {
      const result = await api.sellerCommand({ senderJid: remoteJid, command });
      await sendSellerCommandResult(sock, remoteJid, command, result);
    } catch (error) {
      console.error('[Seller command]', error?.message || error);
      await sock.sendMessage(remoteJid, { text: 'I could not update that listing right now. Please try again shortly.' }).catch(() => {});
    }
    return;
  }

  if (!remoteJid.endsWith('@g.us')) return;
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

  const myPhone = sock?.user?.id ? sock.user.id.split(':')[0] : '';
  const myJid = myPhone ? `${myPhone}@s.whatsapp.net` : '';
  const senderJid = isFromMe
    ? (myJid || message?.key?.participant || remoteJid)
    : (message?.key?.participant || remoteJid);

  const details = mediaDetails(message);

  console.info(`[Vision Message] In ${remoteJid} from ${senderJid} (hasMedia: ${Boolean(details)}, fromMe: ${isFromMe}): "${text.slice(0, 50).replace(/\n/g, ' ')}"`);

  let mediaBuffer = null;
  if (details) {
    try {
      mediaBuffer = await downloadMediaMessage({ message: unwrapMessage(message) }, 'buffer', {}, { logger: pino({ level: 'silent' }) });
    } catch {
      try {
        mediaBuffer = await downloadMediaMessage(message, 'buffer', {}, { logger: pino({ level: 'silent' }) });
      } catch (err) {
        console.error('[Vision Media download]', err?.message || err);
      }
    }
  }

  const itemDetails = mediaBuffer ? {
    buffer: mediaBuffer,
    kind: details.kind,
    mimeType: details.media?.mimetype || '',
  } : null;

  queueListingItem({
    groupJid: remoteJid,
    senderJid,
    messageId: message.key?.id,
    details: itemDetails,
    text,
    sock,
  });
}

async function startVisionCollector() {
  try {
    await refreshTargetGroups(true);
  } catch (error) {
    console.warn('[Vision Groups] Started without approved-group list:', error?.message || error);
  }

  const sessionDir = process.env.SESSION_DIR || './wa_vision_auth_session';
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const phoneNumber = (process.env.WHATSAPP_PHONE_NUMBER || '').replace(/\D/g, '');

  const sock = makeWASocket({
    logger: pino({ level: 'silent' }),
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: true,
    syncFullHistory: false,
    getMessage: async (key) => {
      const msg = messageStore.get(key.id);
      return msg?.message || undefined;
    },
  });
  sock.ev.on('creds.update', saveCreds);

  if (phoneNumber && !state.creds.registered) {
    setTimeout(async () => {
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
      console.log('BUYSELL WhatsApp Vision Collector (Bot 2) is active and monitoring groups.');
      sock.sendPresenceUpdate('available').catch(() => {});
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = code === DisconnectReason.loggedOut;
      const reconnect = !isLoggedOut;
      console.warn(`[Bot 2] WhatsApp connection closed (${code || 'unknown'}). Reconnect: ${reconnect}`);
      if (isLoggedOut) {
        console.warn('[Session] Session unlinked. Resetting session directory for fresh pairing.');
        try { rmSync(sessionDir, { recursive: true, force: true }); } catch {}
      }
      try { sock.ws?.close(); } catch {}
      if (reconnect) setTimeout(startVisionCollector, 3_000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return;
    for (const message of messages) {
      saveMessage(message);
      await onMessage(sock, message);
    }
  });
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
