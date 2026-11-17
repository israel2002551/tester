// BUYSELL's commission, added to the seller's price to make the price buyers pay.
// It depends on the seller's price for one item:
//   below ₦300,000                 8%
//   ₦300,000 up to ₦999,999        6%
//   ₦1,000,000 and above           4%
// The same rule is in app.js (seller price previews), the product import service
// (services/product-ingestion-api) and the database repricing migration
// (20261117000000_tiered_commission.sql). Change them together.

export const COMMISSION_TIERS = [
  { below: 300_000, percent: 8 },
  { below: 1_000_000, percent: 6 },
  { below: Infinity, percent: 4 },
] as const;

function wholeNaira(value: unknown) {
  const amount = Math.round(Number(value));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

export function commissionPercentForSellerPrice(sellerPrice: unknown) {
  const amount = wholeNaira(sellerPrice);
  return COMMISSION_TIERS.find((tier) => amount < tier.below)?.percent ?? 4;
}

/** The commission in naira on one item at this seller price. */
export function commissionForSellerPrice(sellerPrice: unknown) {
  const amount = wholeNaira(sellerPrice);
  return Math.round((amount * commissionPercentForSellerPrice(amount)) / 100);
}

/** The price buyers pay for one item at this seller price. */
export function buyerPriceForSellerPrice(sellerPrice: unknown) {
  const amount = wholeNaira(sellerPrice);
  return amount + commissionForSellerPrice(amount);
}

/** The seller price behind a buyer price, for listings saved without one. */
export function sellerPriceForBuyerPrice(buyerPrice: unknown) {
  const amount = wholeNaira(buyerPrice);
  for (const tier of COMMISSION_TIERS) {
    const seller = Math.round(amount / (1 + tier.percent / 100));
    if (commissionPercentForSellerPrice(seller) === tier.percent) return seller;
  }
  return Math.round(amount / 1.04);
}
