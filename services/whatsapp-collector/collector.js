import makeWASocket, {
  Browsers,
  DisconnectReason,
  extractMessageContent,
  fetchLatestWaWebVersion,
  normalizeMessageContent,
} from '@whiskeysockets/baileys';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import 'dotenv/config';
import { BuySellListingsApi } from './buysell-api.js';
import { buildAdminSaleAlert } from './sale-alert.js';
import { openAuthState } from './auth-store.js';

const api = new BuySellListingsApi();
const phoneNumber = (process.env.WHATSAPP_PHONE_NUMBER || '2348080302256').replace(/\D/g, '');
const adminPhoneNumber = (process.env.ADMIN_PHONE_NUMBER || phoneNumber).replace(/\D/g, '');
const sessionDir = process.env.SESSION_DIR || './wa_admin_dispatcher_session';
const cacheFile = './notified_sales.json';

// Keep track of notified orders to prevent duplicates
const notifiedSales = new Set();
try {
  if (existsSync(cacheFile)) {
    const raw = JSON.parse(readFileSync(cacheFile, 'utf8') || '[]');
    if (Array.isArray(raw)) raw.forEach(id => notifiedSales.add(id));
  }
} catch {}

function saveNotifiedSale(saleKey) {
  notifiedSales.add(saleKey);
  try {
    writeFileSync(cacheFile, JSON.stringify(Array.from(notifiedSales).slice(-500)), 'utf8');
  } catch {}
}

// In-memory message store to satisfy Baileys retry requests and avoid signal session desync
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

function unwrapMessage(msg) {
  let m = msg?.message || msg;
  if (!m) return {};
  while (m?.ephemeralMessage || m?.viewOnceMessage || m?.viewOnceMessageV2 || m?.documentWithCaptionMessage) {
    m = m?.ephemeralMessage?.message
      || m?.viewOnceMessage?.message
      || m?.viewOnceMessageV2?.message
      || m?.documentWithCaptionMessage?.message;
  }
  try {
    m = normalizeMessageContent(m) || m;
    m = extractMessageContent(m) || m;
  } catch {}
  return m || {};
}

function extractText(msg) {
  const m = unwrapMessage(msg);
  return String(
    m?.conversation
    || m?.extendedTextMessage?.text
    || m?.imageMessage?.caption
    || m?.videoMessage?.caption
    || m?.documentMessage?.caption
    || m?.buttonsResponseMessage?.selectedButtonId
    || m?.templateButtonReplyMessage?.selectedId
    || m?.listResponseMessage?.singleSelectReply?.selectedRowId
    || ''
  ).trim();
}

let activeSock = null;
let whatsappConnected = false;

