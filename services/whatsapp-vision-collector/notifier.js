function money(value) {
  return `₦${Number(value || 0).toLocaleString('en-NG')}`;
}

function sellerJid(senderJid) {
  return String(senderJid || '').includes('@') ? senderJid : `${senderJid}@s.whatsapp.net`;
}

function siteUrlFrom(publicSiteUrl) {
  return String(publicSiteUrl || process.env.PUBLIC_SITE_URL || '').replace(/\/+$/, '');
}

// The seller's one link: their catalog of every item BUYSELL collected from
// them, where they can search, see the photos, edit, mark sold or remove.
export function catalogLink(catalog, siteUrl) {
  const token = String(catalog?.catalog_token || '');
  if (token && siteUrl) return `${siteUrl}/manage?catalog=${encodeURIComponent(token)}`;
  return String(catalog?.catalog_url || '');
}

function catalogLines(url) {
  return [
    '🗂️ *See all your items (search, edit, mark sold or remove):*',
    url,
    '_It is the same link every time, so you can save it._',
  ];
}

async function deliver(sock, target, text, pauseMs, label) {
  try {
    await sock.sendPresenceUpdate('composing', target);
    await new Promise(resolve => setTimeout(resolve, pauseMs));
    await sock.sendPresenceUpdate('paused', target);
    await sock.sendMessage(target, { text });
  } catch (error) {
    console.error(`[${label}]`, error?.message || error);
  }
}

export async function sendSellerConfirmation(sock, { senderJid, listing, manageToken, catalog, publicSiteUrl }) {
  const siteUrl = siteUrlFrom(publicSiteUrl);
  const catalogUrl = catalogLink(catalog, siteUrl);
  const lines = [
    '🛍️ *Your item was received by BUYSELL*',
    '',
    `📦 *Item:* ${listing?.product?.name || 'Your listing'}`,
    `💰 *Price:* ${money(listing?.product?.price)}`,
    '',
    'Your listing is awaiting BUYSELL review before it appears publicly.',
    '',
  ];
  if (catalogUrl) {
    lines.push(...catalogLines(catalogUrl));
  } else {
    // No catalog link (for example the BUYSELL API was unreachable): send this item's own links.
    const manageUrl = siteUrl && manageToken && listing?.product_id
      ? `${siteUrl}/manage?product=${encodeURIComponent(listing.product_id)}&token=${encodeURIComponent(manageToken)}`
      : '';
    const publicUrl = listing?.public_url || (siteUrl && listing?.product_id ? `${siteUrl}/product?id=${encodeURIComponent(listing.product_id)}` : '');
    if (manageUrl) lines.push(`⚙️ *Manage it (edit, mark sold, or remove):*\n${manageUrl}`);
    if (publicUrl) lines.push(`🔗 *Public link once approved:*\n${publicUrl}`);
  }
  lines.push('', 'You can also reply *SOLD* to this chat to close your latest active listing.');
  await deliver(sock, sellerJid(senderJid), lines.join('\n'), 800, 'Seller notification');
}

export async function sendSellerBatchConfirmation(sock, { senderJid, listings, catalog, publicSiteUrl }) {
  if (!listings || !listings.length) return;
  if (listings.length === 1) {
    return sendSellerConfirmation(sock, {
      senderJid,
      listing: listings[0].listing,
      manageToken: listings[0].manageToken,
      catalog,
      publicSiteUrl,
    });
  }

  const siteUrl = siteUrlFrom(publicSiteUrl);
  const catalogUrl = catalogLink(catalog, siteUrl);
  const itemsLines = listings.map((entry, index) => {
    const name = entry.listing?.product?.name || entry.finalTitle || `Item #${index + 1}`;
    const priceVal = entry.listing?.product?.price || entry.item?.price;
    const manageUrl = !catalogUrl && siteUrl && entry.manageToken && entry.listing?.product_id
      ? `\n   ⚙️ Manage: ${siteUrl}/manage?product=${encodeURIComponent(entry.listing.product_id)}&token=${encodeURIComponent(entry.manageToken)}`
      : '';
    return `${index + 1}️⃣ *${name}* — ${money(priceVal)}${manageUrl}`;
  });

  const message = [
    `🛍️ *${listings.length} items were received by BUYSELL*`,
    '',
    itemsLines.join(catalogUrl ? '\n' : '\n\n'),
    '',
    'Your listings are awaiting BUYSELL review before they appear publicly.',
    ...(catalogUrl ? ['', ...catalogLines(catalogUrl)] : []),
    '',
    'You can reply *SOLD* to this chat to close your latest active listing.',
  ].join('\n');
  await deliver(sock, sellerJid(senderJid), message, 1000, 'Seller batch notification');
}

export async function sendSellerCommandResult(sock, senderJid, command, result) {
  const target = sellerJid(senderJid);
  const title = result?.product?.name ? `*${result.product.name}*` : 'your latest listing';
  const text = !result?.found
    ? 'I could not find an open BUYSELL listing under this WhatsApp number.'
    : command === 'SOLD'
      ? `✅ Marked ${title} as sold and removed it from the marketplace.`
      : `✅ Removed ${title} from the marketplace.`;
  await sock.sendMessage(target, { text }).catch(error => console.error('[Seller command reply]', error?.message || error));
}
