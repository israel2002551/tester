import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import express from 'express';
import qrcode from 'qrcode-terminal';

const app = express();
app.use(express.json());

let sock = null;

async function connectToWhatsApp() {
    // Saves auth credentials locally so you only scan the QR code once!
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true // Generates the scanner canvas in your terminal window
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to ', lastDisconnect?.error, ', reconnecting: ', shouldReconnect);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('🚀 BUYSELL WhatsApp Bridge is officially online and linked!');
        }
    });
}

// REST Endpoint that your Supabase Deno function will talk to
app.post('/send-alert', async (req, res) => {
    const { to, name, message, chatPartnerId } = req.body;

    if (!sock) return res.status(503).json({ error: 'WhatsApp client not initialized yet' });

    try {
        const formattedJid = `${to}@s.whatsapp.net`;
        const textTemplate = `✉️ *New Message on BUYSELL Nigeria!*\n\nYou received a new message from *${name}* regarding your listing.\n\n*Message:* "${message}"\n\n👉 *Reply instantly here:* https://buysell-markerplace.com?chat=${chatPartnerId}`;
        
        await sock.sendMessage(formattedJid, { text: textTemplate });
        return res.json({ success: true, message: 'Notification transmitted successfully' });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server monitoring endpoint pipelines on port ${PORT}`);
    connectToWhatsApp();
});
