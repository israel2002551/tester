import makeWASocket, {
  Browsers,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import 'dotenv/config';

async function main() {
  const sessionDir = process.env.SESSION_DIR || './wa_vision_auth_session';
  const { state } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    logger: pino({ level: 'silent' }),
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
  });

  sock.ev.on('connection.update', async ({ connection }) => {
    if (connection === 'open') {
      console.log('Fetching groups...');
      const groups = await sock.groupFetchAllParticipating();
      console.log(`Found ${Object.keys(groups).length} groups:`);
      for (const [id, meta] of Object.entries(groups)) {
        console.log(`- ${meta.subject} (${id})`);
      }
      process.exit(0);
    }
  });
}

main().catch(console.error);
