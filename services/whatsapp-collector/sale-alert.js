// The WhatsApp alert Bot 1 sends the BUYSELL admin when someone buys an item
// that Bot 2 collected from a WhatsApp group.

export function cleanPhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 11) {
    digits = '234' + digits.slice(1);
  }
  // A real number has 8 to 15 digits; anything else can't be messaged.
  return digits.length >= 8 && digits.length <= 15 ? digits : '';
}

export function formatMoney(amount) {
  return `₦${Number(amount || 0).toLocaleString('en-NG')}`;
}

export function buildAdminSaleAlert(sale) {
  const sellerNum = cleanPhone(sale.seller_phone);
  const orderShort = String(sale.order_id || '').slice(0, 8);
  // BUYSELL sends no number when WhatsApp hides the seller's behind a private
  // ID; the admin then reaches them in the group the item came from.
  const sellerLines = sellerNum
    ? [`📱 *Original Seller Phone:* +${sellerNum}`, `💬 *Tap to Chat with Seller:*\nhttps://wa.me/${sellerNum}`]
    : ['📱 *Seller Phone:* Not available. WhatsApp hides this seller\'s number.'];

  return [
    '🚨 *NEW ORDER: WHATSAPP ITEM PURCHASED!* 🛍️',
    '',
    `📦 *Product:* ${sale.product_name || 'Marketplace Item'}`,
    `💰 *Amount Paid by Buyer:* ${formatMoney(sale.paid_price)}`,
    `🧾 *Order ID:* #${orderShort}`,
    '',
    '📍 *WHERE BOT 2 COLLECTED THIS:*',
    `👥 *Group Name:* ${sale.group_name || 'Seller Group'}`,
    `🆔 *Group ID:* \`${sale.group_jid || 'unknown'}\``,
    sale.source_price ? `💵 *Original Stated Price:* ${formatMoney(sale.source_price)}` : '',
    ...sellerLines,
    '',
    '🚚 *DELIVERY DETAILS:*',
    `👤 *Buyer Name:* ${sale.delivery_name || 'Customer'}`,
    sale.delivery_phone ? `📞 *Buyer Phone:* ${sale.delivery_phone}` : '',
    sale.delivery_address ? `🏠 *Delivery Address:* ${sale.delivery_address}` : '',
    '',
    sellerNum
      ? '👉 *Next Step:* Tap the seller link above to confirm availability and purchase the item for delivery!'
      : '👉 *Next Step:* Message the seller in the group above to confirm availability and purchase the item for delivery!',
  ].filter(Boolean).join('\n');
}
