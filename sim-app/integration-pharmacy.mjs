// Explicit local HTTP check: creates synthetic orders and one dispensing record.
// Run: node sim-app/integration-pharmacy.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';

const base = 'http://localhost:4192';
const runId = randomUUID();
async function request(path, action, expectedStatus = 200) {
  const response = await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${path}`, {
      method: action ? 'POST' : 'GET', signal: AbortSignal.timeout(20000),
      headers: { Authorization: 'Bearer local-demo', ...(action ? { 'Content-Type': 'application/json' } : {}) },
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(body) }); } catch (error) { reject(error); } });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(action ? JSON.stringify(action) : undefined);
  });
  assert.equal(response.status, expectedStatus, `${path}: ${JSON.stringify(response.body)}`);
  return response.body;
}
const act = (type, resource, extra = {}, status = 200) => request('/api/sites/pharmacy/actions', {
  type, ...(resource ? { resourceId: resource.id, expectedVersion: resource.version } : {}), ...extra,
}, status);
const workspace = () => request('/api/sites/pharmacy/pharmacy-workspace');
const health = await request('/healthz');
assert.equal(health.mode, 'local-copy');
const initial = await workspace();
let basket = initial.resources.find(r => r.kind === 'pharmacy-basket');
assert.ok(basket);
assert.deepEqual(basket.data.lines, [], 'Use an empty team basket for this integration check.');
const quote = initial.resources.find(r => r.kind === 'pharmacy-quote' && r.data.available && initial.resources.some(p => p.id === r.data.productId && p.data.stock > 0));
assert.ok(quote, 'Need an available supplier offer for an in-stock medicine.');
const product = initial.resources.find(r => r.id === quote.data.productId);
basket = await act('update_pharmacy_basket', basket, { quoteId: quote.id, quoteVersion: quote.version, quantity: quote.data.minimumPacks, requiredUnits: 1 });
assert.equal(basket.data.lines[0].quoteId, quote.id);
const checkout = { type: 'checkout_pharmacy_basket', resourceId: basket.id, expectedVersion: basket.version, clientRequestId: randomUUID() };
const checked = await request('/api/sites/pharmacy/actions', checkout);
assert.equal(checked.data.lines.length, 0);
assert.equal(checked.data.orderIds.length, 1);
assert.deepEqual(await request('/api/sites/pharmacy/actions', checkout), checked, 'Checkout replay must return the same orders.');
const orderedWorkspace = await workspace();
const order = orderedWorkspace.resources.find(r => r.id === checked.data.orderIds[0]);
assert.equal(order.data.packs, quote.data.minimumPacks);
assert.equal(orderedWorkspace.resources.find(r => r.id === product.id).data.stock, product.data.stock, 'Checkout must not add inventory.');
if (order.data.dueAt > orderedWorkspace.now) await act('receive_pharmacy_order', order, { quantity: 1, text: `Premature integration receipt ${runId}` }, 409);
const cancelled = await act('cancel_pharmacy_order', order, { text: `Cancelled test order ${runId}` });
assert.equal(cancelled.status, 'cancelled');
assert.equal(cancelled.data.cancelledPacks, order.data.packs);
console.log('PASS supplier offer → basket → checkout, persisted order, idempotent replay, unchanged inventory, cancellation');

let rx = await act('draft_prescription', undefined, { patientId: 'SIM-000006', title: `Local pharmacy integration ${runId}`, text: 'Synthetic workflow check only.' });
rx = await act('link_prescription_stock', rx, { productId: product.id, quantity: 1 });
rx = await act('review', rx);
rx = await act('accept', rx);
const dispense = { type: 'dispense', resourceId: rx.id, expectedVersion: rx.version, clientRequestId: randomUUID() };
const dispensed = await request('/api/sites/pharmacy/actions', dispense);
assert.equal(dispensed.status, 'dispensed');
assert.deepEqual(await request('/api/sites/pharmacy/actions', dispense), dispensed);
await act('dispense', dispensed, {}, 409);
rx = await act('collect', dispensed);
assert.equal(rx.status, 'collected');
const final = await workspace();
const stock = final.resources.find(r => r.id === product.id);
assert.equal(stock.data.stock, product.data.stock - 1);
const movements = final.resources.filter(r => r.kind === 'pharmacy-movement' && r.data.prescriptionId === rx.id);
assert.equal(movements.length, 1);
assert.equal(movements[0].data.quantity, -1);
assert.equal(stock.data.stockCostPence, product.data.stockCostPence - movements[0].data.costPence);
console.log('PASS prescription → supply → review → approve → dispense → collect; one stock deduction and one ledger movement despite retries');
console.log(JSON.stringify({ runId, orderId: order.id, prescriptionId: rx.id, productId: product.id, stockBefore: product.data.stock, stockAfter: stock.data.stock }));
