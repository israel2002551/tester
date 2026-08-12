import {
  asArray,
  isoOrNull,
  migrationEnvelope,
  stableUuid,
  textOrNull,
  uuidOrStable,
} from './common.mjs';

const sourceKey = (table, row) => textOrNull(row.id) || stableUuid(table, JSON.stringify(row));
const date = (value) => isoOrNull(value) || new Date(0).toISOString();
const statusValue = (value) => String(value || '').trim().toLowerCase().replace(/[ -]+/g, '_');
const storeStatus = (value) => ({ active: 'ACTIVE', approved: 'ACTIVE', pending: 'PENDING', draft: 'PENDING', review: 'PENDING', suspended: 'SUSPENDED', rejected: 'SUSPENDED', closed: 'CLOSED', deactivated: 'CLOSED' }[statusValue(value)] || 'PENDING');
const productStatus = (value, active = false) => ({ active: 'ACTIVE', approved: 'ACTIVE', published: 'ACTIVE', draft: 'DRAFT', pending: 'DRAFT', review: 'DRAFT', paused: 'PAUSED', inactive: 'PAUSED', out_of_stock: 'OUT_OF_STOCK', sold_out: 'OUT_OF_STOCK', rejected: 'REJECTED', archived: 'ARCHIVED', deleted: 'ARCHIVED' }[statusValue(value)] || (active ? 'ACTIVE' : 'DRAFT'));
const orderStatus = (value, fallback = 'PENDING_PAYMENT') => ({ pending: 'PENDING_PAYMENT', pending_payment: 'PENDING_PAYMENT', awaiting_payment: 'PENDING_PAYMENT', payment_processing: 'PAYMENT_PROCESSING', paid: 'PAID', confirmed: 'PAID', processing: 'PROCESSING', ready: 'READY', picked_up: 'IN_TRANSIT', shipped: 'IN_TRANSIT', in_transit: 'IN_TRANSIT', out_for_delivery: 'OUT_FOR_DELIVERY', delivered: 'DELIVERED', completed: 'DELIVERED', cancelled: 'CANCELLED', canceled: 'CANCELLED', rejected: 'CANCELLED', disputed: 'DISPUTED', refund_pending: 'REFUND_PENDING', refunded: 'REFUNDED' }[statusValue(value)] || fallback);
const payoutStatus = (value) => ({ pending: 'REQUESTED', requested: 'REQUESTED', review: 'UNDER_REVIEW', under_review: 'UNDER_REVIEW', approved: 'APPROVED', processing: 'PROCESSING', paid: 'PAID', completed: 'PAID', rejected: 'REJECTED', cancelled: 'CANCELLED', canceled: 'CANCELLED' }[statusValue(value)] || 'REQUESTED');
const kycSubjectType = (value) => ({ user: 'USER', buyer: 'USER', individual: 'USER', store: 'STORE', seller: 'STORE', business: 'STORE', supplier: 'SUPPLIER' }[statusValue(value)] || 'USER');
const broadcastChannel = (value) => ({ email: 'EMAIL', push: 'PUSH', web_push: 'PUSH', in_app: 'IN_APP', notification: 'IN_APP' }[statusValue(value)] || 'IN_APP');
const reviewStatus = (value) => ({ active: 'PUBLISHED', approved: 'PUBLISHED', published: 'PUBLISHED', hidden: 'HIDDEN', removed: 'REMOVED', rejected: 'REMOVED' }[String(value || '').toLowerCase()] || 'PUBLISHED');
const kycStatus = (value) => ({ pending: 'SUBMITTED', submitted: 'SUBMITTED', review: 'UNDER_REVIEW', in_review: 'UNDER_REVIEW', approved: 'APPROVED', rejected: 'REJECTED', draft: 'DRAFT' }[String(value || '').toLowerCase()] || 'SUBMITTED');
const adStatus = (value) => ({ pending: 'PENDING_REVIEW', pending_payment: 'AWAITING_PAYMENT', approved: 'ACTIVE', active: 'ACTIVE', paused: 'PAUSED', rejected: 'REJECTED', completed: 'COMPLETED', draft: 'DRAFT' }[String(value || '').toLowerCase()] || 'DRAFT');
const sourcingStatus = (value) => ({ pending: 'REQUEST_SUBMITTED', submitted: 'REQUEST_SUBMITTED', request_submitted: 'REQUEST_SUBMITTED', review: 'UNDER_REVIEW', in_review: 'UNDER_REVIEW', quoted: 'QUOTE_READY', quote_ready: 'QUOTE_READY', awaiting_payment: 'AWAITING_PAYMENT', paid: 'PAYMENT_CONFIRMED', processing: 'PROCUREMENT_IN_PROGRESS', procured: 'PROCURED', shipped: 'INTERNATIONAL_TRANSIT', arrived: 'ARRIVED_IN_COUNTRY', local_delivery: 'LOCAL_FULFILMENT', delivered: 'COMPLETED', completed: 'COMPLETED', cancelled: 'CANCELLED', draft: 'DRAFT' }[String(value || '').toLowerCase()] || 'REQUEST_SUBMITTED');
const disputeStatus = (value) => ({ open: 'OPEN', pending: 'UNDER_REVIEW', under_review: 'UNDER_REVIEW', buyer: 'AWAITING_BUYER', seller: 'AWAITING_SELLER', resolved: 'CLOSED', resolved_buyer: 'RESOLVED_BUYER', resolved_seller: 'RESOLVED_SELLER', closed: 'CLOSED' }[String(value || '').toLowerCase()] || 'OPEN');
const serviceBookingStatus = (value) => ({ pending: 'REQUESTED', requested: 'REQUESTED', accepted: 'ACCEPTED', confirmed: 'ACCEPTED', in_progress: 'IN_PROGRESS', processing: 'IN_PROGRESS', completed: 'COMPLETED', cancelled: 'CANCELLED', rejected: 'CANCELLED', declined: 'CANCELLED' }[String(value || '').toLowerCase()] || 'REQUESTED');
const bool = (value) => value === true || value === 1 || ['true', 'yes', 'active'].includes(String(value || '').toLowerCase());
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const integer = (value, fallback = 0) => Math.trunc(number(value, fallback));
const kobo = (minor, major = 0) => {
  if (minor != null && minor !== '') return String(Math.max(0, integer(minor)));
  return String(Math.max(0, Math.round(number(major) * 100)));
};
const slug = (value, fallback) => String(value || fallback || 'item').toLowerCase().normalize('NFKD')
  .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 90) || fallback;

