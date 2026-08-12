import { forbidden } from '../lib/errors.js';

export const PLATFORM_ROLE_PERMISSIONS = Object.freeze({
  SUPPORT_ADMIN: ['users.read', 'orders.read', 'messages.read', 'disputes.read', 'disputes.manage'],
  CONTENT_ADMIN: ['products.read', 'products.moderate', 'categories.manage', 'content.manage', 'advertising.manage'],
  OPERATIONS_ADMIN: ['users.read', 'stores.read', 'stores.manage', 'orders.read', 'orders.manage', 'kyc.read', 'kyc.manage', 'sourcing.internal.read', 'sourcing.internal.write', 'sourcing.procurement.manage'],
  SOURCING_MANAGER: ['sourcing.internal.read', 'sourcing.internal.write', 'sourcing.procurement.manage'],
  FINANCE_ADMIN: ['payments.read', 'finance.read', 'payouts.manage', 'settings.finance'],
  SUPER_ADMIN: ['*'],
});

export const STORE_ROLE_PERMISSIONS = Object.freeze({
  OWNER: ['*'],
  ADMIN: ['STORE_READ', 'STORE_UPDATE', 'PRODUCT_READ', 'PRODUCT_WRITE', 'INVENTORY_WRITE', 'ORDER_READ', 'ORDER_FULFIL', 'CUSTOMER_READ', 'MESSAGE_WRITE', 'FINANCE_READ', 'PAYOUT_REQUEST', 'STAFF_MANAGE', 'AD_MANAGE'],
  MANAGER: ['STORE_READ', 'STORE_UPDATE', 'PRODUCT_READ', 'PRODUCT_WRITE', 'INVENTORY_WRITE', 'ORDER_READ', 'ORDER_FULFIL', 'CUSTOMER_READ', 'MESSAGE_WRITE'],
  PRODUCT_MANAGER: ['STORE_READ', 'PRODUCT_READ', 'PRODUCT_WRITE', 'INVENTORY_WRITE'],
  ORDER_MANAGER: ['STORE_READ', 'ORDER_READ', 'ORDER_FULFIL', 'CUSTOMER_READ', 'MESSAGE_WRITE'],
  FINANCE_MANAGER: ['STORE_READ', 'ORDER_READ', 'FINANCE_READ', 'PAYOUT_REQUEST'],
  SUPPORT_AGENT: ['STORE_READ', 'ORDER_READ', 'CUSTOMER_READ', 'MESSAGE_WRITE'],
});

export function platformPermissions(roles = []) {
  return new Set(roles.flatMap((role) => PLATFORM_ROLE_PERMISSIONS[typeof role === 'string' ? role : role?.role] || []));
}

export function hasPlatformPermission(user, permission) {
  const permissions = platformPermissions(user?.platformRoles || []);
  return permissions.has('*') || permissions.has(permission);
}

export function requirePlatformPermission(permission) {
  return (req, _res, next) => {
    if (!hasPlatformPermission(req.user, permission)) return next(forbidden());
    return next();
  };
}

export function membershipPermissions(membership) {
  const explicit = membership?.permissions?.map((item) => item.permission) || [];
  return new Set([...(STORE_ROLE_PERMISSIONS[membership?.role] || []), ...explicit]);
}

export function hasStorePermission(membership, permission) {
  const permissions = membershipPermissions(membership);
  return permissions.has('*') || permissions.has(permission);
}

export function assertTeamMutation(actorMembership, targetMembership, role, explicitPermissions = []) {
  if (targetMembership?.role === 'OWNER') throw forbidden('The store owner membership cannot be changed through team management.');
  const sensitive = role === 'ADMIN' || explicitPermissions.includes('STAFF_MANAGE');
  if (sensitive && actorMembership?.role !== 'OWNER') throw forbidden('Only the store owner can grant administrative team access.');
  if (targetMembership?.id && targetMembership.id === actorMembership?.id) throw forbidden('You cannot change or remove your own team membership.');
}

export function requireStorePermission(permission, source = 'params', key = 'storeId') {
  return async (req, _res, next) => {
    const storeId = req[source]?.[key] || req.body?.storeId || req.query?.storeId;
    if (!storeId) return next(forbidden('A store context is required.'));
    const membership = await req.db.storeMembership.findFirst({
      where: { storeId, userId: req.user.id, status: 'ACTIVE' },
      include: { permissions: true },
    });
    if (!membership || !hasStorePermission(membership, permission)) return next(forbidden());
    req.storeMembership = membership;
    return next();
  };
}
