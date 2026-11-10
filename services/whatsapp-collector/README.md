# BUYSELL WhatsApp Listing Collector (Render 24/7 Deployment)

This repository contains the standalone, cloud-ready WhatsApp Collector worker for **BUYSELL Nigeria**. It monitors approved WhatsApp groups in real time, uses Groq AI (Llama 3.3 70B) to parse commercial sale posts, uploads attached photos and videos to Cloudinary, and automatically imports listings into BUYSELL Supabase tables.

---

## Deploying to Render.com (Step-by-Step)

### Step 1: Create a New Web Service on Render
1. Log in to [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** → **Web Service** (Free tier supported).
3. Connect your GitHub account and select this repository: `israel2002551/whatsapp_com`.
4. Configure the basic settings:
   - **Name**: `buysell-whatsapp-collector`
   - **Region**: Choose the closest region (e.g. Frankfurt or Oregon)
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`

---

### Step 2: Configure Environment Variables

Under the **Environment Variables** section on Render, add these keys:

| Key | Example / Description |
|---|---|
| `SUPABASE_URL` | `https://obzhlmzswthnorkiqemh.supabase.co` |
| `SUPABASE_ANON_KEY` | Your Supabase anon/publishable key |
| `WHATSAPP_INGEST_SECRET` | Secret shared with the `whatsapp-listing-action` Supabase Edge Function |
| `CLOUDINARY_CLOUD_NAME` | Your Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Your Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Your Cloudinary API secret |
| `GROQ_API_KEY` | Your Groq API key (`gsk_...` from [console.groq.com](https://console.groq.com/keys)) |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` |
| `PUBLIC_SITE_URL` | `https://your-buysell-domain.example` |
| `WHATSAPP_PHONE_NUMBER` | Your WhatsApp phone number (e.g. `2349061484256`) to receive a pairing code |
| `NODE_VERSION` | `20.18.0` |

---

### Step 3: Link Your WhatsApp Account via Render Logs

1. Click **Deploy Web Service**.
2. Once the build finishes, open the **Logs** tab on Render.
3. Because you provided `WHATSAPP_PHONE_NUMBER`, you will see:
   ```text
   ============================================================
   YOUR WHATSAPP PAIRING CODE: ABCD-1234
   ============================================================
   ```
4. On your phone:
   - Open WhatsApp → **Settings** (or 3 dots) → **Linked Devices**.
   - Tap **"Link a device"**.
   - Tap **"Link with phone number instead"** at the bottom.
   - Enter the 8-character code shown in your Render logs.
5. As soon as linked, your Render service logs will show:
   ```text
   [Groups] Monitoring approved WhatsApp groups.
   BUYSELL WhatsApp collector is monitoring approved groups.
   ```

### If the code is refused: link by QR code from your computer

WhatsApp can refuse phone-number codes ("Couldn’t link device"). Linking by QR code from your own computer works, and keeping the session in Supabase stops redeploys from unlinking the bot:

1. Suspend Bot 1 on Render so only one copy uses the session.
2. In this folder, with your `.env` in place, run `npm run pair-qr`. A page with a QR code opens in your browser.
3. On the phone, in the WhatsApp account Bot 1 should use, go to **Settings → Linked devices → Link a device** and scan the code. The script saves the session to `SESSION_DIR` and stops.
4. Upload it for Render with `node upload-session.js --replace`. Your `.env` needs `WHATSAPP_AUTH_SESSION_ID=bot1` and the same `WHATSAPP_AUTH_ENCRYPTION_KEY` as Render.
5. On Render, set `WHATSAPP_AUTH_STORE=supabase`, `WHATSAPP_AUTH_SESSION_ID=bot1` and that key, then resume the service.

---

## Health Check Endpoint
The service starts a lightweight HTTP server on `PORT` responding with `200 OK` at `/`, ensuring Render's health checks pass and keep the worker running continuously.

---

## Approved Groups Management
Group IDs are managed from the BUYSELL Super Admin portal (**Super Admin** → **WhatsApp**). The cloud collector refreshes the allow-list automatically every 60 seconds without requiring a redeployment or restart.