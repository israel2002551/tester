import crypto from 'node:crypto';
import path from 'node:path';
import { query } from '../src/db/pool.js';
import { putObject } from '../src/utils/s3.js';

const sourceHost=process.env.LEGACY_SUPABASE_HOST||'';
const tables={
  profiles:{id:'user_id',singular:['avatar_url','logo_url']},
  products:{id:'id',singular:['image_url','video_url'],arrays:['images','videos']},
  orders:{id:'id',singular:['proof_url','payment_proof_url']},
  kyc_verifications:{id:'id',singular:['front_url','back_url','selfie_url']},
  dropship_catalog:{id:'id',singular:['image'],arrays:['images']},
  advertisements:{id:'id',singular:['image_url','media_url']},
  commission_receipts:{id:'id',singular:['proof_url']},
  landing_media:{id:'id',singular:['media_url','poster_url']},
  upcoming_products:{id:'id',singular:['image_url','video_url'],arrays:['images','videos']},
};
function shouldMove(value){if(!value||typeof value!=='string')return false;try{const u=new URL(value);return sourceHost?u.host===sourceHost:/supabase\.(co|in)$/.test(u.host)||u.host.includes('.supabase.co')}catch{return false}}
function extFrom(url,type){try{const e=path.extname(new URL(url).pathname);if(e&&e.length<12)return e}catch{}const map={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','video/mp4':'.mp4','application/pdf':'.pdf'};return map[type]||''}
async function move(url,table,rowId,column){const r=await fetch(url);if(!r.ok)throw new Error(`Could not fetch legacy object ${r.status}: ${url}`);const body=Buffer.from(await r.arrayBuffer()),type=r.headers.get('content-type')?.split(';')[0]||'application/octet-stream';const key=`legacy/${table}/${rowId}/${column}/${crypto.randomBytes(10).toString('hex')}${extFrom(url,type)}`;return putObject({key,body,contentType:type})}
let moved=0,failed=0;
for(const [table,cfg] of Object.entries(tables)){
 const columns=[cfg.id,...(cfg.singular||[]),...(cfg.arrays||[])];
 let rows=[];try{rows=(await query(`SELECT ${columns.map(c=>`"${c}"`).join(',')} FROM ${table}`)).rows}catch(e){console.warn(`skip ${table}: ${e.message}`);continue}
 for(const row of rows){
  for(const col of cfg.singular||[]){if(!shouldMove(row[col]))continue;try{const next=await move(row[col],table,row[cfg.id],col);await query(`UPDATE ${table} SET "${col}"=$1 WHERE "${cfg.id}"=$2`,[next,row[cfg.id]]);moved++;console.log(`moved ${table}.${col} ${row[cfg.id]}`)}catch(e){failed++;console.error(`FAILED ${table}.${col} ${row[cfg.id]}: ${e.message}`)}}
  for(const col of cfg.arrays||[]){let values=row[col]||[];if(typeof values==='string'){try{values=JSON.parse(values)}catch{values=[]}}if(!Array.isArray(values)||!values.some(shouldMove))continue;const next=[];let changed=false;for(const value of values){if(!shouldMove(value)){next.push(value);continue}try{next.push(await move(value,table,row[cfg.id],col));moved++;changed=true}catch(e){failed++;next.push(value);console.error(`FAILED ${table}.${col} ${row[cfg.id]}: ${e.message}`)}}if(changed)await query(`UPDATE ${table} SET "${col}"=$1::jsonb WHERE "${cfg.id}"=$2`,[JSON.stringify(next),row[cfg.id]])}
 }
}
console.log(JSON.stringify({moved,failed},null,2));if(failed)process.exitCode=2;
