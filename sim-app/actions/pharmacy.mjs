import { randomUUID } from 'node:crypto';

const pathways = ['Sinusitis', 'Sore throat', 'Acute otitis media', 'Infected insect bites', 'Impetigo', 'Shingles', 'Uncomplicated UTI', 'Minor illness', 'Urgent medicine supply'];
const actions = new Set(['place_pharmacy_order', 'update_pharmacy_basket', 'remove_pharmacy_basket_line', 'checkout_pharmacy_basket', 'cancel_pharmacy_order', 'receive_pharmacy_order', 'receive_pharmacy_referral', 'update_pharmacy_referral', 'receive_stock', 'update_stock_price', 'link_prescription_stock']);
const prescriptionActions = new Set(['review', 'accept', 'reject', 'dispense', 'collect']);

function integer(ctx, value, name, min = 1, max = 100000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) ctx.fail(400, `${name} must be an integer from ${min} to ${max}`);
  return value;
}

function requiredText(ctx, value, name, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) ctx.fail(400, `${name} is required (maximum ${max} characters)`);
  return value.trim();
}

function kind(ctx, resource, expected) {
  if (resource.kind !== expected) ctx.fail(400, `Expected ${expected}`);
  return resource;
}

function state(ctx, resource, allowed) {
  if (!allowed.includes(resource.status)) ctx.fail(409, `Cannot ${ctx.action.type} a ${resource.status} ${resource.kind}`);
}

function create(ctx, fields) {
  return ctx.create({ owner: 'pharmacy', visibleTo: ['pharmacy'], priority: 'routine', ...fields });
}

function movement(ctx, product, data) {
  return create(ctx, { kind: 'pharmacy-movement', title: `${data.movementType}: ${product.data.drug}`, status: 'available', data: { productId: product.id, balance: product.data.stock, ...data } });
}

async function offer(ctx, quoteId, quoteVersion, packs, requiredUnits) {
  const quote = kind(ctx, await ctx.get(requiredText(ctx, quoteId, 'quoteId')), 'pharmacy-quote');
  ctx.requireVersion(quote, quoteVersion);
  if (!quote.data.available) ctx.fail(409, 'Supplier offer is unavailable; compare suppliers again');
  integer(ctx, packs, 'quantity');
  integer(ctx, requiredUnits, 'requiredUnits');
  if (packs < quote.data.minimumPacks || packs * quote.data.packSize < requiredUnits) ctx.fail(400, 'Packs must meet the supplier minimum and requested units');
  const product = kind(ctx, await ctx.get(quote.data.productId), 'pharmacy-product');
  return { quote, product, packs, requiredUnits };
}

async function placeOrder(ctx, selection, deliveryFeePence, batchId) {
  const { quote, product, packs, requiredUnits } = selection;
  const dueAt = ctx.now + quote.data.leadDays * 86400000;
  return create(ctx, {
    kind: 'pharmacy-order', title: `${quote.data.supplier} · ${product.data.drug}`, status: 'ordered', dueAt,
    data: { ...quote.data, quoteId: quote.id, quoteVersion: quote.version, requiredUnits, deliveryFeePence, packs,
      totalPence: packs * quote.data.packCostPence + deliveryFeePence, orderedAt: ctx.now, dueAt,
      receivedPacks: 0, cancelledPacks: 0, receivedCostPence: 0, ...(batchId ? { batchId } : {}) },
  });
}

