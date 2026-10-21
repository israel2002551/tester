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

  ingest(listing) {
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
