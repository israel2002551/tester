import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import { badRequest, forbidden, notFound, unavailable } from '../lib/errors.js';

let client;
function s3() {
  if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) throw unavailable('MEDIA_STORAGE_NOT_CONFIGURED', 'Media storage is temporarily unavailable.');
  if (!client) client = new S3Client({
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  });
  return client;
}

function rules(kind) {
  if (kind === 'IMAGE') return { prefix: 'image/', max: env.MEDIA_MAX_IMAGE_BYTES };
  if (kind === 'VIDEO') return { prefix: 'video/', max: env.MEDIA_MAX_VIDEO_BYTES };
  return { prefix: ['application/pdf', 'image/'], max: env.MEDIA_MAX_DOCUMENT_BYTES };
}

function validateFile({ kind, mimeType, bytes }) {
  const rule = rules(kind);
  const allowed = Array.isArray(rule.prefix) ? rule.prefix.some((prefix) => mimeType.startsWith(prefix)) : mimeType.startsWith(rule.prefix);
  if (!allowed || bytes <= 0 || bytes > rule.max) throw badRequest('INVALID_MEDIA', 'The file type or size is not permitted.');
}

async function verifyCloudinaryAsset(input) {
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) throw unavailable('MEDIA_STORAGE_NOT_CONFIGURED', 'Public media storage is temporarily unavailable.');
  const resourceType = input.kind === 'IMAGE' ? 'image' : input.kind === 'VIDEO' ? 'video' : 'raw';
  const basic = Buffer.from(`${env.CLOUDINARY_API_KEY}:${env.CLOUDINARY_API_SECRET}`).toString('base64');
  const response = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/resources/${resourceType}/upload/${encodeURIComponent(input.providerAssetId)}`, {
    headers: { authorization: `Basic ${basic}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw badRequest('MEDIA_UPLOAD_NOT_FOUND', 'The uploaded Cloudinary asset could not be verified.');
  const asset = await response.json();
  const hostname = (() => { try { return new URL(asset.secure_url).hostname; } catch { return ''; } })();
  const mimeType = asset.resource_type === 'raw' ? String(asset.format || 'application/octet-stream') : `${asset.resource_type}/${asset.format}`;
  const verified = {
    providerAssetId: String(asset.public_id), providerVersion: Number(asset.version), bytes: Number(asset.bytes),
    kind: asset.resource_type === 'image' ? 'IMAGE' : asset.resource_type === 'video' ? 'VIDEO' : 'DOCUMENT',
    mimeType, publicUrl: asset.secure_url, width: asset.width || null, height: asset.height || null,
    durationMs: asset.duration ? Math.round(Number(asset.duration) * 1000) : null,
  };
  if (verified.providerAssetId !== input.providerAssetId || verified.providerVersion !== Number(input.providerVersion) || verified.bytes !== input.bytes || verified.kind !== input.kind || hostname !== 'res.cloudinary.com') {
    throw badRequest('MEDIA_UPLOAD_MISMATCH', 'The uploaded Cloudinary asset does not match its signed authorization.');
  }
  validateFile(verified);
  return verified;
}

