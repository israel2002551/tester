import { env } from '../config/env.js';
import { conflict, notFound } from '../lib/errors.js';
import { reference } from '../lib/ids.js';
import { outbox } from '../lib/records.js';
import { serializable } from '../lib/transactions.js';
import { assertTransition } from '../lib/transitions.js';

function publicItem(item) {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    specifications: item.specifications,
    quantity: item.quantity,
    referenceUrl: item.referenceUrl,
    image: item.imageAsset?.access === 'PUBLIC' ? { id: item.imageAsset.id, url: item.imageAsset.publicUrl } : null,
    targetBudgetKobo: item.targetBudgetKobo,
    quotedUnitKobo: item.quotedUnitKobo,
  };
}

function publicQuote(quote) {
  return {
    id: quote.id,
    subtotalKobo: quote.subtotalKobo,
    serviceKobo: quote.serviceKobo,
    shippingKobo: quote.shippingKobo,
    totalKobo: quote.totalKobo,
    expiresAt: quote.expiresAt,
    acceptedAt: quote.acceptedAt,
    estimatedDeliveryAt: quote.estimatedDeliveryAt,
    terms: quote.terms,
    createdAt: quote.createdAt,
  };
}

export function publicSourcingRequest(request) {
  return {
    id: request.id,
    requestNumber: request.requestNumber,
    status: request.status,
    currency: request.currency,
    deliveryLocation: request.deliveryLocation,
    desiredDeliveryAt: request.desiredDeliveryAt,
    notes: request.notes,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    items: request.items?.map(publicItem) || [],
    quotes: request.quotes?.map(publicQuote) || [],
    history: request.history?.map((entry) => ({ id: entry.id, from: entry.from, to: entry.to, note: entry.note, createdAt: entry.createdAt })) || [],
  };
}

export function internalSourcingRequest(request) {
  return {
    ...publicSourcingRequest(request),
    requester: request.requester && { id: request.requester.id, email: request.requester.email, profile: request.requester.profile },
    assignedAdminId: request.assignedAdminId,
    procurement: request.procurement ? {
      id: request.procurement.id,
      sourcePlatform: request.procurement.sourcePlatform,
      providerCode: request.procurement.providerCode,
      sourceUrl: request.procurement.sourceUrl,
      supplierId: request.procurement.supplierId,
      supplierReference: request.procurement.supplierReference,
      supplierProductId: request.procurement.supplierProductId,
      supplierOrderId: request.procurement.supplierOrderId,
      sourceCurrency: request.procurement.sourceCurrency,
      sourceUnitCostMinor: request.procurement.sourceUnitCostMinor,
      sourceShippingMinor: request.procurement.sourceShippingMinor,
      exchangeRate: request.procurement.exchangeRate,
      internationalShippingKobo: request.procurement.internationalShippingKobo,
      localDeliveryKobo: request.procurement.localDeliveryKobo,
      internalStatus: request.procurement.internalStatus,
      procurementNotes: request.procurement.procurementNotes,
      supplier: request.procurement.supplier && { id: request.procurement.supplier.id, displayName: request.procurement.supplier.displayName },
      createdAt: request.procurement.createdAt,
      updatedAt: request.procurement.updatedAt,
    } : null,
  };
}

const publicInclude = {
  items: { include: { imageAsset: true } },
  quotes: { orderBy: { createdAt: 'desc' } },
  history: { orderBy: { createdAt: 'asc' } },
};

const internalInclude = {
  ...publicInclude,
  requester: { include: { profile: true } },
  procurement: { include: { supplier: true } },
};

export async function createSourcingRequest(db, userId, input) {
  return serializable(db, async (tx) => {
    const request = await tx.sourcingRequest.create({
      data: {
        requestNumber: reference('SRC'), requesterId: userId, status: 'REQUEST_SUBMITTED', currency: 'NGN',
        deliveryLocation: input.deliveryLocation, desiredDeliveryAt: input.desiredDeliveryAt, notes: input.notes,
        items: { create: input.items.map((item) => ({
          title: item.title, description: item.description, specifications: item.specifications || {}, quantity: item.quantity,
          referenceUrl: item.referenceUrl || null, imageAssetId: item.imageAssetId || null,
          targetBudgetKobo: item.targetBudgetKobo === undefined ? null : BigInt(item.targetBudgetKobo),
        })) },
      },
      include: publicInclude,
    });
    await tx.sourcingStatusHistory.create({ data: { requestId: request.id, to: 'REQUEST_SUBMITTED', actorId: userId, note: 'Request submitted' } });
    await outbox(tx, 'sourcing.requested', request.id, { requestId: request.id, requesterId: userId });
    return publicSourcingRequest(request);
  });
}

