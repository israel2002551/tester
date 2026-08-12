import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { conflict, notFound, unavailable } from '../lib/errors.js';
import { kobo } from '../lib/money.js';
import { advisoryLock, serializable } from '../lib/transactions.js';
import { assertTransition } from '../lib/transitions.js';
import { outbox } from '../lib/records.js';

function payoutKey() {
  if (!env.PAYOUT_ENCRYPTION_KEY) throw unavailable('PAYOUTS_NOT_CONFIGURED', 'Payout destination setup is temporarily unavailable.');
  return createHash('sha256').update(env.PAYOUT_ENCRYPTION_KEY).digest();
}

export function protectAccountNumber(accountNumber) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', payoutKey(), iv);
  const encrypted = Buffer.concat([cipher.update(accountNumber, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${Buffer.concat([iv, tag, encrypted]).toString('base64url')}`;
}

export function accountFingerprint(bankCode, accountNumber) {
  return createHash('sha256').update(`${bankCode}:${accountNumber}`).digest('hex');
}

export async function ledgerBalance(db, storeId) {
  const account = await db.ledgerAccount.findUnique({ where: { storeId } });
  if (!account) return { account: null, availableKobo: 0n };
  const aggregate = await db.ledgerEntry.aggregate({ where: { accountId: account.id, availableAt: { lte: new Date() } }, _sum: { amountKobo: true } });
  return { account, availableKobo: aggregate._sum.amountKobo || 0n };
}

export async function requestPayout(db, userId, storeId, destinationId, amountInput) {
  const amountKobo = kobo(amountInput, 'amountKobo');
  if (amountKobo <= 0n) throw conflict('INVALID_PAYOUT_AMOUNT', 'Payout amount must be greater than zero.');
  return serializable(db, async (tx) => {
    const account = await tx.ledgerAccount.findUnique({ where: { storeId } });
    if (!account) throw conflict('NO_LEDGER_ACCOUNT', 'This store does not yet have a seller balance.');
    await advisoryLock(tx, 'ledger', account.id);
    const destination = await tx.payoutDestination.findFirst({ where: { id: destinationId, storeId, active: true, verifiedAt: { not: null } } });
    if (!destination) throw notFound('Verified payout destination');
    const aggregate = await tx.ledgerEntry.aggregate({ where: { accountId: account.id, availableAt: { lte: new Date() } }, _sum: { amountKobo: true } });
    const availableKobo = aggregate._sum.amountKobo || 0n;
    if (amountKobo > availableKobo) throw conflict('INSUFFICIENT_AVAILABLE_BALANCE', 'The requested payout exceeds the available balance.');
    const payoutId = randomUUID();
    const payout = await tx.payoutRequest.create({ data: { id: payoutId, accountId: account.id, destinationId, requestedBy: userId, amountKobo } });
    await tx.ledgerEntry.create({ data: { accountId: account.id, type: 'PAYOUT_HOLD', amountKobo: -amountKobo, idempotencyKey: `payout-hold:${payoutId}`, description: `Funds held for payout ${payoutId}` } });
    await outbox(tx, 'payout.requested', payoutId, { payoutId, storeId, amountKobo: amountKobo.toString() });
    return payout;
  });
}

export async function decidePayout(db, actorId, payoutId, toStatus, reason, auditContext = {}) {
  return serializable(db, async (tx) => {
    const payout = await tx.payoutRequest.findUnique({ where: { id: payoutId } });
    if (!payout) throw notFound('Payout request');
    assertTransition('payout', payout.status, toStatus);
    await advisoryLock(tx, 'ledger', payout.accountId);
    const update = { status: toStatus, decisionReason: reason || null };
    if (['APPROVED', 'REJECTED'].includes(toStatus)) Object.assign(update, { decidedBy: actorId, decidedAt: new Date() });
    if (['REJECTED', 'CANCELLED'].includes(toStatus)) {
      await tx.ledgerEntry.create({ data: { accountId: payout.accountId, type: 'PAYOUT_REVERSAL', amountKobo: payout.amountKobo, idempotencyKey: `payout-reversal:${payout.id}`, description: `Released hold for payout ${payout.id}` } });
    }
    if (toStatus === 'PAID') {
      await tx.ledgerEntry.createMany({ data: [
        { accountId: payout.accountId, type: 'PAYOUT_REVERSAL', amountKobo: payout.amountKobo, idempotencyKey: `payout-final-reversal:${payout.id}`, description: `Converted payout hold ${payout.id}` },
        { accountId: payout.accountId, type: 'PAYOUT_DEBIT', amountKobo: -payout.amountKobo, idempotencyKey: `payout-debit:${payout.id}`, description: `Paid payout ${payout.id}` },
      ], skipDuplicates: true });
    }
    const updated = await tx.payoutRequest.update({ where: { id: payout.id }, data: update });
    await tx.auditLog.create({ data: { actorId, action: 'payout.status_changed', targetType: 'PayoutRequest', targetId: payout.id, before: { status: payout.status }, after: { status: toStatus, reason: reason || null }, requestId: auditContext.requestId, ipAddress: auditContext.ipAddress, userAgent: auditContext.userAgent } });
    await outbox(tx, 'payout.status_changed', payout.id, { payoutId: payout.id, from: payout.status, to: toStatus });
    return updated;
  });
}
