import { createHash } from 'node:crypto';
import 'dotenv/config';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function extensionFor(kind, mimeType = '') {
  if (kind === 'video') return /quicktime/i.test(mimeType) ? 'mov' : 'mp4';
  if (/png/i.test(mimeType)) return 'png';
  if (/webp/i.test(mimeType)) return 'webp';
  return 'jpg';
}

/** Uploads a WhatsApp media buffer from the private worker directly to Cloudinary. */
export async function uploadWhatsAppMedia({ buffer, kind, mimeType, sourceId, index }) {
  const cloudName = required('CLOUDINARY_CLOUD_NAME');
  const apiKey = required('CLOUDINARY_API_KEY');
  const apiSecret = required('CLOUDINARY_API_SECRET');
  const maxBytes = Math.max(1_000_000, Number(process.env.MAX_MEDIA_BYTES || 26_214_400));
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('WhatsApp media was empty.');
  if (buffer.length > maxBytes) throw new Error(`WhatsApp media exceeds the ${Math.floor(maxBytes / 1024 / 1024)}MB limit.`);

  const resourceType = kind === 'video' ? 'video' : 'image';
  const month = new Date().toISOString().slice(0, 7);
  const folder = `buysell/whatsapp/${month}`;
  const publicId = `${createHash('sha256').update(String(sourceId)).digest('hex').slice(0, 24)}_${index}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const signatureBase = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
  const signature = createHash('sha1').update(signatureBase).digest('hex');
  const form = new FormData();
  const contentType = mimeType || (resourceType === 'video' ? 'video/mp4' : 'image/jpeg');
  form.append('file', new Blob([buffer], { type: contentType }), `${publicId}.${extensionFor(resourceType, contentType)}`);
  form.append('api_key', apiKey);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('public_id', publicId);
  form.append('signature', signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/upload`, {
    method: 'POST',
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.secure_url) throw new Error(data?.error?.message || 'Cloudinary upload failed.');
  return { url: data.secure_url, type: resourceType };
}
