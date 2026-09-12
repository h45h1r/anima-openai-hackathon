import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePharmacy } from './pharmacy.mjs';

function fixture() {
  const resources = new Map();
  let next = 0;
  function seed(id, kind, data, status = 'available') {
    const resource = { id, kind, data, status, title: id, version: 1, owner: 'pharmacy', visibleTo: ['pharmacy'] };
    resources.set(id, resource);
    return resource;
  }
  seed('product', 'pharmacy-product', { drug: 'Example tablets', formulation: 'Tablets', packSize: 10, stock: 20, stockCostPence: 200, costPence: 100, pricePence: 150, reorderLevel: 10 });
  seed('quote', 'pharmacy-quote', { productId: 'product', supplier: 'Supplier', packSize: 10, packCostPence: 80, minimumPacks: 2, leadDays: 2, deliveryFeePence: 50, available: true });
  seed('basket', 'pharmacy-basket', { lines: [] });
  const ctx = {
    site: 'pharmacy', now: 1000000000, actor: 'Tester',
    fail(status, message) { throw Object.assign(new Error(message), { status }); },
    async get(id) { return resources.get(id) ?? ctx.fail(404, 'Not found'); },
    requireVersion(resource, expected) { if (expected !== resource.version) ctx.fail(409, 'Version conflict'); },
    async update(resource, patch) {
      assert.equal(resource.version, resources.get(resource.id).version);
      const saved = { ...resource, ...patch, version: resource.version + 1 };
      resources.set(resource.id, saved);
      return saved;
    },
    async create(fields) { const result = { id: `created-${++next}`, version: 1, createdAt: ctx.now, ...fields }; resources.set(result.id, result); return result; },
  };
  const act = action => handlePharmacy({ ...ctx, action });
  const records = kind => [...resources.values()].filter(resource => resource.kind === kind);
  return { resources, seed, ctx, act, records };
}

test('checkout validates all frozen offers before creating orders', async () => {
  const f = fixture();
  await f.act({ type: 'update_pharmacy_basket', resourceId: 'basket', expectedVersion: 1, quoteId: 'quote', quoteVersion: 1, quantity: 2, requiredUnits: 12 });
  const quote = f.resources.get('quote');
  f.resources.set('quote', { ...quote, version: 2 });
  await assert.rejects(f.act({ type: 'checkout_pharmacy_basket', resourceId: 'basket', expectedVersion: 2 }), { status: 409 });
  assert.equal(f.records('pharmacy-order').length, 0);
  assert.equal(f.resources.get('basket').data.lines.length, 1);
  assert.equal(f.resources.get('product').data.stock, 20);
});

test('basket replaces a medicine selection and charges supplier delivery once', async () => {
  const f = fixture();
  f.seed('product2', 'pharmacy-product', { ...f.resources.get('product').data });
  f.seed('quote2', 'pharmacy-quote', { ...f.resources.get('quote').data, productId: 'product2', deliveryFeePence: 100 });
  for (const [version, quoteId, quantity] of [[1, 'quote', 2], [2, 'quote', 3], [3, 'quote2', 2]]) {
    await f.act({ type: 'update_pharmacy_basket', resourceId: 'basket', expectedVersion: version, quoteId, quoteVersion: 1, quantity, requiredUnits: 12 });
  }
  assert.equal(f.resources.get('basket').data.lines.length, 2);
  const basket = await f.act({ type: 'checkout_pharmacy_basket', resourceId: 'basket', expectedVersion: 4 });
  const orders = f.records('pharmacy-order');
  assert.equal(orders.length, 2);
  assert.equal(orders.reduce((sum, order) => sum + order.data.deliveryFeePence, 0), 100);
  assert.equal(orders.reduce((sum, order) => sum + order.data.totalPence, 0), 500);
  assert.equal(orders[0].data.batchId, orders[1].data.batchId);
  assert.deepEqual(basket.data.lines, []);
  assert.equal(basket.data.orderIds.length, 2);
  assert.equal(f.resources.get('product').data.stock, 20);
});

