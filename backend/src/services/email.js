import { env } from '../config/env.js';
import { unavailable } from '../lib/errors.js';

const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const templates = {
  welcome: (data) => ({ subject: 'Welcome to BUYSELL', heading: `Welcome${data.name ? `, ${data.name}` : ''}`, body: 'Your marketplace account is ready. Explore products, services, and product sourcing from one secure account.' }),
  order_created: (data) => ({ subject: `Order ${data.orderNumber} received`, heading: 'Your order is reserved', body: `Complete payment for order ${data.orderNumber} before its inventory reservation expires.` }),
  order_paid: (data) => ({ subject: `Payment confirmed for ${data.orderNumber}`, heading: 'Payment confirmed', body: `We verified your payment for order ${data.orderNumber}. Sellers can now begin fulfilment.` }),
  order_status: (data) => ({ subject: `Order ${data.orderNumber} update`, heading: 'Order status updated', body: `Order ${data.orderNumber} is now ${String(data.status).replaceAll('_', ' ').toLowerCase()}.` }),
  payout_requested: (data) => ({ subject: 'Payout request received', heading: 'Payout under review', body: `Your payout request for ₦${data.amount || ''} was received.` }),
  payout_status: (data) => ({ subject: 'Payout status updated', heading: 'Payout update', body: `Your payout request is now ${String(data.status).replaceAll('_', ' ').toLowerCase()}.` }),
  dispute_opened: (data) => ({ subject: `Dispute opened for ${data.orderNumber || 'an order'}`, heading: 'A dispute was opened', body: 'The case is visible in your BUYSELL account. Reply there so the resolution team has a complete record.' }),
  message_received: (data) => ({ subject: 'New BUYSELL message', heading: 'You have a new message', body: `${data.senderName || 'A BUYSELL member'} sent you a message. Open your account to reply securely.` }),
  broadcast: (data) => ({ subject: data.subject, heading: data.subject, body: data.content }),
};

export function renderEmailTemplate(name, data = {}) {
  const rendered = templates[name]?.(data);
  if (!rendered) throw new Error(`Unknown email template: ${name}`);
  return {
    subject: String(rendered.subject).slice(0, 200),
    text: `${rendered.heading}\n\n${rendered.body}\n\nBUYSELL — Buy. Sell. Prosper.`,
    html: `<!doctype html><html><body style="margin:0;background:#F5F7F5;font-family:Inter,Arial,sans-serif;color:#111614"><table role="presentation" width="100%"><tr><td align="center" style="padding:32px"><table role="presentation" width="600" style="max-width:100%;background:#fff;border:1px solid #DFE6E1;border-radius:18px"><tr><td style="padding:28px"><div style="font-weight:700;color:#0B6B3A;font-size:22px">BUYSELL</div><h1 style="font-size:24px;margin:28px 0 12px">${escapeHtml(rendered.heading)}</h1><p style="line-height:1.65;color:#68716B">${escapeHtml(rendered.body)}</p><p style="margin-top:28px;font-size:12px;color:#68716B">BUYSELL — Buy. Sell. Prosper.</p></td></tr></table></td></tr></table></body></html>`,
  };
}

export async function sendEmail({ to, template, data, idempotencyKey }) {
  if (!to) return { skipped: true, reason: 'missing_recipient' };
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return { skipped: true, reason: 'email_not_configured' };
  const content = renderEmailTemplate(template, data);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json', ...(idempotencyKey ? { 'idempotency-key': idempotencyKey.slice(0, 256) } : {}) },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], ...content }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw unavailable('EMAIL_PROVIDER_ERROR', 'Transactional email delivery failed.');
  return { id: payload.id };
}
