import fs from 'node:fs/promises';
import path from 'node:path';
import { query, tx } from '../src/db/pool.js';

const dir = path.resolve(process.env.LEGACY_EXPORT_DIR || './legacy-export');

const plans = [
  ['profiles','profiles'],['categories','categories'],['products','products'],['wishlists','wishlists'],['compare_items','compare_items'],
  ['orders','orders'],['order_items','order_items'],['order_tracking','order_status_events'],['reviews','reviews'],
  ['conversations','conversations'],['conversation_members','conversation_members'],['messages','messages'],
  ['payment_transactions','payment_transactions'],['wallet_transactions','wallet_transactions'],['withdrawals','withdrawals'],
  ['disputes','disputes'],['kyc_verifications','kyc_verifications'],['supplier_connections','supplier_connections'],
  ['dropship_catalog','dropship_catalog'],['dropship_requests','dropship_requests'],['coupons','coupons'],
  ['coupon_redemptions','coupon_redemptions'],['advertisements','advertisements'],['ad_stats','ad_stats'],
  ['commission_receipts','commission_receipts'],['notifications','notifications'],['push_subscriptions','push_subscriptions'],
  ['analytics_events','analytics_events'],['landing_media','landing_media'],['upcoming_products','upcoming_products'],
  ['referrals','referrals'],['broadcasts','broadcast_jobs'],
];

const moneyColumns = {
  products: new Set(['price','original_price','shipping_fee','shipping_cost','flash_price']),
  orders: new Set(['total_amount','subtotal','shipping_amount','platform_fee']),
  order_items: new Set(['unit_price','shipping_fee']),
  payment_transactions: new Set(['amount']),
  wallet_transactions: new Set(['amount']),
  withdrawals: new Set(['amount']),
  dropship_catalog: new Set(['cost','suggested_price','shipping']),
  dropship_requests: new Set(['total_amount']),
  coupon_redemptions: new Set(['discount_amount']),
  advertisements: new Set(['amount_paid']),
  commission_receipts: new Set(['amount']),
  referrals: new Set(['amount']),
};