async function checkAndNotifySales() {
  // A socket is created before WhatsApp has accepted its credentials. Do not
  // attempt to deliver alerts during pairing or a reconnect, because Baileys
  // will reject the send and leave the order looking like a delivery failure.
  if (!activeSock || !whatsappConnected) return;
  try {
    const result = await api.getOrderWhatsAppSales();
    const sales = Array.isArray(result?.sales) ? result.sales : [];
    if (!sales.length) return;

    for (const sale of sales) {
      const saleKey = `${sale.order_id}:${sale.product_id}`;
      if (notifiedSales.has(saleKey)) continue;

      const message = buildAdminSaleAlert(sale);
      const targetJid = `${adminPhoneNumber}@s.whatsapp.net`;

      console.info(`[Admin Dispatcher] Sending sale alert to ${targetJid} for Order #${sale.order_id}...`);
      await activeSock.sendMessage(targetJid, { text: message });
      saveNotifiedSale(saleKey);
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch (err) {
    // Edge function might be pending migration or orders empty
    if (!err?.message?.includes('404')) {
      console.warn('[Admin Dispatcher] Order check:', err?.message || err);
    }
  }
}

// The WhatsApp Web version bundled with Baileys goes stale between releases.
// WhatsApp still opens the socket for an outdated client but rejects the
// phone-number link step ("Couldn't link device"), so use the live version.
let cachedWaWebVersion = null;
async function resolveWaWebVersion() {
  try {
    const { version, isLatest } = await fetchLatestWaWebVersion({ timeout: 10_000 });
    if (isLatest && Array.isArray(version)) cachedWaWebVersion = version;
  } catch (error) {
    console.warn('[Bot 1] Could not fetch the latest WhatsApp Web version:', error?.message || error);
  }
  return cachedWaWebVersion || undefined;
}

// When another copy takes over the connection (code 440), it is usually the new
// copy started by a deploy while this one still runs. Reconnecting at once makes
// the two fight over one session until WhatsApp logs the device out, so wait.
const REPLACED_RETRY_MS = 3 * 60_000;
let activeAuth = null;

function restartDispatcher(delayMs) {
  setTimeout(() => {
    startDispatcher().catch(error => {
      console.error('[Bot 1] Could not restart the WhatsApp connection:', error?.message || error);
      restartDispatcher(30_000);
    });
  }, delayMs);
}

async function startDispatcher() {
  // WHATSAPP_AUTH_STORE=supabase keeps the session in Supabase, so redeploys don't
  // unlink the bot; otherwise it lives in SESSION_DIR (lost on Render's free disk).
  const auth = await openAuthState({ api, sessionDir });
  activeAuth = auth;
  console.info(`[Session] WhatsApp session stored in ${auth.description}.`);
  const { state, saveCreds } = auth;
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
    shouldIgnoreJid: (jid) => jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter'),
    getMessage: async (key) => {
      const msg = messageStore.get(key.id);
      return msg?.message || undefined;
    },
  });
  activeSock = sock;
  let pairingCodeRequestedOnSocket = false;

  sock.ev.on('creds.update', saveCreds);

  async function requestPairingCode() {
    try {
      const code = await sock.requestPairingCode(phoneNumber);
      const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
      console.log('\n============================================================');
      console.log(`[BOT 1 DISPATCHER] PAIRING CODE FOR ${phoneNumber}: ${formatted}`);
      console.log('============================================================');
      console.log(`On your phone (${phoneNumber}):`);
      console.log('1. Open WhatsApp -> Settings -> Linked Devices');
      console.log('2. Tap "Link a device" -> "Link with phone number instead"');
      console.log(`3. Enter code: ${formatted}\n`);
    } catch (err) {
      // Allow a later QR-ready event from this socket to retry the request.
      pairingCodeRequestedOnSocket = false;
      console.error('[Bot 1] Failed to request pairing code:', err?.message || err);
    }
  }

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    // Baileys emits a QR reference even when phone-number pairing is selected.
    // Waiting for it matters: requesting a code on a fixed startup timer can
    // produce a code that WhatsApp displays but subsequently refuses.
    if (qr && phoneNumber && !state.creds.registered && !pairingCodeRequestedOnSocket) {
      pairingCodeRequestedOnSocket = true;
      void requestPairingCode();
    }

    if (qr && !phoneNumber) {
      console.log('[BOT 1 DISPATCHER] Scan QR code to link:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      if (activeSock !== sock) return;
      whatsappConnected = true;
      console.log(`BUYSELL Admin Dispatcher (Bot 1) is ACTIVE. Admin alert target: +${adminPhoneNumber}`);
      sock.sendPresenceUpdate('available').catch(() => {});
      // Check for sales immediately upon connection
      checkAndNotifySales().catch(() => {});
    }
    if (connection === 'close') {
      if (activeSock !== sock) return;
      const code = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = code === DisconnectReason.loggedOut;
      const isReplaced = code === DisconnectReason.connectionReplaced;
      console.warn(`[Bot 1] WhatsApp connection closed (${code || 'unknown'}).`);
      try { sock.ws?.close(); } catch {}
      activeSock = null;
      whatsappConnected = false;
      if (isLoggedOut) {
        // Unlinked: start over with a fresh session and a new pairing code.
        console.warn('[Session] Session logged out. Clearing it and requesting a new pairing code.');
        auth.clear()
          .catch(error => console.error('[Session] Could not clear the stored session:', error?.message || error))
          .finally(() => restartDispatcher(3_000));
        return;
      }
      if (isReplaced) {
        console.warn(`[Bot 1] Another copy of Bot 1 took over the WhatsApp connection. Reconnecting in ${REPLACED_RETRY_MS / 60_000} minutes.`);
      }
      restartDispatcher(isReplaced ? REPLACED_RETRY_MS : 3_000);
    }
  });

  // Handle direct commands from Admin (e.g. text STATUS, TEST, CHECK, HELP)
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return;
    for (const msg of messages) {
      saveMessage(msg);

      const remoteJid = msg?.key?.remoteJid;
      if (!remoteJid) continue;

      // Ignore group chats and broadcast channels
      if (remoteJid.endsWith('@g.us') || remoteJid.includes('@broadcast')) continue;

      const rawText = extractText(msg);
      if (!rawText) continue;

      const isFromMe = Boolean(msg?.key?.fromMe);
      const myPhone = sock?.user?.id ? sock.user.id.split(':')[0] : '';
      const myJid = myPhone ? `${myPhone}@s.whatsapp.net` : '';

      // If from the bot's own linked phone, only respond if it was sent to self (e.g. Note to self or testing)
      if (isFromMe && remoteJid !== myJid && !remoteJid.startsWith(myPhone)) {
        continue;
      }

      // Avoid infinite response loops if bot replies to its own messages
      if (isFromMe && (rawText.startsWith('✅') || rawText.startsWith('🤖') || rawText.startsWith('🚨') || rawText.startsWith('🔍'))) {
        continue;
      }

      console.info(`[Bot 1] Received direct message from ${remoteJid} (fromMe: ${isFromMe}): "${rawText}"`);

      // Clean command: strip leading slashes/dots/exclamations, trim, and uppercase
      const cmd = rawText.replace(/^[/!#.]\s*/, '').trim().toUpperCase();

      if (cmd === 'STATUS' || cmd === 'PING') {
        const uptimeMin = Math.round(process.uptime() / 60);
        const reply = `✅ *BUYSELL Admin Dispatcher is Online*\n\n⏱️ *Uptime:* ${uptimeMin} minutes\n📱 *Admin Alert Target:* +${adminPhoneNumber}\n📦 *Sales Alerts Sent:* ${notifiedSales.size}\n\nSend *CHECK* to manually scan for new orders.`;
        await sock.sendMessage(remoteJid, { text: reply })
          .then(() => console.info(`[Bot 1] Sent STATUS reply to ${remoteJid}`))
          .catch(err => console.error(`[Bot 1] Failed to send STATUS reply to ${remoteJid}:`, err?.message || err));
      } else if (cmd === 'CHECK') {
        await sock.sendMessage(remoteJid, { text: '🔍 Scanning for new WhatsApp sales...' })
          .catch(err => console.error(`[Bot 1] Failed to send CHECK ack:`, err?.message || err));
        await checkAndNotifySales();
      } else if (cmd === 'TEST') {
        const testAlert = buildAdminSaleAlert({
          order_id: 'TEST-ORD-001',
          product_name: 'iPhone 13 128GB (Sample Alert)',
          paid_price: 455000,
          source_price: 450000,
          group_name: 'Lagos Tech Hub',
          group_jid: '120363176089818281@g.us',
          seller_phone: '2349061484256',
          delivery_name: 'Test Buyer',
          delivery_phone: '08012345678',
          delivery_address: '12 Marina Road, Lagos',
        });
        await sock.sendMessage(remoteJid, { text: testAlert })
          .then(() => console.info(`[Bot 1] Sent TEST alert to ${remoteJid}`))
          .catch(err => console.error(`[Bot 1] Failed to send TEST alert:`, err?.message || err));
      } else {
        const helpMenu = [
          '🤖 *BUYSELL Admin Dispatcher (Bot 1)*',
          '',
          'I am online and monitoring confirmed marketplace orders 24/7.',
          '',
          '*Available Commands:*',
          '• *STATUS* — View bot uptime & stats',
          '• *TEST* — Preview a sample sale alert',
          '• *CHECK* — Scan database for pending sales',
          '• *PING* — Instant heartbeat check',
        ].join('\n');
        await sock.sendMessage(remoteJid, { text: helpMenu })
          .then(() => console.info(`[Bot 1] Sent Help menu to ${remoteJid}`))
          .catch(err => console.error(`[Bot 1] Failed to send Help menu:`, err?.message || err));
      }
    }
  });
}

