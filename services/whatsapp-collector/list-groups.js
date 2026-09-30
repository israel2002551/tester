import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

async function listGroups() {
  const { state, saveCreds } = await useMultiFileAuthState('./wa_auth_session');
  const sock = makeWASocket({
    logger: pino({ level: 'silent' }),
    auth: state,
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\nScan this QR code with WhatsApp:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      console.log('\nConnected to WhatsApp!\n');

      // Check if an invite link was provided as a CLI argument
      const inviteArg = process.argv.slice(2).find((arg) => arg.includes('chat.whatsapp.com'));
      if (inviteArg) {
        const code = inviteArg.split('/').pop().trim();
        try {
          const info = await sock.groupGetInviteInfo(code);
          const jid = info.id.endsWith('@g.us') ? info.id : `${info.id}@g.us`;
          console.log('------------------------------------------------------------');
          console.log(`Invite Link Resolved:`);
          console.log(`  Group Name: ${info.subject}`);
          console.log(`  Group ID:   ${jid}`);
          console.log('------------------------------------------------------------\n');
        } catch (err) {
          console.error(`Could not resolve invite link:`, err.message || err);
        }
      }

      console.log('Fetching all groups for this account...\n');
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
          console.log('Copy the Group ID (ending in @g.us) and add it in Super Admin -> WhatsApp.');
        }
      } catch (err) {
        console.error('Failed to fetch groups:', err.message || err);
      }

      process.exit(0);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        console.error('WhatsApp session logged out. Please remove ./wa_auth_session and rescan.');
        process.exit(1);
      }
    }
  });
}

listGroups().catch((err) => {
  console.error('Error:', err?.message || err);
  process.exit(1);
});
