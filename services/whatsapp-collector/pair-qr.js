// Links this bot to WhatsApp by scanning a QR code, from this computer, and
// saves the session in SESSION_DIR. Then copy it to Supabase for Render with:
//   npm run upload-session -- --replace
// Stop every other copy of this bot first (suspend it on Render, and stop any
// local `npm start`).
//
// Usage: node pair-qr.js   (a page with the QR code opens in your browser)
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { exec } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import pino from 'pino';
import 'dotenv/config';

const require = createRequire(import.meta.url);
const QRCode = require('qrcode-terminal/vendor/QRCode');
const { L } = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');

const isBot2 = JSON.parse(readFileSync('./package.json', 'utf8')).name === 'buysell-whatsapp-vision-collector';
const botName = isBot2 ? 'Bot 2' : 'Bot 1';
const sessionDir = process.env.SESSION_DIR || (isBot2 ? './wa_vision_auth_session' : './wa_admin_dispatcher_session');
const pageFile = resolve('./pairing-qr.html');

function qrSvg(text) {
  const qr = new QRCode(-1, L);
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const cell = 8;
  const quiet = 4;
  const size = (count + quiet * 2) * cell;
  let squares = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) squares += `<rect x="${(col + quiet) * cell}" y="${(row + quiet) * cell}" width="${cell}" height="${cell}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#fff"/><g fill="#000">${squares}</g></svg>`;
}

function writePage(body, refreshSeconds = 3) {
  writeFileSync(pageFile, `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="${refreshSeconds}">
<title>Link ${botName}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#e2e8f0;font-family:system-ui,sans-serif;text-align:center}main{max-width:520px;padding:24px}svg{width:min(80vw,380px);height:auto;border-radius:12px}p{line-height:1.5}small{color:#94a3b8}</style>
</head><body><main>${body}</main></body></html>`);
}

let pageOpened = false;
function showQr(qr) {
  writePage(`<h1>Link ${botName} to WhatsApp</h1>${qrSvg(qr)}
<p>On the phone, open the WhatsApp account ${botName} should use, then <b>Settings → Linked devices → Link a device</b> and scan this code.</p>
<small>The code changes every few seconds and this page follows it.</small>`);
  if (!pageOpened) {
    pageOpened = true;
    exec(`start "" "${pageFile}"`);
    console.log(`Opened ${pageFile} in your browser. Scan the QR code from WhatsApp > Linked devices > Link a device.`);
  }
}

// An earlier, unfinished pairing attempt is set aside (not deleted) so the QR
// starts from fresh keys.
function setAsideUnlinkedSession() {
  const credsFile = join(sessionDir, 'creds.json');
  if (!existsSync(credsFile)) return;
  const creds = JSON.parse(readFileSync(credsFile, 'utf8'));
  if (creds.me && creds.registered) {
    console.log(`${sessionDir} already holds a linked session for +${String(creds.me.id).split(':')[0]}.`);
    console.log('Upload it with: npm run upload-session -- --replace');
    process.exit(0);
  }
  const aside = `${sessionDir}.unlinked-${Date.now()}`;
  renameSync(sessionDir, aside);
  console.log(`Moved an unlinked earlier attempt to ${aside}.`);
}

async function start() {
  mkdirSync(sessionDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  let version;
  try {
    const latest = await fetchLatestWaWebVersion({ timeout: 10_000 });
    if (latest.isLatest) version = latest.version;
  } catch {}

  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: state,
    // The same identity the bots use, so the linked device matches them.
    browser: Browsers.macOS('Chrome'),
    logger: pino({ level: 'silent' }),
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) showQr(qr);
    if (connection === 'open') {
      const number = String(sock.user?.id || '').split(':')[0];
      // Baileys only marks phone-code links as registered; the bots treat an
      // unregistered session as unlinked and would reset it, so mark it here.
      state.creds.registered = true;
      await saveCreds();
      console.log(`${botName} is linked to +${number}. Saving the session...`);
      writePage(`<h1>${botName} is linked ✓</h1><p>Linked to +${number}. You can close this page.</p>`, 3600);
      setTimeout(async () => {
        await saveCreds();
        try { sock.end(undefined); } catch {}
        console.log('Session saved. Next: npm run upload-session -- --replace');
        process.exit(0);
      }, 15_000);
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.restartRequired) {
        // Normal right after scanning: WhatsApp asks the new device to reconnect.
        await saveCreds();
        void start();
        return;
      }
      if (code === DisconnectReason.loggedOut) {
        console.log('WhatsApp refused the link. Run node pair-qr.js again for a new QR code.');
        process.exit(1);
      }
      console.log(`Connection closed (${code ?? 'unknown'}); getting a new QR code...`);
      setTimeout(() => void start(), 2_000);
    }
  });
}

setAsideUnlinkedSession();
start().catch(error => {
  console.error(error);
  process.exit(1);
});