function mediaUrls(row) {
  return [...new Set([
    ...asArray(row.images), ...asArray(row.image_urls), ...asArray(row.media_urls),
    row.image_url, row.image, row.logo_url, row.proof_url,
  ].filter((item) => typeof item === 'string' && /^https?:\/\//i.test(item)))];
}

function profile(row) {
  const legacyId = sourceKey('profiles', row);
  const userId = uuidOrStable(legacyId, 'user', legacyId);
  const name = textOrNull(row.name || row.full_name || row.display_name, 180);
  const role = String(row.role || '').toLowerCase();
  const records = [
    migrationEnvelope('profiles', row, 'User', {
      id: userId,
      email: textOrNull(row.email, 320)?.toLowerCase() || null,
      status: bool(row.is_suspended) ? 'SUSPENDED' : 'ACTIVE',
      createdAt: date(row.created_at),
      legacy: { sourceId: legacyId },
    }),
    migrationEnvelope('profiles', row, 'AuthIdentity', {
      id: stableUuid('auth-identity', legacyId), userId, provider: 'SUPABASE',
      providerSubject: legacyId, providerEmail: textOrNull(row.email, 320)?.toLowerCase() || null,
    }),
    migrationEnvelope('profiles', row, 'UserProfile', {
      userId, displayName: name, firstName: textOrNull(row.first_name, 100), lastName: textOrNull(row.last_name, 100),
      phone: textOrNull(row.phone || row.whatsapp, 40), location: textOrNull(row.location || row.state, 180),
      metadata: { legacyRole: role || null },
    }),
  ];
  if (['seller', 'vendor', 'merchant'].includes(role)) {
    const storeId = stableUuid('store', legacyId);
    records.push(
      migrationEnvelope('profiles', row, 'Store', {
        id: storeId, ownerId: userId, slug: slug(row.store_slug || row.business_name || name, `seller-${legacyId.slice(0, 8)}`),
        name: textOrNull(row.business_name || row.store_name || name, 180) || 'Imported BUYSELL Store',
        description: textOrNull(row.business_description || row.bio),
        status: bool(row.is_suspended) ? 'SUSPENDED' : storeStatus(row.store_status || 'active'),
        supportEmail: textOrNull(row.email, 320), supportPhone: textOrNull(row.whatsapp || row.phone, 40),
        location: textOrNull(row.location || row.state, 180), metadata: { legacySellerId: legacyId },
      }),
      migrationEnvelope('profiles', row, 'StoreMembership', {
        id: stableUuid('store-owner', legacyId), storeId, userId, role: 'OWNER', status: 'ACTIVE',
      }),
      migrationEnvelope('profiles', row, 'LedgerAccount', {
        id: stableUuid('ledger', storeId), storeId, currency: 'NGN',
      }),
    );
  }
  return records;
}

function product(row) {
  const legacyId = sourceKey('products', row);
  const sellerId = row.seller_id || row.user_id || row.owner_id || 'unlinked';
  const storeId = stableUuid('store', sellerId);
  const productId = uuidOrStable(legacyId, 'product', legacyId);
  const variantId = stableUuid('variant', legacyId, row.sku || 'default');
  const records = [
    migrationEnvelope('products', row, 'Product', {
      id: productId, storeId, categoryLegacyId: textOrNull(row.category_id || row.category),
      slug: slug(row.slug || row.name || row.title, `product-${legacyId.slice(0, 8)}`),
      name: textOrNull(row.name || row.title, 220) || 'Imported product',
      description: textOrNull(row.description), condition: ({ used: 'USED', refurbished: 'REFURBISHED' }[String(row.condition || '').toLowerCase()] || 'NEW'),
      status: productStatus(row.status, bool(row.active)),
      shippingFeeKobo: kobo(row.shipping_fee_kobo, row.shipping_fee), negotiable: bool(row.negotiable),
      metadata: { legacyProductId: legacyId }, publishedAt: isoOrNull(row.published_at || row.created_at),
      createdAt: date(row.created_at),
    }),
    migrationEnvelope('products', row, 'ProductVariant', {
      id: variantId, productId, sku: textOrNull(row.sku, 100) || `LEGACY-${legacyId.slice(0, 12)}`,
      name: textOrNull(row.variant_name || row.variant, 160), priceKobo: kobo(row.price_kobo, row.price),
      compareAtKobo: row.compare_at_kobo != null || row.old_price != null ? kobo(row.compare_at_kobo, row.old_price) : null,
      attributes: row.attributes && typeof row.attributes === 'object' ? row.attributes : {}, active: productStatus(row.status, bool(row.active)) === 'ACTIVE',
    }),
    migrationEnvelope('products', row, 'InventoryItem', {
      variantId, onHand: Math.max(0, integer(row.stock_quantity ?? row.stock ?? row.quantity)), reserved: 0,
      reorderPoint: Math.max(0, integer(row.reorder_point, 0)), version: 0,
    }),
  ];
  mediaUrls(row).forEach((url, index) => {
    const assetId = stableUuid('product-media', legacyId, url);
    records.push(
      migrationEnvelope('products', row, 'MediaAsset', {
        id: assetId, ownerLegacyId: sellerId, provider: 'legacy-supabase', providerAssetId: `legacy:${legacyId}:${index}`,
        kind: /\.(mp4|webm)(\?|$)/i.test(url) ? 'VIDEO' : 'IMAGE', mimeType: 'application/octet-stream', bytes: 0,
        access: 'PUBLIC', publicUrl: url, metadata: { requiresCopy: true, legacyUrl: url },
      }),
      migrationEnvelope('products', row, 'ProductMedia', { productId, assetId, sortOrder: index }),
    );
  });
  return records;
}

function order(row) {
  const legacyId = sourceKey('orders', row);
  const orderId = uuidOrStable(legacyId, 'order', legacyId);
  const buyerId = uuidOrStable(row.buyer_id, 'user', row.buyer_id || 'missing-buyer', legacyId);
  const sellerId = row.seller_id || row.vendor_id || 'unlinked';
  const storeId = stableUuid('store', sellerId);
  const storeOrderId = stableUuid('store-order', legacyId, storeId);
  const normalizedOrderStatus = orderStatus(row.status);
  const reportedTotal = BigInt(kobo(row.total_kobo, row.total_amount || row.total));
  const shippingKobo = BigInt(kobo(row.shipping_kobo, row.delivery_fee || row.shipping_fee));
  const reportedDiscountKobo = BigInt(kobo(row.discount_kobo, row.discount));
  const platformFeeKobo = BigInt(kobo(row.platform_fee_kobo, row.platform_fee));
  const explicitSubtotal = row.subtotal_kobo != null || row.subtotal != null;
  const subtotalKobo = explicitSubtotal
    ? BigInt(kobo(row.subtotal_kobo, row.subtotal))
    : (reportedTotal - shippingKobo - platformFeeKobo + reportedDiscountKobo > 0n ? reportedTotal - shippingKobo - platformFeeKobo + reportedDiscountKobo : reportedTotal);
  const discountKobo = reportedDiscountKobo > subtotalKobo + shippingKobo + platformFeeKobo
    ? subtotalKobo + shippingKobo + platformFeeKobo
    : reportedDiscountKobo;
  const totalKobo = subtotalKobo + shippingKobo + platformFeeKobo - discountKobo;
  const paymentStatus = normalizedOrderStatus === 'REFUNDED' ? 'REFUNDED'
    : normalizedOrderStatus === 'REFUND_PENDING' ? 'REFUND_PENDING'
      : ['PAID', 'PROCESSING', 'READY', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DISPUTED'].includes(normalizedOrderStatus) ? 'PAID' : 'PENDING';
  const items = asArray(row.items);
  const records = [
    migrationEnvelope('orders', row, 'ImportedOrderBundle', {
      order: {
        id: orderId, orderNumber: textOrNull(row.order_number, 80) || `LEG-${legacyId.slice(0, 12).toUpperCase()}`,
        idempotencyKey: `migration:${legacyId}`, buyerId, status: normalizedOrderStatus,
        paymentStatus,
        currency: String(row.currency || 'NGN').toUpperCase(), totalKobo: String(totalKobo), subtotalKobo: String(subtotalKobo),
        shippingKobo: String(shippingKobo), discountKobo: String(discountKobo),
        platformFeeKobo: String(platformFeeKobo), deliveryMethod: textOrNull(row.delivery_method, 80) || 'legacy',
        addressSnapshot: { recipientName: row.delivery_name || null, phone: row.delivery_phone || null, address: row.delivery_address || null },
        placedAt: date(row.created_at), paidAt: isoOrNull(row.paid_at), deliveredAt: isoOrNull(row.delivered_at),
        migrationMetadata: { reportedTotalKobo: String(reportedTotal) },
      },
      storeOrder: { id: storeOrderId, storeId, status: normalizedOrderStatus, totalKobo: String(totalKobo) },
      items: items.map((item, index) => ({
        id: item.order_item_id || item.line_id
          ? uuidOrStable(item.order_item_id || item.line_id, 'order-item', item.order_item_id || item.line_id)
          : stableUuid('order-item', legacyId, index), productLegacyId: item.product_id || item.id || null,
        variantId: stableUuid('variant', item.product_id || item.id || legacyId, item.sku || 'default'),
        productName: textOrNull(item.name || item.title, 220) || 'Imported item', variantName: textOrNull(item.variant, 160),
        sku: textOrNull(item.sku, 100) || `LEGACY-${index + 1}`, unitPriceKobo: kobo(item.unit_price_kobo, item.price),
        shippingUnitKobo: '0', quantity: Math.max(1, integer(item.quantity, 1)), totalKobo: kobo(item.total_kobo, number(item.price) * Math.max(1, integer(item.quantity, 1))),
      })),
    }),
  ];
  return records;
}

function message(row) {
  const legacyId = sourceKey('messages', row);
  const senderId = uuidOrStable(row.sender_id, 'user', row.sender_id || 'unknown', legacyId);
  const conversationId = uuidOrStable(row.conversation_id, 'conversation', row.order_id || row.recipient_id || legacyId);
  return [migrationEnvelope('messages', row, 'MessageBundle', {
    conversation: { id: conversationId, type: row.order_id ? 'ORDER' : 'DIRECT', orderLegacyId: row.order_id || null },
    members: [row.sender_id, row.recipient_id].filter(Boolean).map((id) => uuidOrStable(id, 'user', id)),
    message: { id: uuidOrStable(legacyId, 'message', legacyId), conversationId, senderId, type: 'TEXT',
      body: textOrNull(row.body || row.message || row.content) || '', createdAt: date(row.created_at) },
  })];
}

function review(row) {
  const legacyId = sourceKey('reviews', row);
  return [migrationEnvelope('reviews', row, 'Review', {
    id: uuidOrStable(legacyId, 'review', legacyId), orderItemId: row.order_item_id ? uuidOrStable(row.order_item_id, 'order-item', row.order_item_id) : null,
    orderId: row.order_id ? uuidOrStable(row.order_id, 'order', row.order_id) : null,
    productId: uuidOrStable(row.product_id, 'product', row.product_id || legacyId),
    buyerId: uuidOrStable(row.reviewer_id || row.buyer_id, 'user', row.reviewer_id || row.buyer_id || legacyId),
    rating: Math.min(5, Math.max(1, integer(row.rating, 5))),
    body: textOrNull(row.body || row.review || row.comment), status: reviewStatus(row.status), createdAt: date(row.created_at),
  })];
}

function payout(row) {
  const legacyId = sourceKey('withdrawals', row);
  const storeId = stableUuid('store', row.seller_id || row.user_id || 'unlinked');
  return [migrationEnvelope('withdrawals', row, 'ImportedPayoutBundle', {
    ledgerAccountId: stableUuid('ledger', storeId), storeId,
    payout: { id: uuidOrStable(legacyId, 'payout', legacyId), amountKobo: kobo(row.amount_kobo, row.amount),
      status: payoutStatus(row.status), requestedAt: date(row.created_at), legacyReference: row.reference || null },
    warning: 'Bank details are intentionally excluded; create encrypted payout destinations through the target application.',
  })];
}

function kyc(row) {
  const legacyId = sourceKey('kyc_verifications', row);
  return [migrationEnvelope('kyc_verifications', row, 'ImportedKycBundle', {
    submission: { id: uuidOrStable(legacyId, 'kyc', legacyId), submittedById: uuidOrStable(row.user_id || row.seller_id, 'user', row.user_id || row.seller_id || legacyId),
      subjectType: kycSubjectType(row.subject_type || (row.seller_id ? 'seller' : 'user')), subjectId: String(row.subject_id || row.user_id || row.seller_id || legacyId), status: kycStatus(row.status),
      submittedAt: date(row.created_at), reviewedAt: isoOrNull(row.reviewed_at), decisionReason: textOrNull(row.review_note || row.reason) },
    privateMedia: mediaUrls(row).map((url, index) => ({ id: stableUuid('kyc-media', legacyId, index), legacyUrl: url, access: 'PRIVATE' })),
  })];
}

function ad(row, sourceTable = 'advertisements') {
  const legacyId = sourceKey(sourceTable, row);
  return [migrationEnvelope(sourceTable, row, 'AdCampaign', {
    id: uuidOrStable(legacyId, 'ad', legacyId), storeId: stableUuid('store', row.seller_id || row.store_id || 'unlinked'),
    name: textOrNull(row.name || row.title, 180) || 'Imported campaign', status: adStatus(row.status),
    placement: textOrNull(row.placement, 80) || 'marketplace', headline: textOrNull(row.headline || row.title, 180) || 'Imported campaign',
    body: textOrNull(row.body || row.description), destinationUrl: textOrNull(row.destination_url || row.link, 2048) || '/',
    budgetKobo: kobo(row.budget_kobo, row.budget || row.amount), spentKobo: kobo(row.spent_kobo, row.spent),
    startsAt: isoOrNull(row.starts_at || row.start_date), endsAt: isoOrNull(row.ends_at || row.end_date),
  })];
}

function sourcing(row, sourceTable = 'sourcing_requests') {
  const legacyId = sourceKey(sourceTable, row);
  const requestId = uuidOrStable(legacyId, 'sourcing-request', legacyId);
  const rawItems = asArray(row.items || row.products || row.cart);
  const referenceUrl = textOrNull(row.reference_url || row.product_url || row.source_url || row.url, 2048);
  return [
    migrationEnvelope(sourceTable, row, 'SourcingRequest', {
      id: requestId, requestNumber: textOrNull(row.request_number, 80) || `SRC-${legacyId.slice(0, 12).toUpperCase()}`,
      requesterId: uuidOrStable(row.requester_id || row.user_id || row.seller_id, 'user', row.requester_id || row.user_id || row.seller_id || legacyId),
      status: sourcingStatus(row.status), currency: String(row.currency || 'NGN').toUpperCase(),
      deliveryLocation: textOrNull(row.delivery_location || row.destination || row.location, 300), notes: textOrNull(row.notes || row.note),
      createdAt: date(row.created_at),
    }),
    ...((rawItems.length ? rawItems : [{ title: row.title || row.product_name, reference_url: referenceUrl, quantity: row.quantity }]).map((item, index) =>
      migrationEnvelope(sourceTable, row, 'SourcingItem', {
        id: stableUuid('sourcing-item', legacyId, index), requestId,
        title: textOrNull(item.title || item.name || item.product_name, 220) || 'Imported sourcing item',
        description: textOrNull(item.description || item.note), specifications: item.specifications && typeof item.specifications === 'object' ? item.specifications : {},
        quantity: Math.max(1, integer(item.quantity || item.qty, 1)), referenceUrl: textOrNull(item.reference_url || item.url || item.link || referenceUrl, 2048),
        targetBudgetKobo: item.target_budget != null || item.desired_price != null ? kobo(item.target_budget_kobo, item.target_budget || item.desired_price) : null,
      }),
    )),
    migrationEnvelope(sourceTable, row, 'SourcingProcurement', {
      id: stableUuid('sourcing-procurement', legacyId), requestId,
      sourcePlatform: 'EXTERNAL_MARKETPLACE', providerCode: textOrNull(row.provider || row.source_provider, 80),
      sourceUrl: referenceUrl, supplierReference: textOrNull(row.supplier || row.supplier_reference, 300),
      supplierProductId: textOrNull(row.supplier_product_id, 180), supplierOrderId: textOrNull(row.supplier_order_id, 180),
      sourceCurrency: textOrNull(row.source_currency, 12), sourceUnitCostMinor: row.source_cost != null ? kobo(row.source_cost_minor, row.source_cost) : null,
      procurementNotes: textOrNull(row.internal_notes || row.procurement_notes), internalStatus: textOrNull(row.internal_status || row.status, 120),
      confidentiality: 'INTERNAL_ONLY',
    }),
  ];
}

function tracking(row) {
  const legacyId = sourceKey('order_tracking', row);
  return [migrationEnvelope('order_tracking', row, 'OrderStatusEvent', {
    id: uuidOrStable(legacyId, 'order-status-event', legacyId),
    orderId: uuidOrStable(row.order_id, 'order', row.order_id || legacyId),
    fromStatus: row.from_status ? orderStatus(row.from_status, null) : null,
    toStatus: orderStatus(row.status || row.to_status, 'PROCESSING'),
    actorId: row.created_by ? uuidOrStable(row.created_by, 'user', row.created_by) : null,
    note: textOrNull(row.note || row.message), metadata: { legacyEventId: legacyId }, createdAt: date(row.created_at),
  })];
}

function wallet(row) {
  const legacyId = sourceKey('wallet_transactions', row);
  const storeId = stableUuid('store', row.seller_id || row.user_id || 'unlinked');
  const amountMajor = number(row.amount);
  const rawType = String(row.type || row.transaction_type || '').toLowerCase();
  const debit = rawType.includes('debit') || rawType.includes('withdraw') || amountMajor < 0;
  const signedMinor = Math.round(Math.abs(amountMajor) * 100) * (debit ? -1 : 1);
  if (!signedMinor) return generic('wallet_transactions', { ...row, migration_warning: 'Zero-value ledger entries require review.' });
  return [migrationEnvelope('wallet_transactions', row, 'LedgerEntry', {
    id: uuidOrStable(legacyId, 'ledger-entry', legacyId), accountId: stableUuid('ledger', storeId),
    type: debit ? 'ADJUSTMENT' : 'SALE_CREDIT', amountKobo: String(signedMinor),
    idempotencyKey: `migration:wallet:${legacyId}`, description: textOrNull(row.description || row.note, 500) || 'Imported legacy wallet transaction',
    availableAt: date(row.available_at || row.created_at), metadata: { legacyType: rawType || null, legacyReference: row.reference || null }, createdAt: date(row.created_at),
  })];
}

function dispute(row) {
  const legacyId = sourceKey('disputes', row);
  return [migrationEnvelope('disputes', row, 'Dispute', {
    id: uuidOrStable(legacyId, 'dispute', legacyId), orderId: uuidOrStable(row.order_id, 'order', row.order_id || legacyId),
    openedById: uuidOrStable(row.user_id || row.buyer_id || row.opened_by_id, 'user', row.user_id || row.buyer_id || row.opened_by_id || legacyId),
    reason: textOrNull(row.dispute_type || row.issue_type || row.type || row.reason, 180) || 'Legacy dispute',
    description: textOrNull(row.description || row.details || row.message || row.note) || 'No legacy description was available.',
    status: disputeStatus(row.status), resolution: textOrNull(row.resolution), createdAt: date(row.created_at),
  })];
}

function serviceListing(row) {
  const legacyId = sourceKey('service_gigs', row);
  return [migrationEnvelope('service_gigs', row, 'ServiceListing', {
    id: uuidOrStable(legacyId, 'service-listing', legacyId), providerId: uuidOrStable(row.provider_id || row.user_id, 'user', row.provider_id || row.user_id || legacyId),
    slug: slug(row.slug || row.title, `service-${legacyId.slice(0, 8)}`), title: textOrNull(row.title, 220) || 'Imported service',
    description: textOrNull(row.description) || 'Imported service listing.', category: textOrNull(row.category, 120) || 'Other',
    location: textOrNull(row.location, 180), startingKobo: row.starting_rate != null || row.price != null ? kobo(row.starting_rate_kobo, row.starting_rate || row.price) : null,
    active: !['inactive', 'paused', 'rejected', 'deleted', 'archived', 'closed'].includes(statusValue(row.status)), metadata: { legacyPortfolioUrls: asArray(row.portfolio_urls), legacyWhatsapp: row.whatsapp || null }, createdAt: date(row.created_at),
  })];
}

function serviceBooking(row) {
  const legacyId = sourceKey('service_bookings', row);
  return [migrationEnvelope('service_bookings', row, 'ServiceBooking', {
    id: uuidOrStable(legacyId, 'service-booking', legacyId), listingId: uuidOrStable(row.gig_id || row.listing_id, 'service-listing', row.gig_id || row.listing_id || legacyId),
    customerId: uuidOrStable(row.customer_id || row.buyer_id || row.user_id, 'user', row.customer_id || row.buyer_id || row.user_id || legacyId),
    status: serviceBookingStatus(row.status), agreedKobo: row.amount != null || row.agreed_price != null ? kobo(row.amount_kobo, row.amount || row.agreed_price) : null,
    scheduledFor: isoOrNull(row.scheduled_for || row.booking_date), notes: textOrNull(row.notes || row.message), createdAt: date(row.created_at),
  })];
}

function hub(row) {
  const legacyId = sourceKey('safe_hubs', row);
  return [migrationEnvelope('safe_hubs', row, 'FulfilmentHub', {
    id: uuidOrStable(legacyId, 'fulfilment-hub', legacyId), name: textOrNull(row.name || row.title, 180) || 'Imported fulfilment hub',
    slug: slug(row.slug || row.name || row.title, `hub-${legacyId.slice(0, 8)}`),
    address: { line1: row.address || row.location || null, city: row.city || null, state: row.state || null, country: row.country || 'Nigeria' },
    latitude: decimalOrNullSafe(row.latitude || row.lat), longitude: decimalOrNullSafe(row.longitude || row.lng), active: !['inactive', 'closed'].includes(String(row.status || '').toLowerCase()),
    createdAt: date(row.created_at),
  })];
}

function decimalOrNullSafe(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : null;
}

function pushSubscription(row) {
  const legacyId = sourceKey('push_subscriptions', row);
  const keys = row.keys && typeof row.keys === 'object' ? row.keys : {};
  return [migrationEnvelope('push_subscriptions', row, 'PushSubscription', {
    id: uuidOrStable(legacyId, 'push-subscription', legacyId), userId: uuidOrStable(row.user_id, 'user', row.user_id || legacyId),
    endpoint: textOrNull(row.endpoint, 4096) || `invalid-legacy-endpoint:${legacyId}`,
    p256dh: textOrNull(row.p256dh || keys.p256dh, 1024), auth: textOrNull(row.auth || keys.auth, 1024), provider: 'web-push',
    deviceMeta: { requiresValidation: !row.endpoint }, createdAt: date(row.created_at), lastUsedAt: date(row.updated_at || row.created_at),
  })];
}

function broadcast(row) {
  const legacyId = sourceKey('broadcasts', row);
  const broadcastStatus = ({ sent: 'SENT', processing: 'PROCESSING', scheduled: 'SCHEDULED', failed: 'FAILED', cancelled: 'CANCELLED' }[String(row.status || '').toLowerCase()] || 'DRAFT');
  return [migrationEnvelope('broadcasts', row, 'BroadcastCampaign', {
    id: uuidOrStable(legacyId, 'broadcast', legacyId), createdById: uuidOrStable(row.created_by || row.admin_id || row.user_id, 'user', row.created_by || row.admin_id || row.user_id || legacyId),
    subject: textOrNull(row.subject || row.title, 220) || 'Imported announcement', previewText: textOrNull(row.preview_text, 300),
    content: textOrNull(row.content || row.message || row.body) || '', channel: broadcastChannel(row.channel),
    audience: row.audience && typeof row.audience === 'object' ? row.audience : { legacyAudience: row.audience || row.target || 'all' },
    status: broadcastStatus, scheduledAt: isoOrNull(row.scheduled_at), sentAt: isoOrNull(row.sent_at), createdAt: date(row.created_at),
  })];
}

function generic(table, row) {
  return [migrationEnvelope(table, row, 'LegacyReviewQueue', {
    id: stableUuid('legacy-review', table, sourceKey(table, row)), sourceTable: table,
    sourceId: sourceKey(table, row), payload: row, requiresManualMapping: true,
  })];
}

export function transformSourceRow(table, row) {
  if (table === 'profiles') return profile(row);
  if (table === 'products') return product(row);
  if (table === 'orders') {
    const kind = String(row.type || row.order_type || row.category || '').toLowerCase();
    return kind.includes('sourc') || row.source_url || row.sourcing_items ? sourcing(row, table) : order(row);
  }
  if (table === 'messages') return message(row);
  if (table === 'reviews') return review(row);
  if (table === 'order_tracking') return tracking(row);
  if (table === 'wallet_transactions') return wallet(row);
  if (table === 'withdrawals') return payout(row);
  if (table === 'kyc_verifications') return kyc(row);
  if (['advertisements', 'ad_campaigns'].includes(table)) return ad(row, table);
  if (table === 'disputes') return dispute(row);
  if (table === 'service_gigs') return serviceListing(row);
  if (table === 'service_bookings') return serviceBooking(row);
  if (table === 'safe_hubs') return hub(row);
  if (table === 'push_subscriptions') return pushSubscription(row);
  if (table === 'broadcasts') return broadcast(row);
  if (['sourcing_requests', 'dropship_requests'].includes(table)) return sourcing(row, table);
  return generic(table, row);
}