export async function listOwnSourcing(db, userId, { skip, limit }) {
  const [requests, total] = await Promise.all([
    db.sourcingRequest.findMany({ where: { requesterId: userId }, include: publicInclude, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    db.sourcingRequest.count({ where: { requesterId: userId } }),
  ]);
  return { requests: requests.map(publicSourcingRequest), total };
}

export async function getOwnSourcing(db, userId, id) {
  const request = await db.sourcingRequest.findFirst({ where: { id, requesterId: userId }, include: publicInclude });
  if (!request) throw notFound('Sourcing request');
  return publicSourcingRequest(request);
}

export async function acceptSourcingQuote(db, userId, requestId, quoteId) {
  return serializable(db, async (tx) => {
    const request = await tx.sourcingRequest.findFirst({ where: { id: requestId, requesterId: userId }, include: { quotes: true } });
    if (!request) throw notFound('Sourcing request');
    if (request.status !== 'QUOTE_READY') throw conflict('QUOTE_NOT_ACCEPTABLE', 'This request is not waiting for quote acceptance.');
    const quote = request.quotes.find((item) => item.id === quoteId);
    if (!quote || quote.expiresAt <= new Date()) throw conflict('QUOTE_EXPIRED', 'This sourcing quote is unavailable or expired.');
    assertTransition('sourcing', request.status, 'AWAITING_PAYMENT');
    await tx.sourcingQuote.update({ where: { id: quote.id }, data: { acceptedAt: new Date() } });
    await tx.sourcingRequest.update({ where: { id: request.id }, data: { status: 'AWAITING_PAYMENT' } });
    await tx.sourcingStatusHistory.create({ data: { requestId: request.id, from: request.status, to: 'AWAITING_PAYMENT', actorId: userId, note: 'Quote accepted' } });
    await outbox(tx, 'sourcing.quote_accepted', request.id, { requestId: request.id, quoteId });
    return getOwnSourcing(tx, userId, request.id);
  });
}

export async function listInternalSourcing(db, query, { skip, limit }) {
  const where = { ...(query.status ? { status: query.status } : {}), ...(query.assignedToMe ? { assignedAdminId: query.actorId } : {}) };
  const [requests, total] = await Promise.all([
    db.sourcingRequest.findMany({ where, include: internalInclude, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    db.sourcingRequest.count({ where }),
  ]);
  return { requests: requests.map(internalSourcingRequest), total };
}

export async function getInternalSourcing(db, id) {
  const request = await db.sourcingRequest.findUnique({ where: { id }, include: internalInclude });
  if (!request) throw notFound('Sourcing request');
  return internalSourcingRequest(request);
}

export async function updateInternalSourcing(db, actorId, requestId, input) {
  return serializable(db, async (tx) => {
    const request = await tx.sourcingRequest.findUnique({ where: { id: requestId } });
    if (!request) throw notFound('Sourcing request');
    if (input.status) assertTransition('sourcing', request.status, input.status);
    await tx.sourcingRequest.update({ where: { id: requestId }, data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.assignedAdminId !== undefined ? { assignedAdminId: input.assignedAdminId } : {}),
    } });
    if (input.status && input.status !== request.status) {
      await tx.sourcingStatusHistory.create({ data: { requestId, from: request.status, to: input.status, actorId, note: input.note } });
      await outbox(tx, 'sourcing.status_changed', requestId, { requestId, from: request.status, to: input.status });
    }
    return getInternalSourcing(tx, requestId);
  });
}

export async function upsertProcurement(db, requestId, input) {
  const data = {
    sourcePlatform: input.sourcePlatform,
    providerCode: input.providerCode || env.PROCUREMENT_SOURCE_PROVIDER || null,
    sourceUrl: input.sourceUrl || null,
    supplierId: input.supplierId || null,
    supplierReference: input.supplierReference || null,
    supplierProductId: input.supplierProductId || null,
    supplierOrderId: input.supplierOrderId || null,
    sourceCurrency: input.sourceCurrency || null,
    sourceUnitCostMinor: input.sourceUnitCostMinor === undefined ? null : BigInt(input.sourceUnitCostMinor),
    sourceShippingMinor: input.sourceShippingMinor === undefined ? null : BigInt(input.sourceShippingMinor),
    exchangeRate: input.exchangeRate,
    internationalShippingKobo: input.internationalShippingKobo === undefined ? null : BigInt(input.internationalShippingKobo),
    localDeliveryKobo: input.localDeliveryKobo === undefined ? null : BigInt(input.localDeliveryKobo),
    internalStatus: input.internalStatus || null,
    procurementNotes: input.procurementNotes || null,
  };
  await db.sourcingProcurement.upsert({ where: { requestId }, update: data, create: { requestId, ...data } });
  return getInternalSourcing(db, requestId);
}

export async function createSourcingQuote(db, actorId, requestId, input) {
  return serializable(db, async (tx) => {
    const request = await tx.sourcingRequest.findUnique({ where: { id: requestId } });
    if (!request) throw notFound('Sourcing request');
    if (!['UNDER_REVIEW', 'QUOTE_READY'].includes(request.status)) throw conflict('REQUEST_NOT_QUOTABLE', 'Move the request under review before creating a quote.');
    const quote = await tx.sourcingQuote.create({ data: {
      requestId, subtotalKobo: BigInt(input.subtotalKobo), serviceKobo: BigInt(input.serviceKobo), shippingKobo: BigInt(input.shippingKobo),
      totalKobo: BigInt(input.subtotalKobo) + BigInt(input.serviceKobo) + BigInt(input.shippingKobo),
      expiresAt: input.expiresAt, estimatedDeliveryAt: input.estimatedDeliveryAt, terms: input.terms, createdById: actorId,
    } });
    if (request.status !== 'QUOTE_READY') {
      assertTransition('sourcing', request.status, 'QUOTE_READY');
      await tx.sourcingRequest.update({ where: { id: requestId }, data: { status: 'QUOTE_READY' } });
      await tx.sourcingStatusHistory.create({ data: { requestId, from: request.status, to: 'QUOTE_READY', actorId, note: 'Quote prepared' } });
    }
    await outbox(tx, 'sourcing.quote_ready', requestId, { requestId, quoteId: quote.id });
    return quote;
  });
}
