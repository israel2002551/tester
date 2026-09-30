import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { createHash, randomBytes } from 'node:crypto';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import 'dotenv/config';
import { parseListingWithGroq, looksLikeSalePost } from './parser.js';
import { uploadWhatsAppMedia } from './cloudinary.js';
import { BuySellListingsApi } from './buysell-api.js';
import { sendSellerCommandResult, sendSellerConfirmation } from './notifier.js';

const api = new BuySellListingsApi();
const targetGroups = new Set();
const reportedUnapprovedGroups = new Set();
const groupRefreshMs = 60_000;
let lastGroupRefreshAt = 0;
let groupRefreshPromise = null;
const mediaQueue = new Map();
const albumDelayMs = 1_500;

/**
 * Approved group IDs are managed from the BUYSELL admin dashboard. Keeping
 * this allow-list on the server means a running collector picks up changes
 * without an environment edit or a code deployment.
 */
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
      console.info(`[Groups] Monitoring ${targetGroups.size} approved WhatsApp group${targetGroups.size === 1 ? '' : 's'}.`);
      return targetGroups;
    })
    .finally(() => {
      groupRefreshPromise = null;
    });
  return groupRefreshPromise;
}

function messageText(message) {
  const content = message?.message || {};
  return String(
    content.conversation
    || content.extendedTextMessage?.text
    || content.imageMessage?.caption
    || content.videoMessage?.caption
    || '',
  ).trim();
}

function mediaDetails(message) {
  const content = message?.message || {};
  if (content.imageMessage) return { kind: 'image', media: content.imageMessage };
  if (content.videoMessage) return { kind: 'video', media: content.videoMessage };
  return null;
}

function sourceId(groupJid, senderJid, messageIds) {
  const identifiers = [...new Set(messageIds.filter(Boolean))].sort().join('|');
  const digest = createHash('sha256').update(`${groupJid}|${senderJid}|${identifiers}`).digest('hex');
  return `wa_${digest}`;
}

function albumBucket(message) {
  const timestamp = message?.messageTimestamp;
  // WhatsApp album messages normally share this timestamp. If it is absent,
  // keep the media isolated rather than risk merging distinct sale posts.
  const stamp = timestamp === undefined || timestamp === null ? message?.key?.id : String(timestamp);
  return stamp || randomBytes(8).toString('hex');
}

function rawPhone(senderJid) {
  const number = String(senderJid || '').split('@')[0].replace(/\D/g, '');
  return number || null;
}

async function processListing(bundle, sock) {
  if (!bundle || !bundle.text || !looksLikeSalePost(bundle.text)) return;
  const parsed = await parseListingWithGroq(bundle.text);
  if (!parsed?.is_commercial_listing) return;
  if (!Number.isFinite(Number(parsed.price)) || Number(parsed.price) <= 0) {
    console.info(`[Skipped] ${bundle.senderJid}: a fixed price was not found.`);
    return;
  }

  const id = sourceId(bundle.groupJid, bundle.senderJid, bundle.messageIds);
  try {
    const media = await Promise.all(bundle.media.map((item, index) => uploadWhatsAppMedia({
      buffer: item.buffer,
      kind: item.kind,
      mimeType: item.mimeType,
      sourceId: id,
      index,
    })));
    const manageToken = randomBytes(32).toString('base64url');
    const listing = await api.ingest({
      source_message_id: id,
      group_jid: bundle.groupJid,
      sender_jid: bundle.senderJid,
      sender_phone: parsed.seller_phone || rawPhone(bundle.senderJid),
      manage_token: manageToken,
      title: parsed.title,
      description: bundle.text,
      price: Number(parsed.price),
      category: parsed.category,
      condition: parsed.condition,
      brand: parsed.brand,
      location: parsed.location,
      specs: parsed.specs,
      negotiable: false,
      media,
    });
    if (!listing.created) {
      console.info(`[Deduplicated] ${id}`);
      return;
    }
    console.info(`[Imported] ${listing.product_id}: ${listing.product?.name || parsed.title}`);
    await sendSellerConfirmation(sock, {
      senderJid: bundle.senderJid,
      listing,
      manageToken,
      publicSiteUrl: process.env.PUBLIC_SITE_URL,
    });
  } catch (error) {
    console.error(`[Listing import] ${bundle.senderJid}:`, error?.message || error);
  }
}

function queueMedia(message, groupJid, senderJid, details, text, sock) {
  const bucket = `${groupJid}:${senderJid}:${albumBucket(message)}`;
  let bundle = mediaQueue.get(bucket);
  if (!bundle) {
    bundle = { groupJid, senderJid, text: '', media: [], messageIds: [], timer: null };
    mediaQueue.set(bucket, bundle);
  }
  bundle.messageIds.push(message.key?.id);
  if (text.length > bundle.text.length) bundle.text = text;
  bundle.media.push(details);
  if (bundle.timer) clearTimeout(bundle.timer);
  bundle.timer = setTimeout(() => {
    mediaQueue.delete(bucket);
    processListing(bundle, sock);
  }, albumDelayMs);
}

async function onMessage(sock, message) {
  const remoteJid = message?.key?.remoteJid;
  if (!remoteJid || message?.key?.fromMe) return;
  const text = messageText(message);

  if (remoteJid.endsWith('@s.whatsapp.net')) {
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
    // Fail closed: a temporary configuration error must never turn into a
    // broad import of every group joined by the collector account.
    console.error('[Group configuration]', error?.message || error);
    return;
  }
  if (!targetGroups.has(remoteJid)) {
    if (!reportedUnapprovedGroups.has(remoteJid)) {
      reportedUnapprovedGroups.add(remoteJid);
      console.info(`[WhatsApp Group Detected] ID: ${remoteJid} (Not in approved list. Add this ID in Super Admin -> WhatsApp to monitor)`);
    }
    return;
  }
  const senderJid = message?.key?.participant || remoteJid;
  const details = mediaDetails(message);
  if (!details) {
    if (!looksLikeSalePost(text)) return;
    await processListing({ groupJid: remoteJid, senderJid, text, media: [], messageIds: [message.key?.id] }, sock);
    return;
  }

  try {
    const buffer = await downloadMediaMessage(message, 'buffer', {}, { logger: pino({ level: 'silent' }) });
    queueMedia(message, remoteJid, senderJid, {
      buffer,
      kind: details.kind,
      mimeType: details.media?.mimetype || '',
    }, text, sock);
  } catch (error) {
    console.error('[Media download]', error?.message || error);
  }
}

async function startCollector() {
  try {
    await refreshTargetGroups(true);
  } catch (error) {
    console.warn('[Group configuration] Collector started without an approved-group list:', error?.message || error);
  }
  const { state, saveCreds } = await useMultiFileAuthState('./wa_auth_session');
  const sock = makeWASocket({
    logger: pino({ level: 'silent' }),
    auth: state,
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('Scan this QR code with the dedicated BUYSELL WhatsApp account:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') console.log('BUYSELL WhatsApp collector is monitoring approved groups.');
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const reconnect = code !== DisconnectReason.loggedOut;
      console.warn(`WhatsApp connection closed (${code || 'unknown'}). Reconnect: ${reconnect}`);
      if (reconnect) setTimeout(startCollector, 2_000);
    }
  });
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const message of messages) await onMessage(sock, message);
  });
}

startCollector().catch(error => {
  console.error('WhatsApp collector failed to start:', error?.message || error);
  process.exitCode = 1;
});