async function readJson(name) {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(dir, `${name}.json`), 'utf8'));
    return Array.isArray(raw) ? raw : (raw.data || raw.rows || []);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function columns(table, client = query) {
  const exec = typeof client === 'function' ? client : client.query.bind(client);
  const { rows } = await exec(`SELECT column_name,data_type,udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table]);
  return new Map(rows.map((row) => [row.column_name, row]));
}

const toKobo = (value) => value === null || value === undefined || value === '' ? value : Math.round(Number(value) * 100);
const validUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function transform(sourceTable, targetTable, source) {
  const row = { ...source };

  if (targetTable === 'profiles') {
    if (!row.user_id && row.id) row.user_id = row.id;
    if (!row.role_legacy && row.role) row.role_legacy = row.role;
    delete row.id;
    delete row.email;
    delete row.role;
    delete row.is_suspended;
  }

  if (targetTable === 'reviews' && !row.reviewer_id && row.buyer_id) row.reviewer_id = row.buyer_id;

  if (targetTable === 'products') {
    const status=String(row.status||'draft').toLowerCase();
    row.status=({published:'active',live:'active',inactive:'paused',disabled:'paused',deleted:'archived'})[status]||status;
    if(!['draft','active','paused','archived'].includes(row.status)) row.status='draft';
  }

  if (targetTable === 'orders') {
    const status=String(row.status||'pending').toLowerCase();
    row.status=({paid:'confirmed',accepted:'confirmed',in_progress:'processing',out_for_delivery:'shipped',completed:'delivered',returned:'refunded'})[status]||status;
    if(!['pending','confirmed','processing','shipped','delivered','cancelled','refunded','disputed'].includes(row.status)) row.status='pending';
    const ps=String(row.payment_status||'pending').toLowerCase();
    row.payment_status=({paid:'successful',success:'successful',completed:'successful',cancelled:'failed'})[ps]||ps;
    if(!['pending','successful','failed','refunded'].includes(row.payment_status)) row.payment_status='pending';
  }

  if (targetTable === 'payment_transactions') {
    const status=String(row.status||'pending').toLowerCase();
    row.status=({paid:'successful',success:'successful',completed:'successful',cancelled:'failed'})[status]||status;
    if(!['pending','successful','failed','refunded'].includes(row.status)) row.status='pending';
    row.provider=row.provider||'flutterwave';
    row.reference=row.reference||row.tx_ref||row.payment_ref;
  }

  if (targetTable === 'withdrawals') {
    const status=String(row.status||'pending').toLowerCase();
    row.status=({approved:'paid',completed:'paid',declined:'rejected',failed:'rejected'})[status]||status;
    if(!['pending','paid','rejected','cancelled'].includes(row.status)) row.status='pending';
  }

  if (targetTable === 'disputes') {
    const status=String(row.status||'open').toLowerCase();
    row.status=({pending:'open',in_review:'reviewing',closed:'resolved',completed:'resolved',declined:'rejected'})[status]||status;
    if(!['open','reviewing','resolved','refunded','rejected'].includes(row.status)) row.status='open';
  }

  if (targetTable === 'commission_receipts') {
    const status=String(row.status||'pending').toLowerCase();
    row.status=({verified:'approved',accepted:'approved',declined:'rejected'})[status]||status;
    if(!['pending','approved','rejected'].includes(row.status)) row.status='pending';
  }

  if (sourceTable === 'order_tracking' && targetTable === 'order_status_events') {
    row.actor_id = row.actor_id || row.created_by || null;
    delete row.created_by;
  }

  if (targetTable === 'kyc_verifications') {
    const status = String(row.status || 'pending').toLowerCase();
    row.status = ['approved','verified','accepted'].includes(status) ? 'approved' : (['rejected','declined','failed'].includes(status) ? 'rejected' : 'pending');
  }

  if (targetTable === 'advertisements') {
    row.advertiser_id = row.advertiser_id || row.user_id || row.seller_id;
    row.body = row.body ?? row.description ?? null;
    row.media_url = row.media_url || row.image_url || null;
    row.media_type = row.media_type || (row.video_url ? 'video' : 'image');
    row.image_url = row.image_url || (row.media_type === 'video' ? null : row.media_url) || null;
    row.destination_url = row.destination_url || row.target_url || row.cta_link || null;
    row.cta_link = row.cta_link || row.target_url || row.destination_url || null;
    row.ends_at = row.ends_at || row.expires_at || null;
    const status = String(row.status || 'pending').toLowerCase();
    row.status = ({ pending_payment:'pending', approved:'active', live:'active', inactive:'expired' })[status] || status;
    if (!['draft','pending','active','rejected','expired'].includes(row.status)) row.status = 'pending';
    delete row.description;
    delete row.target_url;
    delete row.expires_at;
    delete row.user_id;
    delete row.seller_id;
  }

  if (targetTable === 'commission_receipts') {
    row.proof_url = row.proof_url || row.receipt_url || null;
    delete row.receipt_url;
  }

  if (sourceTable === 'broadcasts' && targetTable === 'broadcast_jobs') {
    row.created_by = row.created_by || row.user_id || null;
    row.status = row.status || 'completed';
    if (row.sent !== undefined && row.sent_count === undefined) row.sent_count = Number(row.sent || 0);
    if (row.failed !== undefined && row.failed_count === undefined) row.failed_count = Number(row.failed || 0);
    if (row.skipped !== undefined && row.skipped_count === undefined) row.skipped_count = Number(row.skipped || 0);
    delete row.user_id;
    delete row.sent;
    delete row.failed;
    delete row.skipped;
  }

  if (targetTable === 'referrals') {
    row.referred_user_id = row.referred_user_id || row.referred_id || row.user_id || null;
    if (!validUuid(row.referred_user_id)) row.referred_user_id = null;
  }

  for (const key of moneyColumns[targetTable] || []) if (key in row) row[key] = toKobo(row[key]);

  if (targetTable === 'coupons') {
    if (row.min_order !== undefined) row.min_order = toKobo(row.min_order);
    if (row.discount_type === 'fixed' && row.discount_value !== undefined) row.discount_value = toKobo(row.discount_value);
  }

  return row;
}

function normalizeValue(meta, value) {
  if (value === undefined) return null;
  if ((meta.data_type === 'jsonb' || meta.data_type === 'json') && typeof value !== 'string') return JSON.stringify(value);
  return value;
}

async function insertRows(client, sourceTable, targetTable, rawRows) {
  if (!rawRows.length) return 0;
  const cols = await columns(targetTable, client);
  if (!cols.size) {
    console.warn(`skip ${sourceTable} -> ${targetTable}: target table missing`);
    return 0;
  }
  let count = 0;
  for (const original of rawRows) {
    const source = transform(sourceTable, targetTable, original);
    const keys = Object.keys(source).filter((key) => cols.has(key));
    if (!keys.length) continue;
    const values = keys.map((key) => normalizeValue(cols.get(key), source[key]));
    const sql = `INSERT INTO ${targetTable}(${keys.map((key) => `"${key}"`).join(',')}) VALUES(${keys.map((_,i) => `$${i+1}`).join(',')}) ON CONFLICT DO NOTHING`;
    try {
      await client.query(sql, values);
      count++;
    } catch (error) {
      error.message = `${sourceTable} -> ${targetTable} import failed: ${error.message}`;
      throw error;
    }
  }
  return count;
}

async function importAuthUsers(client) {
  const rows = await readJson('auth_users');
  let count = 0;
  for (const user of rows) {
    if (!user.id || !user.email) continue;
    const passwordHash = user.encrypted_password || user.password_hash || null;
    await client.query(`
      INSERT INTO users(id,email,password_hash,status,email_verified_at,password_reset_required,created_at,updated_at,legacy_auth_provider,legacy_auth_id)
      VALUES($1,$2,$3,'active',$4,$5,COALESCE($6,now()),COALESCE($7,now()),'supabase',$1)
      ON CONFLICT(id) DO UPDATE SET
        email=EXCLUDED.email,
        password_hash=COALESCE(users.password_hash,EXCLUDED.password_hash),
        email_verified_at=COALESCE(users.email_verified_at,EXCLUDED.email_verified_at),
        legacy_auth_provider='supabase',legacy_auth_id=EXCLUDED.legacy_auth_id
    `, [user.id,user.email,passwordHash,user.email_confirmed_at||user.confirmed_at||null,!Boolean(passwordHash),user.created_at||null,user.updated_at||null]);
    await client.query(`INSERT INTO user_roles(user_id,role) VALUES($1,'buyer') ON CONFLICT DO NOTHING`, [user.id]);
    count++;
  }
  return count;
}

async function applyLegacyProfileState(client, profileRows) {
  for (const profile of profileRows) {
    const userId = profile.user_id || profile.id;
    if (!validUuid(userId)) continue;
    if (profile.is_suspended === true || String(profile.is_suspended).toLowerCase() === 'true') {
      await client.query(`UPDATE users SET status='suspended' WHERE id=$1`, [userId]);
    }
  }
}


async function backfillMessageConversations(client) {
  const { rows } = await client.query(`
    SELECT id,sender_id,receiver_id,order_id,created_at
    FROM messages
    WHERE conversation_id IS NULL AND receiver_id IS NOT NULL
    ORDER BY created_at ASC
  `);
  const groups = new Map();
  for (const message of rows) {
    const pair = [message.sender_id,message.receiver_id].sort();
    const key = `${pair[0]}:${pair[1]}:${message.order_id || ''}`;
    if (!groups.has(key)) groups.set(key, { pair, orderId:message.order_id || null, ids:[] });
    groups.get(key).ids.push(message.id);
  }
  let conversations = 0;
  let messages = 0;
  for (const group of groups.values()) {
    const existing = await client.query(`
      SELECT c.id FROM conversations c
      WHERE (($3::uuid IS NULL AND c.order_id IS NULL) OR c.order_id=$3::uuid)
        AND EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.conversation_id=c.id AND cm.user_id=$1)
        AND EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.conversation_id=c.id AND cm.user_id=$2)
      LIMIT 1
    `, [group.pair[0],group.pair[1],group.orderId]);
    let conversationId = existing.rows[0]?.id;
    if (!conversationId) {
      const created = await client.query('INSERT INTO conversations(order_id) VALUES($1) RETURNING id', [group.orderId]);
      conversationId = created.rows[0].id;
      await client.query(`INSERT INTO conversation_members(conversation_id,user_id) VALUES($1,$2),($1,$3) ON CONFLICT DO NOTHING`, [conversationId,group.pair[0],group.pair[1]]);
      conversations++;
    }
    const updated = await client.query('UPDATE messages SET conversation_id=$1 WHERE id=ANY($2::uuid[])', [conversationId,group.ids]);
    await client.query(`UPDATE conversations SET updated_at=(SELECT COALESCE(max(created_at),updated_at) FROM messages WHERE conversation_id=$1) WHERE id=$1`, [conversationId]);
    messages += updated.rowCount;
  }
  return { conversations, messages };
}

async function backfillOrderItems(client) {
  const { rows: orders } = await client.query(`
    SELECT id,seller_id,items FROM orders
    WHERE NOT EXISTS(SELECT 1 FROM order_items oi WHERE oi.order_id=orders.id)
      AND jsonb_typeof(items)='array'
  `);
  const { rows: products } = await client.query('SELECT id FROM products');
  const knownProducts = new Set(products.map((row) => row.id));
  let created = 0;
  for (const orderRow of orders) {
    const items = Array.isArray(orderRow.items) ? orderRow.items : [];
    for (const raw of items) {
      const candidate = raw.product_id || raw.id || null;
      const productId = knownProducts.has(candidate) ? candidate : null;
      const qty = Math.max(1, Number(raw.quantity || raw.qty || 1));
      const unit = toKobo(raw.unit_price ?? raw.price ?? 0);
      const shipping = toKobo(raw.shipping_fee ?? raw.shipping_cost ?? 0);
      const name = raw.name || 'Legacy product';
      await client.query(`
        INSERT INTO order_items(order_id,product_id,seller_id,name,image_url,unit_price,quantity,shipping_fee,metadata)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [orderRow.id,productId,raw.seller_id||orderRow.seller_id,name,raw.image_url||null,unit,qty,shipping,JSON.stringify({ legacy:true, legacy_product_id:candidate })]);
      created++;
    }
  }
  return created;
}

