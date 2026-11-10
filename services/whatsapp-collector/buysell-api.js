import 'dotenv/config';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export class BuySellListingsApi {
  constructor() {
    const url = required('SUPABASE_URL').replace(/\/+$/, '');
    this.endpoint = `${url}/functions/v1/whatsapp-listing-action`;
    this.anonKey = required('SUPABASE_ANON_KEY');
    this.ingestSecret = required('WHATSAPP_INGEST_SECRET');
  }

  async request(body) {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: this.anonKey,
        Authorization: `Bearer ${this.anonKey}`,
        'x-whatsapp-ingest-secret': this.ingestSecret,
      },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `BUYSELL listing API failed (${response.status}).`);
    return data;
  }

  ingest(listing) {
    return this.request({ action: 'ingest', ...listing });
  }

  sellerCommand({ senderJid, command }) {
    return this.request({ action: 'seller_command', sender_jid: senderJid, command });
  }

  listTargetGroups() {
    return this.request({ action: 'collector_groups' });
  }

  getOrderWhatsAppSales() {
    return this.request({ action: 'order_whatsapp_sales' });
  }

  // The WhatsApp session, kept in Supabase when WHATSAPP_AUTH_STORE=supabase (see auth-store.js).
  authStateList({ sessionId, after = null }) {
    return this.request({ action: 'auth_state_list', session_id: sessionId, after });
  }

  authStateGet({ sessionId, keys }) {
    return this.request({ action: 'auth_state_get', session_id: sessionId, keys });
  }

  authStateSet({ sessionId, entries }) {
    return this.request({ action: 'auth_state_set', session_id: sessionId, entries });
  }

  authStateClear({ sessionId }) {
    return this.request({ action: 'auth_state_clear', session_id: sessionId });
  }
}