export async function authorizeUpload(userId, input) {
  validateFile(input);
  const privatePurpose = ['kyc', 'dispute'].includes(input.purpose);
  const access = privatePurpose ? 'PRIVATE' : input.access;
  const extension = input.filename.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
  const objectKey = `users/${userId}/${input.purpose}/${randomUUID()}.${extension}`;
  if (access === 'PUBLIC' && env.PUBLIC_MEDIA_PROVIDER === 'cloudinary') {
    if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) throw unavailable('MEDIA_STORAGE_NOT_CONFIGURED', 'Public media storage is temporarily unavailable.');
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = `buysell/users/${userId}/${input.purpose}`;
    const signature = createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`).digest('hex');
    return { provider: 'cloudinary', access, uploadUrl: `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/auto/upload`, fields: { api_key: env.CLOUDINARY_API_KEY, folder, timestamp, signature }, expiresIn: 600 };
  }
  const bucket = access === 'PUBLIC' ? env.S3_PUBLIC_BUCKET : env.S3_PRIVATE_BUCKET;
  if (!bucket) throw unavailable('MEDIA_STORAGE_NOT_CONFIGURED', 'Media storage is temporarily unavailable.');
  const command = new PutObjectCommand({ Bucket: bucket, Key: objectKey, ContentType: input.mimeType, ContentLength: input.bytes, Metadata: { owner: userId, purpose: input.purpose } });
  const uploadUrl = await getSignedUrl(s3(), command, { expiresIn: env.MEDIA_SIGNED_URL_TTL_SECONDS });
  return { provider: 's3', access, uploadUrl, objectKey, expiresIn: env.MEDIA_SIGNED_URL_TTL_SECONDS };
}

export async function registerAsset(db, userId, input) {
  validateFile(input);
  let providerVerified = input;
  if (input.provider === 's3') {
    if (!input.providerAssetId.startsWith(`users/${userId}/`)) throw forbidden();
    const bucket = input.access === 'PUBLIC' ? env.S3_PUBLIC_BUCKET : env.S3_PRIVATE_BUCKET;
    if (!bucket) throw unavailable('MEDIA_STORAGE_NOT_CONFIGURED', 'Media storage is temporarily unavailable.');
    const head = await s3().send(new HeadObjectCommand({ Bucket: bucket, Key: input.providerAssetId }));
    if (head.ContentLength !== input.bytes || head.ContentType !== input.mimeType || head.Metadata?.owner !== userId) throw badRequest('MEDIA_UPLOAD_MISMATCH', 'The uploaded object does not match its signed authorization.');
  } else if (input.provider !== 'cloudinary' || input.access !== 'PUBLIC') {
    throw badRequest('INVALID_MEDIA_PROVIDER', 'The selected provider cannot store this asset.');
  }
  if (input.provider === 'cloudinary') {
    const expectedPrefix = `buysell/users/${userId}/`;
    const hostname = (() => { try { return new URL(input.publicUrl).hostname; } catch { return ''; } })();
    const responseSignature = createHash('sha1').update(`public_id=${input.providerAssetId}&version=${input.providerVersion}${env.CLOUDINARY_API_SECRET}`).digest('hex');
    if (!input.providerAssetId.startsWith(expectedPrefix) || hostname !== 'res.cloudinary.com' || !input.providerSignature || responseSignature.length !== input.providerSignature.length || !timingSafeEqual(Buffer.from(responseSignature), Buffer.from(input.providerSignature))) {
      throw badRequest('MEDIA_UPLOAD_MISMATCH', 'The Cloudinary asset does not match its signed upload scope.');
    }
    providerVerified = await verifyCloudinaryAsset(input);
  }
  const publicUrl = input.access === 'PUBLIC'
    ? (providerVerified.publicUrl || (input.provider === 's3' && env.S3_PUBLIC_BASE_URL ? `${env.S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${input.providerAssetId}` : null))
    : null;
  if (input.access === 'PUBLIC' && !publicUrl) throw badRequest('PUBLIC_URL_REQUIRED', 'A public asset must include its provider URL.');
  return db.mediaAsset.create({ data: {
    ownerId: userId, provider: input.provider, providerAssetId: input.providerAssetId, kind: providerVerified.kind,
    mimeType: providerVerified.mimeType, bytes: providerVerified.bytes, width: providerVerified.width,
    height: providerVerified.height, durationMs: providerVerified.durationMs, access: input.access, publicUrl,
  } });
}

export async function assetAccessUrl(db, user, assetId, { privileged = false } = {}) {
  const asset = await db.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset) throw notFound('Media asset');
  if (asset.access === 'PUBLIC') return { url: asset.publicUrl, expiresIn: null };
  if (asset.ownerId !== user.id && !privileged) throw forbidden();
  const url = await getSignedUrl(s3(), new GetObjectCommand({ Bucket: env.S3_PRIVATE_BUCKET, Key: asset.providerAssetId }), { expiresIn: env.MEDIA_SIGNED_URL_TTL_SECONDS });
  return { url, expiresIn: env.MEDIA_SIGNED_URL_TTL_SECONDS };
}
