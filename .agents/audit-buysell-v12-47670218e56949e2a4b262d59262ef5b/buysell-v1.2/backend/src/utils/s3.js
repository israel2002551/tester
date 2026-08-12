import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { HttpError } from './http.js';

const sha256=(value)=>crypto.createHash('sha256').update(value).digest('hex');
const hmac=(key,value,encoding)=>crypto.createHmac('sha256',key).update(value).digest(encoding);
const enc=(s)=>encodeURIComponent(s).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function signingKey(secret,date,region,service='s3'){
  const kDate=hmac(Buffer.from(`AWS4${secret}`),date);
  const kRegion=hmac(kDate,region);
  const kService=hmac(kRegion,service);
  return hmac(kService,'aws4_request');
}

export async function putObject({key,body,contentType='application/octet-stream'}){
  if(!env.s3Endpoint||!env.s3Bucket||!env.s3AccessKeyId||!env.s3SecretAccessKey) throw new HttpError(503,'S3-compatible object storage is not configured');
  const endpoint=new URL(env.s3Endpoint);
  const now=new Date();
  const amzDate=now.toISOString().replace(/[:-]|\.\d{3}/g,'');
  const date=amzDate.slice(0,8),region=env.s3Region||'auto';
  const safeKey=String(key).split('/').map(enc).join('/');
  const basePath=endpoint.pathname.replace(/\/$/,'');
  const canonicalUri=`${basePath}/${enc(env.s3Bucket)}/${safeKey}`.replace(/\/+/g,'/');
  const payloadHash=sha256(body);
  const canonicalHeaders=`host:${endpoint.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders='host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest=['PUT',canonicalUri,'',canonicalHeaders,signedHeaders,payloadHash].join('\n');
  const scope=`${date}/${region}/s3/aws4_request`;
  const stringToSign=['AWS4-HMAC-SHA256',amzDate,scope,sha256(canonicalRequest)].join('\n');
  const signature=hmac(signingKey(env.s3SecretAccessKey,date,region),stringToSign,'hex');
  const authorization=`AWS4-HMAC-SHA256 Credential=${env.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const target=new URL(endpoint.toString());target.pathname=canonicalUri;target.search='';
  const response=await fetch(target,{method:'PUT',headers:{Authorization:authorization,'x-amz-date':amzDate,'x-amz-content-sha256':payloadHash,'Content-Type':contentType},body});
  if(!response.ok){const text=await response.text().catch(()=>'');throw new HttpError(502,`Object upload failed (${response.status})${text?`: ${text.slice(0,180)}`:''}`);}
  return `${(env.s3PublicBaseUrl||`${endpoint.origin}/${env.s3Bucket}`).replace(/\/$/,'')}/${safeKey}`;
}
