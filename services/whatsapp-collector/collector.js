import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import 'dotenv/config';
import { BuySellListingsApi } from './buysell-api.js';

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

function cleanPhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 11) {
    digits = '234' + digits.slice(1);
  }
  return digits;
}

function formatMoney(amount) {
  return `₦${Number(amount || 0).toLocaleString('en-NG')}`;
}

function buildAdminSaleAlert(sale) {
  const sellerNum = cleanPhone(sale.seller_phone);
  const waLink = sellerNum ? `https://wa.me/${sellerNum}` : 'No phone provided';
  const orderShort = String(sale.order_id || '').slice(0, 8);

  return [
    '🚨 *NEW ORDER: WHATSAPP ITEM PURCHASED!* 🛍️',
    '',
    `📦 *Product:* ${sale.product_name || 'Marketplace Item'}`,
    `💰 *Amount Paid by Buyer:* ${formatMoney(sale.paid_price)}`,
    `🧾 *Order ID:* #${orderShort}`,
    '',
    '📍 *WHERE BOT 2 COLLECTED THIS:*',
    `👥 *Group Name:* ${sale.group_name || 'Seller Group'}`,
    `🆔 *Group ID:* \`${sale.group_jid || 'unknown'}\``,
    sale.source_price ? `💵 *Original Stated Price:* ${formatMoney(sale.source_price)}` : '',
    sellerNum ? `📱 *Original Seller Phone:* +${sellerNum}` : '',
    sellerNum ? `💬 *Tap to Chat with Seller:*\n${waLink}` : '',
    '',
    '🚚 *DELIVERY DETAILS:*',
    `👤 *Buyer Name:* ${sale.delivery_name || 'Customer'}`,
    sale.delivery_phone ? `📞 *Buyer Phone:* ${sale.delivery_phone}` : '',
    sale.delivery_address ? `🏠 *Delivery Address:* ${sale.delivery_address}` : '',
    '',
    '👉 *Next Step:* Tap the seller link above to confirm availability and purchase the item for delivery!',
  ].filter(Boolean).join('\n');
}

let activeSock = null;

async function checkAndNotifySales() {
  if (!activeSock) return;
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

async function startDispatcher() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    logger: pino({ level: 'silent' }),
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: true,
    syncFullHistory: false,
  });
  activeSock = sock;

  sock.ev.on('creds.update', saveCreds);

  if (phoneNumber && !state.creds.registered) {
    setTimeout(async () => {
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
        console.error('[Bot 1] Failed to request pairing code:', err?.message || err);
      }
    }, 3000);
  }

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr && !phoneNumber) {
      console.log('[BOT 1 DISPATCHER] Scan QR code to link:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      console.log(`BUYSELL Admin Dispatcher (Bot 1) is ACTIVE. Admin alert target: +${adminPhoneNumber}`);
      sock.sendPresenceUpdate('available').catch(() => {});
      // Check for sales immediately upon connection
      checkAndNotifySales().catch(() => {});
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = code === DisconnectReason.loggedOut;
      const reconnect = !isLoggedOut;
      console.warn(`[Bot 1] WhatsApp connection closed (${code || 'unknown'}). Reconnect: ${reconnect}`);
      if (isLoggedOut) {
        console.warn('[Session] Session logged out. Resetting session directory.');
        try { rmSync(sessionDir, { recursive: true, force: true }); } catch {}
      }
      try { sock.ws?.close(); } catch {}
      activeSock = null;
      if (reconnect) setTimeout(startDispatcher, 3_000);
    }
  });

  // Handle direct commands from Admin (e.g. text STATUS, TEST, CHECK)
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return;
    for (const msg of messages) {
      const remoteJid = msg?.key?.remoteJid;
      // ONLY respond to 1-on-1 direct messages, NEVER group messages
      if (!remoteJid || !remoteJid.endsWith('@s.whatsapp.net')) return;

      const text = (msg?.message?.conversation || msg?.message?.extendedTextMessage?.text || '').trim().toUpperCase();
      if (!text) return;

      if (text === 'STATUS' || text === 'PING') {
        const uptimeMin = Math.round(process.uptime() / 60);
        await sock.sendMessage(remoteJid, {
          text: `✅ *BUYSELL Admin Dispatcher is Online*\n\n⏱️ *Uptime:* ${uptimeMin} minutes\n📱 *Admin Alert Target:* +${adminPhoneNumber}\n📦 *Sales Alerts Sent:* ${notifiedSales.size}\n\nSend *CHECK* to manually scan for new orders.`
        }).catch(() => {});
      } else if (text === 'CHECK') {
        await sock.sendMessage(remoteJid, { text: '🔍 Scanning for new WhatsApp sales...' }).catch(() => {});
        await checkAndNotifySales();
      } else if (text === 'TEST') {
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
        await sock.sendMessage(remoteJid, { text: testAlert }).catch(() => {});
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
          if (payload && activeSock) {
            const message = buildAdminSaleAlert(payload);
            const targetJid = `${adminPhoneNumber}@s.whatsapp.net`;
            await activeSock.sendMessage(targetJid, { text: message });
          }
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
      alerts_sent: notifiedSales.size,
      uptime: Math.round(process.uptime()),
    }));
  });

  server.listen(port, () => {
    console.info(`[HTTP] Admin Dispatcher health check listening on port ${port}`);
  });
}

startDispatcher().catch(err => {
  console.error('[Bot 1] Failed to start:', err?.message || err);
  process.exitCode = 1;
});
