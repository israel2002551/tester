# BUYSELL WhatsApp Vision Collector (Bot 2) 🤖📸

An intelligent WhatsApp collector bot for **BUYSELL Nigeria** powered by **Groq Multimodal Vision AI (`qwen/qwen3.8-27b`)** and **Baileys**.

---

## 🌟 Key Features

- **Multimodal Visual AI Analysis:** Even if a seller posts an image with **no description** or only a price tag (e.g. `330k`, `₦45,000`, `price: 50k`), the Vision AI inspects the photo, detects the exact item (brand, model, category, specs, condition), and crafts a rich title and description.
- **Complete Media Intake:** Every received image and video is staged before analysis. Images are processed in Groq-safe batches, while videos supply multiple Cloudinary frame previews and an optional audio transcript.
- **Nigerian Price Understanding:** Supports `₦5,500`, `N5500`, `5,500`, `5 500`, `5.5k`, `1.2m`, `price 5500`, and written amounts such as `five thousand five hundred naira`. It never invents a missing price.
- **Durable Listing Queue:** Supabase jobs use leases, retry backoff, idempotent source IDs, and a `needs_price` state, so new uploads keep arriving while Vision and imports are working.
- **Multi-Product Processing:** When a seller posts multiple products at once (via catalog price lists, albums, or successive captioned photos), Bot 2 detects and extracts each product individually and ingests them with distinct indexed IDs instead of squashing them into one item.
- **Clean Descriptions (No Embedded Prices):** Descriptions and titles never include the price, currency signs, or payment figures, ensuring clean product descriptions on the marketplace.
- **20% Dynamic Markup:** Marketplace price automatically includes a 20% platform markup on top of the seller's source price.
- **Smart Follow-Up Buffering:** If a seller posts photos first and sends the price a few seconds later, the bot buffers the photos, joins them with the follow-up price, and processes them as one complete listing.
- **Cloudinary Image Hosting:** Automatically optimizes and uploads WhatsApp images directly to Cloudinary.
- **Direct Marketplace Ingestion:** Publishes approved listings straight into the BUYSELL Supabase catalog.
- **Consolidated Seller Feedback:** Automatically DMs the seller with a consolidated summary of their uploaded products and management links (replying `SOLD` or `DELETE` marks the latest listing sold).
- **Keep-Alive Health Check:** Built-in HTTP server on `PORT` for 24/7 uptime monitoring with UptimeRobot.

---

## 🛠️ Environment Variables

Copy `.env.example` to `.env` and fill in the required keys:

```properties
# Supabase credentials
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
WHATSAPP_INGEST_SECRET=your-secret

# Cloudinary credentials
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Groq Vision Key
GROQ_API_KEY=gsk_your_groq_key
GROQ_MODEL=qwen/qwen3.8-27b

# Bot Settings
WHATSAPP_PHONE_NUMBER=234...
SESSION_DIR=/path/to/persistent/wa_vision_auth_session
WHATSAPP_MONITOR_ALL_GROUPS=true
WHATSAPP_MEDIA_INTAKE_CONCURRENCY=2
WHATSAPP_STAGING_CONCURRENCY=2
WHATSAPP_LISTING_WORKER_CONCURRENCY=1
WHATSAPP_QUEUE_POLL_MS=3000
WHATSAPP_PRICE_FOLLOWUP_WINDOW_MS=600000
WHATSAPP_TRANSCRIBE_VIDEO_AUDIO=true
MAX_AUDIO_TRANSCRIBE_BYTES=24000000
WHATSAPP_LISTINGS_SELLER_ID=e525b6d9-4f81-4522-822d-119151671dba
PUBLIC_SITE_URL=https://your-buysell-site.com
```

---

## 🚀 Deployment (Render)

1. Create a new **Web Service** on Render and connect this repository (`https://github.com/israel2002551/buysell_bot2.git`):
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** `Free`
2. Add the environment variables listed above.
3. Check the Render logs on first run to copy your 8-digit **WhatsApp Pairing Code** and link the device on WhatsApp.
4. Add your Render service URL to **UptimeRobot** (5-minute interval) to keep it awake 24/7.

### Required Render session storage

The current `render.yaml` uses Render's Free plan. Free services have an ephemeral filesystem, so their WhatsApp login is lost whenever Render restarts or redeploys the service. A free service cannot keep a Baileys session permanently.

For a reliable Bot 2 connection, move the service to a paid Render web-service plan, then in the Render Dashboard add a persistent disk mounted at `/var/data` and set this environment variable:

```properties
SESSION_DIR=/var/data/wa_vision_auth_session
```

After the disk is attached, deploy once and pair the device one final time. Do not put the session directory in Git or share its contents.

### Pairing reliably

Open `/pair` on the Bot 2 service, then immediately use the displayed code in WhatsApp: **Settings → Linked Devices → Link a device → Link with phone number instead**. Codes expire after 60 seconds.

The pairing page now retries a failed initial code request and includes **Send pairing prompt / fresh code again**, which asks WhatsApp for another code without deleting the current pairing session. WhatsApp push notifications can be delayed or suppressed by the phone; the active code on `/pair` is the source of truth. Use **New Code** only if WhatsApp explicitly says it could not link, or if changing the target phone number.

## WhatsApp session safety

The Baileys authentication directory contains Signal session credentials and must never be committed, logged, or shared. Set `SESSION_DIR` to a persistent disk location in production and run only one collector instance against that directory. If WhatsApp reports repeated `Bad MAC` or session errors, unlink the Bot 2 device in WhatsApp, remove only the collector's old authentication directory, then pair once again. The collector redacts Signal-library session dumps and protects against concurrent reconnects, but a compromised or out-of-sync credential store still needs a clean re-pair.

## Queue lifecycle

1. WhatsApp messages enter a keyed intake queue, so each seller's album remains in receive order while other sellers continue uploading.
2. Photos and videos are saved to Cloudinary before a private Supabase job is created. Video jobs include frame URLs and, when enabled, a spoken-audio transcript.
3. The collector claims a small number of leased jobs for Vision analysis and marketplace import. Failures retry with backoff and deterministic source IDs prevent duplicates.
4. A product without a fixed price is retained as `needs_price`; a later description or price requeues the same album instead of creating an invented-price listing.

Apply the `whatsapp_ingestion_queue` migration and deploy the updated `whatsapp-listing-action` Edge Function before deploying the collector.
