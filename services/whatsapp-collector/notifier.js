function money(value) {
  return `₦${Number(value || 0).toLocaleString('en-NG')}`;
}

function sellerJid(senderJid) {
  return String(senderJid || '').includes('@') ? senderJid : `${senderJid}@s.whatsapp.net`;
}

export async function sendSellerConfirmation(sock, { senderJid, listing, manageToken, publicSiteUrl }) {
  const target = sellerJid(senderJid);
  const siteUrl = String(publicSiteUrl || process.env.PUBLIC_SITE_URL || '').replace(/\/+$/, '');
  const manageUrl = siteUrl
    ? `${siteUrl}/manage?product=${encodeURIComponent(listing.product_id)}&token=${encodeURIComponent(manageToken)}`
    : '';
  const publicUrl = listing.public_url || (siteUrl ? `${siteUrl}/product?id=${encodeURIComponent(listing.product_id)}` : '');
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
    await new Promise(resolve => setTimeout(resolve, 900));
    await sock.sendPresenceUpdate('paused', target);
    await sock.sendMessage(target, { text: message });
  } catch (error) {
    console.error('[Seller notification]', error?.message || error);
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
