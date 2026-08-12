import test from 'node:test';
import assert from 'node:assert/strict';
import { internalSourcingRequest, publicSourcingRequest } from '../src/services/sourcing.js';

const request = {
  id: 'request', requestNumber: 'SRC-1', status: 'UNDER_REVIEW', currency: 'NGN', deliveryLocation: 'Lagos',
  items: [{ id: 'item', title: 'Machine', quantity: 1, specifications: {}, referenceUrl: 'https://example.com/item', imageAsset: null }],
  quotes: [], history: [], requester: { id: 'buyer', email: 'buyer@example.com' }, assignedAdminId: 'admin',
  procurement: { id: 'procurement', sourcePlatform: 'EXTERNAL_MARKETPLACE', sourceUrl: 'https://private.example/item', sourceUnitCostMinor: 100n, procurementNotes: 'Internal only' },
};

test('public sourcing serializer omits procurement and assignment fields', () => {
  const dto = publicSourcingRequest(request);
  assert.equal('procurement' in dto, false);
  assert.equal('assignedAdminId' in dto, false);
  assert.equal(JSON.stringify(dto).includes('private.example'), false);
});

test('internal sourcing serializer includes procurement controls', () => {
  const dto = internalSourcingRequest(request);
  assert.equal(dto.procurement.sourcePlatform, 'EXTERNAL_MARKETPLACE');
  assert.equal(dto.procurement.sourceUnitCostMinor, 100n);
});
