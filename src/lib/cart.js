export function normalizeCartItem(item = {}) {
  const rawQuantity = Number(item.qty ?? item.quantity);
  const qty = Number.isFinite(rawQuantity) && rawQuantity > 0 ? Math.floor(rawQuantity) : 1;
  const imageCandidate = item.image_url || item.image || item.images?.[0] || '';
  const image = typeof imageCandidate === 'string' ? imageCandidate : '';
  const sellerId = item.seller_id || item.sellerId || item.store_id || item.storeId || item.profiles?.id || item.seller?.id || null;

  return {
    ...item,
    qty,
    quantity: qty,
    image_url: image,
    image,
    seller_id: sellerId,
    sellerId,
    store_id: item.store_id || sellerId,
  };
}

export function normalizeCart(items) {
  return Array.isArray(items)
    ? items.filter(item => item && item.id).map(normalizeCartItem)
    : [];
}