test('receipt rejects early arrival, handles partial packs and preserves received stock on cancellation', async () => {
  const f = fixture();
  const order = await f.act({ type: 'place_pharmacy_order', quoteId: 'quote', quoteVersion: 1, quantity: 3 });
  const receive = { type: 'receive_pharmacy_order', resourceId: order.id, expectedVersion: 1, quantity: 1, text: 'DEL-123' };
  await assert.rejects(f.act(receive), { status: 409 });
  assert.equal(f.resources.get('product').data.stock, 20);
  f.ctx.now = order.data.dueAt;
  const partial = await f.act(receive);
  assert.equal(partial.status, 'part-received');
  assert.equal(partial.data.receivedCostPence, 130);
  assert.equal(f.resources.get('product').data.stock, 30);
  const second = await f.act({ ...receive, expectedVersion: 2 });
  assert.equal(second.data.receivedCostPence, 210);
  assert.equal(f.resources.get('product').data.stockCostPence, 410);
  const cancelled = await f.act({ type: 'cancel_pharmacy_order', resourceId: order.id, expectedVersion: 3, text: 'No longer needed' });
  assert.equal(cancelled.data.cancelledPacks, 1);
  assert.equal(f.resources.get('product').data.stock, 40);
  await assert.rejects(f.act({ ...receive, expectedVersion: 4 }), { status: 409 });
});

test('dispense requires approved linked supply, deducts inventory once and collects without a second deduction', async () => {
  const f = fixture();
  f.seed('rx', 'prescription', {}, 'draft');
  await assert.rejects(f.act({ type: 'dispense', resourceId: 'rx', expectedVersion: 1 }), { status: 409 });
  await f.act({ type: 'link_prescription_stock', resourceId: 'rx', expectedVersion: 1, productId: 'product', quantity: 5 });
  await f.act({ type: 'review', resourceId: 'rx', expectedVersion: 2 });
  await f.act({ type: 'accept', resourceId: 'rx', expectedVersion: 3 });
  const rx = await f.act({ type: 'dispense', resourceId: 'rx', expectedVersion: 4 });
  assert.equal(rx.status, 'dispensed');
  assert.equal(f.resources.get('product').data.stock, 15);
  assert.equal(f.resources.get('product').data.stockCostPence, 150);
  const [movement] = f.records('pharmacy-movement');
  assert.equal(movement.data.quantity, -5);
  assert.equal(movement.data.revenuePence, 75);
  await assert.rejects(f.act({ type: 'dispense', resourceId: 'rx', expectedVersion: 4 }), { status: 409 });
  await assert.rejects(f.act({ type: 'dispense', resourceId: 'rx', expectedVersion: 5 }), { status: 409 });
  await f.act({ type: 'collect', resourceId: 'rx', expectedVersion: 5 });
  assert.equal(f.resources.get('product').data.stock, 15);
  assert.equal(f.records('pharmacy-movement').length, 1);
});

test('insufficient supply and invalid quantities leave inventory untouched', async () => {
  const f = fixture();
  f.seed('rx', 'prescription', { productId: 'product', quantity: 21 }, 'approved');
  await assert.rejects(f.act({ type: 'dispense', resourceId: 'rx', expectedVersion: 1 }), { status: 409 });
  await assert.rejects(f.act({ type: 'receive_stock', resourceId: 'product', expectedVersion: 1, quantity: -1 }), { status: 400 });
  assert.equal(f.resources.get('product').version, 1);
  assert.equal(f.records('pharmacy-movement').length, 0);
});

test('referrals enforce accepted then consulting then completed with outcome', async () => {
  const f = fixture();
  f.ctx.site = 'gp';
  const referral = await f.act({ type: 'receive_pharmacy_referral', patientId: 'SIM-1', title: 'Sore throat review', pharmacyPathway: 'Sore throat', referralSource: 'gp' });
  assert.equal(referral.data.stage, 'received');
  f.ctx.site = 'pharmacy';
  await assert.rejects(f.act({ type: 'update_pharmacy_referral', resourceId: referral.id, expectedVersion: 1, pharmacyCommand: 'complete', text: 'Reviewed' }), { status: 409 });
  await f.act({ type: 'update_pharmacy_referral', resourceId: referral.id, expectedVersion: 1, pharmacyCommand: 'accept' });
  await f.act({ type: 'update_pharmacy_referral', resourceId: referral.id, expectedVersion: 2, pharmacyCommand: 'consult' });
  await assert.rejects(f.act({ type: 'update_pharmacy_referral', resourceId: referral.id, expectedVersion: 3, pharmacyCommand: 'complete' }), { status: 400 });
  const completed = await f.act({ type: 'update_pharmacy_referral', resourceId: referral.id, expectedVersion: 3, pharmacyCommand: 'complete', text: 'Consultation recorded' });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.data.outcome, 'Consultation recorded');
});

test('unrelated actions delegate and stock changes require pharmacy site', async () => {
  const f = fixture();
  f.seed('task', 'task', {}, 'open');
  assert.equal(await f.act({ type: 'review', resourceId: 'task' }), undefined);
  assert.equal(await f.act({ type: 'book_appointment' }), undefined);
  f.ctx.site = 'gp';
  await assert.rejects(f.act({ type: 'receive_stock', resourceId: 'product', expectedVersion: 1, quantity: 5 }), { status: 403 });
});
