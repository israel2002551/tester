import 'dotenv/config';
import { createHmac } from 'node:crypto';

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
    this.sharedIngestionEndpoint = String(process.env.INGESTION_API_URL || '').trim().replace(/\/+$/, '');
    this.sharedIngestionSecret = String(process.env.INGESTION_HMAC_SECRET || '').trim();
    if (this.sharedIngestionEndpoint && !this.sharedIngestionSecret) {
      throw new Error('INGESTION_HMAC_SECRET must be configured when INGESTION_API_URL is set.');
    }
  }

  async request(body) {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br',
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

  async ingest(listing) {
    // The existing Edge Function remains the default so an in-flight Bot 2
    // deployment is not disrupted. When the shared endpoint is configured,
    // final product creation moves through the cross-platform API while this
    // collector keeps its established durable WhatsApp staging queue.
    if (this.sharedIngestionEndpoint) {
      const body = JSON.stringify({
        source_platform: 'whatsapp',
        source_message_id: listing.source_message_id,
        sender_id: listing.sender_jid,
        sender_phone: listing.sender_phone || undefined,
        group_jid: listing.group_jid,
        manage_token: listing.manage_token,
        title: listing.title,
        description: listing.description,
        price: listing.price,
        category: listing.category,
        location: listing.location,
        specs: listing.specs,
        negotiable: listing.negotiable === true,
        media: (Array.isArray(listing.media) ? listing.media : []).map(item => ({
          kind: item?.type === 'video' ? 'video' : 'image',
          content_type: item?.type === 'video' ? 'video/mp4' : 'image/jpeg',
          url: item?.url,
        })).filter(item => item.url),
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac('sha256', this.sharedIngestionSecret)
        .update(`${timestamp}.${body}`)
        .digest('hex');
      const response = await fetch(this.sharedIngestionEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Encoding': 'gzip, deflate, br',
          'x-ingestion-timestamp': timestamp,
          'x-ingestion-signature': signature,
        },
        body,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.detail?.message || data?.error || `Shared ingestion API failed (${response.status}).`);
      return data;
    }
    return this.request({ action: 'ingest', ...listing });
  }

  sellerCommand({ senderJid, command }) {
    return this.request({ action: 'seller_command', sender_jid: senderJid, command });
  }

  listTargetGroups() {
    return this.request({ action: 'collector_groups' });
  }

  queueListing(job) {
    return this.request({ action: 'queue_enqueue', ...job });
  }

  claimListingJobs({ workerId, limit = 1, leaseSeconds = 900 } = {}) {
    return this.request({
      action: 'queue_claim',
      worker_id: workerId,
      limit,
      lease_seconds: leaseSeconds,
    });
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

  finishListingJob({ jobId, lockToken, state, error = '', retryInSeconds = 60, result = {} } = {}) {
    return this.request({
      action: 'queue_finish',
      job_id: jobId,
      lock_token: lockToken,
      state,
      error,
      retry_in_seconds: retryInSeconds,
      result,
    });
  }
}
