import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { rmSync, existsSync } from 'node:fs';

const sessionDir = './wa_auth_session';

function clearSession() {
  if (existsSync(sessionDir)) {
    try {
      rmSync(sessionDir, { recursive: true, force: true });
    } catch {}
  }
}

// Check arguments
const phoneArgIndex = process.argv.findIndex((arg) => arg === '--phone' || arg === '-p');
const phoneNumber = phoneArgIndex !== -1 ? process.argv[phoneArgIndex + 1]?.replace(/\D/g, '') : null;
const resetArg = process.argv.includes('--reset');

if (resetArg || (phoneNumber && process.argv.includes('--force'))) {
  clearSession();
}

async function start() {
  let authState;
  try {
    authState = await useMultiFileAuthState(sessionDir);
  } catch {
    clearSession();
    authState = await useMultiFileAuthState(sessionDir);
  }

  const { state, saveCreds } = authState;

  const sock = makeWASocket({
    logger: pino({ level: 'silent' }),
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  // If a phone number is provided and we are not registered, request pairing code
  if (phoneNumber && !state.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phoneNumber);
        const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
        console.log('\n============================================================');
        console.log(`YOUR WHATSAPP PAIRING CODE: ${formatted}`);
        console.log('============================================================');
        console.log('On your phone:');
        console.log('1. Open WhatsApp -> Settings -> Linked Devices');
        console.log('2. Tap "Link a device"');
        console.log('3. Tap "Link with phone number instead" at the bottom');
        console.log(`4. Enter code: ${formatted}\n`);
      } catch (err) {
        console.error('Failed to request pairing code:', err?.message || err);
      }
    }, 2500);
  }

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr && !phoneNumber && !state.creds.registered) {
      console.log('\nScan this QR code with WhatsApp:\n');
      qrcode.generate(qr, { small: true });
      console.log('(Tip: If scanning fails, you can link with your phone number:');
      console.log(' node list-groups.js --phone 234XXXXXXXXXX "YOUR_INVITE_URL")\n');
    }

    if (connection === 'open') {
      console.log('\nConnected to WhatsApp!\n');

      // Check if an invite link was provided as a CLI argument
      const inviteArg = process.argv.slice(2).find((arg) => arg.includes('chat.whatsapp.com'));
      if (inviteArg) {
        const cleanUrl = inviteArg.split('?')[0].split('#')[0].trim();
        const code = cleanUrl.split('/').pop().trim();
        try {
          const info = await sock.groupGetInviteInfo(code);
          const jid = info.id.endsWith('@g.us') ? info.id : `${info.id}@g.us`;
          console.log('============================================================');
          console.log(`INVITE LINK RESOLVED:`);
          console.log(`  Group Name: ${info.subject}`);
          console.log(`  Group ID:   ${jid}`);
          console.log('============================================================\n');
        } catch (err) {
          console.error(`Could not resolve invite link:`, err.message || err);
        }
      }

      console.log('Fetching groups for this account...\n');
      try {
        const groups = await sock.groupFetchAllParticipating();
        const groupList = Object.values(groups);

        if (groupList.length === 0) {
          console.log('No groups found for this WhatsApp account.');
        } else {
          console.log('--------------------------------------------------------------------------------');
          console.log('GROUP NAME                                   | GROUP ID');
          console.log('--------------------------------------------------------------------------------');
          for (const g of groupList) {
            const name = (g.subject || 'Unnamed Group').padEnd(42, ' ').slice(0, 42);
            const id = g.id.endsWith('@g.us') ? g.id : `${g.id}@g.us`;
            console.log(`${name} | ${id}`);
          }
          console.log('--------------------------------------------------------------------------------\n');
          console.log('Copy the Group ID (ending in @g.us) and paste it in Super Admin -> WhatsApp.');
        }
      } catch (err) {
        console.error('Failed to fetch groups:', err.message || err);
      }

      process.exit(0);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;

      if (isLoggedOut) {
        console.log('\nWhatsApp session was unlinked or logged out. Resetting session...');
        clearSession();
        console.log('Old session cleared. Please run the command again with --phone to get a fresh code.\n');
        process.exit(1);
      } else {
        // Normal restart/reconnect (e.g. 515 restart after initial pair)
        setTimeout(start, 2000);
      }
    }
  });
}

start().catch((err) => {
  console.error('Error starting WhatsApp connection:', err?.message || err);
  process.exit(1);
});