// The caller owns the database transaction and clientRequestId deduplication.
export async function handlePharmacy(ctx) {
  const a = ctx.action;
  if (!actions.has(a.type) && !prescriptionActions.has(a.type)) return undefined;
  let resource;
  if (prescriptionActions.has(a.type)) {
    if (!a.resourceId) return undefined;
    resource = await ctx.get(a.resourceId);
    if (resource.kind !== 'prescription') return undefined;
  }
  const referralCreation = a.type === 'receive_pharmacy_referral';
  if (!(referralCreation ? ['gp', 'hospital', 'pharmacy', 'referrals'] : ['pharmacy']).includes(ctx.site)) ctx.fail(403, 'This action is not available at this site');

  if (referralCreation) {
    const patientId = requiredText(ctx, a.patientId, 'patientId');
    if (!pathways.includes(a.pharmacyPathway)) ctx.fail(400, 'Choose a supported pharmacy pathway');
    const source = a.referralSource ?? ctx.site;
    if (!['gp', 'hospital', 'patient', 'referrals'].includes(source)) ctx.fail(400, 'Choose a referral source');
    return create(ctx, { kind: 'pharmacy-referral', title: requiredText(ctx, a.title, 'title'), patientId, status: 'received',
      visibleTo: [...new Set(['pharmacy', 'gp', 'patient', source])],
      data: { pathway: a.pharmacyPathway, source, stage: 'received', receivedAt: ctx.now } });
  }

  if (a.type === 'place_pharmacy_order') {
    const quoteId = a.quoteId ?? a.resourceId;
    const quote = kind(ctx, await ctx.get(requiredText(ctx, quoteId, 'quoteId')), 'pharmacy-quote');
    const selection = await offer(ctx, quoteId, a.quoteVersion ?? a.expectedVersion, a.quantity, a.requiredUnits ?? a.quantity * quote.data.packSize);
    return placeOrder(ctx, selection, selection.quote.data.deliveryFeePence ?? 0);
  }

  resource ??= await ctx.get(requiredText(ctx, a.resourceId, 'resourceId'));
  ctx.requireVersion(resource, a.expectedVersion);

  if (['update_pharmacy_basket', 'remove_pharmacy_basket_line', 'checkout_pharmacy_basket'].includes(a.type)) {
    kind(ctx, resource, 'pharmacy-basket');
    const lines = resource.data.lines ?? [];
    if (a.type === 'remove_pharmacy_basket_line') {
      requiredText(ctx, a.productId, 'productId');
      return ctx.update(resource, { data: { ...resource.data, lines: lines.filter(line => line.productId !== a.productId) } });
    }
    if (a.type === 'update_pharmacy_basket') {
      const { quote, packs, requiredUnits } = await offer(ctx, a.quoteId, a.quoteVersion, a.quantity, a.requiredUnits);
      const next = lines.filter(line => line.productId !== quote.data.productId);
      if (next.length >= 100) ctx.fail(400, 'The basket can contain at most 100 medicines');
      next.push({ quoteId: quote.id, quoteVersion: quote.version, productId: quote.data.productId, packs, requiredUnits, quote: { ...quote.data } });
      return ctx.update(resource, { data: { ...resource.data, lines: next } });
    }
    if (!lines.length) ctx.fail(409, 'The basket is empty');
    const selections = [];
    for (const line of lines) selections.push(await offer(ctx, line.quoteId, line.quoteVersion, line.packs, line.requiredUnits));
    const fees = new Map();
    for (const { quote } of selections) fees.set(quote.data.supplier, Math.max(fees.get(quote.data.supplier) ?? 0, quote.data.deliveryFeePence ?? 0));
    const batchId = randomUUID();
    const orderIds = [];
    for (const selection of selections) {
      const supplier = selection.quote.data.supplier;
      const order = await placeOrder(ctx, selection, fees.get(supplier), batchId);
      orderIds.push(order.id);
      fees.set(supplier, 0);
    }
    return ctx.update(resource, { data: { ...resource.data, lines: [], orderIds } });
  }

  if (['receive_pharmacy_order', 'cancel_pharmacy_order'].includes(a.type)) {
    kind(ctx, resource, 'pharmacy-order');
    state(ctx, resource, ['ordered', 'part-received']);
    const d = resource.data;
    const outstanding = d.packs - (d.receivedPacks ?? 0) - (d.cancelledPacks ?? 0);
    if (outstanding <= 0) ctx.fail(409, 'This order has no outstanding packs');
    const reference = requiredText(ctx, a.text, a.type === 'cancel_pharmacy_order' ? 'Cancellation reason' : 'Delivery reference');
    if (a.type === 'cancel_pharmacy_order') return ctx.update(resource, { status: 'cancelled', data: { ...d, cancelledPacks: (d.cancelledPacks ?? 0) + outstanding, cancellationReason: reference, cancelledAt: ctx.now } });
    if (ctx.now < d.dueAt) ctx.fail(409, 'Delivery is not due yet; advance the simulation clock');
    const packs = integer(ctx, a.quantity, 'quantity', 1, outstanding);
    const product = kind(ctx, await ctx.get(d.productId), 'pharmacy-product');
    const units = packs * d.packSize;
    const acquisitionPence = packs * d.packCostPence + ((d.receivedPacks ?? 0) === 0 ? d.deliveryFeePence ?? 0 : 0);
    const saved = await ctx.update(product, { data: { ...product.data, stock: product.data.stock + units, stockCostPence: product.data.stockCostPence + acquisitionPence } });
    await movement(ctx, saved, { movementType: 'receipt', quantity: units, acquisitionPence, valuePence: acquisitionPence, orderId: resource.id, reference });
    return ctx.update(resource, { status: packs === outstanding ? 'received' : 'part-received', data: { ...d, receivedPacks: (d.receivedPacks ?? 0) + packs, receivedCostPence: (d.receivedCostPence ?? 0) + acquisitionPence, receivedAt: ctx.now } });
  }

  if (['receive_stock', 'update_stock_price'].includes(a.type)) {
    kind(ctx, resource, 'pharmacy-product');
    const d = resource.data;
    if (a.type === 'update_stock_price') {
      const costPence = integer(ctx, a.costPence ?? d.costPence, 'costPence', 0, 10000000);
      const pricePence = integer(ctx, a.pricePence, 'pricePence', 0, 10000000);
      const reorderLevel = integer(ctx, a.reorderLevel ?? d.reorderLevel, 'reorderLevel', 0);
      const saved = await ctx.update(resource, { data: { ...d, costPence, pricePence, reorderLevel } });
      await movement(ctx, saved, { movementType: 'price update', quantity: 0, valuePence: 0, reference: 'Dispensing price and reorder settings', costPence, pricePence });
      return saved;
    }
    const quantity = integer(ctx, a.quantity, 'quantity');
    const costPence = integer(ctx, a.costPence ?? d.costPence, 'costPence', 0, 10000000);
    const acquisitionPence = Math.round(quantity * costPence / d.packSize);
    const saved = await ctx.update(resource, { data: { ...d, stock: d.stock + quantity, stockCostPence: d.stockCostPence + acquisitionPence } });
    await movement(ctx, saved, { movementType: 'receipt', quantity, valuePence: acquisitionPence, acquisitionPence, reference: a.text ?? 'Manual stock receipt' });
    return saved;
  }

  if (a.type === 'update_pharmacy_referral') {
    kind(ctx, resource, 'pharmacy-referral');
    const transition = { accept: ['received', 'accepted'], consult: ['accepted', 'consulting'], complete: ['consulting', 'completed'] }[a.pharmacyCommand];
    if (!transition) ctx.fail(400, 'Unknown pharmacy referral command');
    state(ctx, resource, [transition[0]]);
    const data = { ...resource.data, stage: transition[1] };
    if (a.pharmacyCommand === 'complete') Object.assign(data, { outcome: requiredText(ctx, a.text, 'Consultation outcome', 20000), completedAt: ctx.now });
    return ctx.update(resource, { status: transition[1], data });
  }

  kind(ctx, resource, 'prescription');
  if (a.type === 'link_prescription_stock') {
    state(ctx, resource, ['open', 'available', 'draft', 'reviewed', 'rejected', 'approved']);
    const product = kind(ctx, await ctx.get(requiredText(ctx, a.productId, 'productId')), 'pharmacy-product');
    const quantity = integer(ctx, a.quantity, 'quantity');
    return ctx.update(resource, { data: { ...resource.data, productId: product.id, supplyDrug: product.data.drug, quantity } });
  }
  const transitions = { review: [['open', 'available', 'draft'], 'reviewed'], accept: [['reviewed', 'rejected'], 'approved'], reject: [['open', 'available', 'draft', 'reviewed', 'approved'], 'rejected'], dispense: [['approved'], 'dispensed'], collect: [['dispensed'], 'collected'] };
  const [allowed, status] = transitions[a.type];
  state(ctx, resource, allowed);
  const data = { ...resource.data, [`${status}At`]: ctx.now };
  if (a.text) data.note = a.text;
  if (a.type === 'dispense') {
    const product = kind(ctx, await ctx.get(requiredText(ctx, resource.data.productId, 'Linked productId')), 'pharmacy-product');
    const quantity = integer(ctx, resource.data.quantity, 'Supply quantity');
    if (product.data.stock < quantity) ctx.fail(409, 'Insufficient stock to dispense this prescription');
    const costPence = Math.round(product.data.stockCostPence * quantity / product.data.stock);
    const revenuePence = Math.round(product.data.pricePence * quantity / product.data.packSize);
    const saved = await ctx.update(product, { data: { ...product.data, stock: product.data.stock - quantity, stockCostPence: product.data.stockCostPence - costPence } });
    await movement(ctx, saved, { movementType: 'dispensing', quantity: -quantity, valuePence: -costPence, costPence, revenuePence, prescriptionId: resource.id, reference: resource.title });
    Object.assign(data, { costPence, revenuePence });
  }
  return ctx.update(resource, { status, data });
}
