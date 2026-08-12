import { badRequest } from './errors.js';

export function kobo(value, field = 'amount') {
  if (typeof value === 'bigint') return value;
  if ((typeof value === 'number' && Number.isSafeInteger(value)) || /^\d+$/.test(String(value))) {
    const amount = BigInt(value);
    if (amount >= 0n) return amount;
  }
  throw badRequest('INVALID_MONEY', `${field} must be a non-negative integer number of kobo.`);
}

export function percentage(amount, basisPoints) {
  return (amount * BigInt(basisPoints)) / 10_000n;
}

export function majorUnits(amountKobo) {
  const value = kobo(amountKobo);
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

export function clampDiscount(discount, subtotal) {
  return discount < 0n ? 0n : discount > subtotal ? subtotal : discount;
}
