function money(value) {
  return `₦${Number(value || 0).toLocaleString('en-NG')}`;
}

function sellerJid(senderJid) {
  return String(senderJid || '').includes('@') ? senderJid : `${senderJid}@s.whatsapp.net`;
}

export async function sendSellerConfirmation(sock, { senderJid, listing, manageToken, publicSiteUrl }) {
  const target = sellerJid(senderJid);
  const siteUrl = String(publicSiteUrl || process.env.PUBLIC_SITE_URL || '').replace(/\/+$/, '');
  const manageUrl = siteUrl && manageToken && listing?.product_id
    ? `${siteUrl}/manage?product=${encodeURIComponent(listing.product_id)}&token=${encodeURIComponent(manageToken)}`
    : '';
  const publicUrl = listing?.public_url || (siteUrl && listing?.product_id ? `${siteUrl}/product?id=${encodeURIComponent(listing.product_id)}` : '');
  const message = [
    '🛍️ *Your item was received by BUYSELL*',
    '',
    `📦 *Item:* ${listing.product?.name || 'Your listing'}`,
    `💰 *Price:* ${money(listing.product?.price)}`,
    '',
    'Your listing is awaiting BUYSELL review before it appears publicly.',
    manageUrl ? `⚙️ *Manage it (edit, mark sold, or remove):*\n${manageUrl}` : '',
    publicUrl ? `🔗 *Public link once approved:*\n${publicUrl}` : '',
    '',
    'You can also reply *SOLD* to this chat to close your latest active listing.',
  ].filter(Boolean).join('\n');

  try {
    await sock.sendPresenceUpdate('composing', target);
    await new Promise(resolve => setTimeout(resolve, 800));
    await sock.sendPresenceUpdate('paused', target);
    await sock.sendMessage(target, { text: message });
  } catch (error) {
    console.error('[Seller notification]', error?.message || error);
  }
}

export async function sendSellerBatchConfirmation(sock, { senderJid, listings, publicSiteUrl }) {
  if (!listings || !listings.length) return;
  if (listings.length === 1) {
    return sendSellerConfirmation(sock, {
      senderJid,
      listing: listings[0].listing,
      manageToken: listings[0].manageToken,
      publicSiteUrl,
    });
  }

  const target = sellerJid(senderJid);
  const siteUrl = String(publicSiteUrl || process.env.PUBLIC_SITE_URL || '').replace(/\/+$/, '');

  const itemsLines = listings.map((entry, index) => {
    const name = entry.listing?.product?.name || entry.finalTitle || `Item #${index + 1}`;
    const priceVal = entry.listing?.product?.price || entry.item?.price;
    const manageUrl = siteUrl && entry.manageToken && entry.listing?.product_id
      ? `\n   ⚙️ Manage: ${siteUrl}/manage?product=${encodeURIComponent(entry.listing.product_id)}&token=${encodeURIComponent(entry.manageToken)}`
      : '';
    return `${index + 1}️⃣ *${name}* — ${money(priceVal)}${manageUrl}`;
  });

  const message = [
    `🛍️ *${listings.length} items were received by BUYSELL*`,
    '',
    itemsLines.join('\n\n'),
    '',
    'Your listings are awaiting BUYSELL review before they appear publicly.',
    'You can reply *SOLD* to this chat to close your latest active listing.',
  ].join('\n');

  try {
    await sock.sendPresenceUpdate('composing', target);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await sock.sendPresenceUpdate('paused', target);
    await sock.sendMessage(target, { text: message });
  } catch (error) {
    console.error('[Seller batch notification]', error?.message || error);
  }
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