// Background poller: Checks for new confirmed sales every 20 seconds
setInterval(() => {
  checkAndNotifySales().catch(() => {});
}, 20_000);

// HTTP Server for UptimeRobot keep-alive and manual webhook dispatch
const port = process.env.PORT || null;
if (port) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/notify-sale') {
      let bodyStr = '';
      req.on('data', chunk => { bodyStr += chunk; });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(bodyStr || '{}');
          if (!activeSock || !whatsappConnected) {
            res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '20' });
            res.end(JSON.stringify({ status: 'not_connected', error: 'WhatsApp is still pairing or reconnecting.' }));
            return;
          }
          const message = buildAdminSaleAlert(payload);
          const targetJid = `${adminPhoneNumber}@s.whatsapp.net`;
          await activeSock.sendMessage(targetJid, { text: message });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'sent' }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'buysell-admin-dispatcher',
      admin_phone: adminPhoneNumber,
      whatsapp_connected: whatsappConnected,
      alerts_sent: notifiedSales.size,
      uptime: Math.round(process.uptime()),
    }));
  });

  server.listen(port, () => {
    console.info(`[HTTP] Admin Dispatcher health check listening on port ${port}`);
  });
}

// Render stops the old copy with SIGTERM during a deploy: save the session, then exit.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.info(`[Bot 1] ${signal} received; saving the WhatsApp session and stopping.`);
    try {
      activeSock?.ev?.removeAllListeners?.();
      activeSock?.ws?.close();
    } catch {}
    Promise.race([
      Promise.resolve(activeAuth?.flush?.()).catch(() => {}),
      new Promise(resolve => setTimeout(resolve, 8_000)),
    ]).finally(() => process.exit(0));
  });
}

startDispatcher().catch(err => {
  console.error('[Bot 1] Failed to start:', err?.message || err);
  process.exitCode = 1;
});