const runId = (await query(`INSERT INTO migration_runs(source,notes) VALUES('supabase-json-export',$1) RETURNING id`, [`Import directory: ${dir}`])).rows[0].id;
const stats = {};
try {
  await tx(async (client) => {
    stats.auth_users = await importAuthUsers(client);
    const profileRows = await readJson('profiles');
    for (const [sourceTable,targetTable] of plans) {
      const rows = sourceTable === 'profiles' ? profileRows : await readJson(sourceTable);
      if (!rows.length) continue;
      stats[sourceTable] = await insertRows(client, sourceTable, targetTable, rows);
    }
    await client.query(`INSERT INTO user_roles(user_id,role) SELECT user_id,role_legacy FROM profiles WHERE role_legacy IN ('seller','supplier','seller_manager','rider','admin') ON CONFLICT DO NOTHING`);
    await client.query(`INSERT INTO user_roles(user_id,role) SELECT user_id,'seller' FROM profiles WHERE accounts ILIKE '%seller%' ON CONFLICT DO NOTHING`);
    await applyLegacyProfileState(client, profileRows);
    stats.order_items_backfilled = await backfillOrderItems(client);
    stats.message_conversations_backfilled = await backfillMessageConversations(client);
  });
  await query(`UPDATE migration_runs SET status='completed',completed_at=now(),stats=$1 WHERE id=$2`, [JSON.stringify(stats),runId]);
  console.log(JSON.stringify({ runId,status:'completed',stats }, null, 2));
} catch (error) {
  await query(`UPDATE migration_runs SET status='failed',completed_at=now(),stats=$1,notes=$2 WHERE id=$3`, [JSON.stringify(stats),String(error.stack||error),runId]);
  throw error;
}
