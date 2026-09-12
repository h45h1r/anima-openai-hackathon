const MINUTE = 60_000;
const SITES = ['gp', 'hospital', 'community', 'pharmacy', 'diagnostics', 'referrals', 'wearables', 'legacy'];
const ACTIONS = new Set(['create_task', 'create_referral', 'order_test', 'draft_prescription', 'schedule_visit', 'connect_device', 'save_consultation', 'save_problem', 'save_allergy', 'hospital_note', 'register_attendance', 'update_attendance', 'review', 'accept', 'reject', 'complete', 'share_record', 'dispatch_robot', 'report_absence', 'restore_staff', 'allocate_shift']);
const GENERIC_KINDS = new Set(['task', 'referral', 'test', 'report', 'visit', 'care-plan', 'care-package', 'request', 'handover', 'surgery', 'screening', 'choice', 'disposition', 'mental-health-plan', 'maternity-episode', 'dental-recall', 'genomic-test', 'theatre-slot']);
const author = ctx => typeof ctx.actor === 'string' ? ctx.actor : ctx.actor?.name || 'Local simulation operator';
function string(ctx, value, field, max = 500, optional = false) {
  if (value === undefined && optional) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max) ctx.fail(400, `${field} must be ${optional ? 'at most' : '1–'}${max} characters`);
  return value.trim();
}
function choice(ctx, value, values, field) {
  if (!values.includes(value)) ctx.fail(400, `${field} must be one of ${values.join(', ')}`);
  return value;
}
function scope(ctx, allowed) {
  if (ctx.site !== 'control' && !allowed.includes(ctx.site)) ctx.fail(403, `This action requires ${allowed.join(' or ')} access`);
}
async function existing(ctx, kind) {
  const r = await ctx.get(string(ctx, ctx.action.resourceId, 'resourceId'));
  if (kind && r.kind !== kind) ctx.fail(400, `Resource must be ${kind}`);
  ctx.requireVersion(r, ctx.action.expectedVersion);
  if (ctx.action.patientId && ctx.action.patientId !== r.patientId) ctx.fail(409, 'Resource belongs to another patient');
  return r;
}
async function reserve(ctx, service) {
  const r = await ctx.get(`capacity-${service}`);
  if (r.kind !== 'capacity' || !(Number(r.data.remaining) > 0)) ctx.fail(409, `No ${service} capacity remains`);
  await ctx.update(r, { data: { ...r.data, remaining: Number(r.data.remaining) - 1 } });
}
async function release(ctx, r, service) {
  if (!r.data.capacityReserved) return;
  const capacity = await ctx.get(`capacity-${service}`);
  await ctx.update(capacity, { data: { ...capacity.data, remaining: Math.min(Number(capacity.data.total), Number(capacity.data.remaining) + 1) } });
}
async function create(ctx, kind, owner, status, data = {}, extra = {}) {
  const a = ctx.action;
  const patientId = string(ctx, a.patientId, 'patientId');
  await ctx.getPatient(patientId);
  return ctx.create({ kind, owner, status, title: string(ctx, a.title, 'title'), patientId, visibleTo: [...new Set([owner, ctx.site === 'control' ? owner : ctx.site])], priority: 'routine', data, ...extra });
}
async function saveGp(ctx) {
  scope(ctx, ['gp']);
  const a = ctx.action;
  const kind = a.type.slice(5);
  const patientId = string(ctx, a.patientId, 'patientId');
  const patient = await ctx.getPatient(patientId);
  const r = a.resourceId ? await existing(ctx, kind) : undefined;
  if (r && r.owner !== 'gp') ctx.fail(403, 'Only GP records can be edited here');
  const data = { ...r?.data };
  let status;
  if (kind === 'consultation') {
    status = choice(ctx, a.consultationStatus, ['draft', 'saved'], 'consultationStatus');
    Object.assign(data, { text: string(ctx, a.text, 'text', 20000), mode: choice(ctx, a.mode ?? 'in-person', ['in-person', 'telephone', 'video', 'online'], 'mode'), author: author(ctx) });
  } else {
    const problem = kind === 'problem';
    const key = problem ? 'sourceProblemKey' : 'sourceAllergyKey';
    status = choice(ctx, problem ? a.problemStatus : a.allergyStatus, problem ? ['active', 'resolved'] : ['active', 'inactive'], problem ? 'problemStatus' : 'allergyStatus');
    if (a[key]) {
      if (r) ctx.fail(400, 'Choose either an existing record or a historical source');
      const source = string(ctx, a[key], key, 600);
      const duplicates = await ctx.list({ kind, patientId, site: 'gp' });
      if (duplicates.some(item => item.data[key] === source)) ctx.fail(409, 'Historical item already has an editable record; edit that record');
      const records = await ctx.list({ kind: 'ehr-record', patientId, site: 'gp' });
      const found = records.some(record => (record.data[problem ? 'problems' : 'allergies'] || []).some((item, index) => (problem ? `${record.id}:${index}` : item.key ?? `${record.id}:${index}`) === source));
      if (!found && !(problem && (patient.conditions || []).some(term => `summary:${term}` === source))) ctx.fail(400, 'Historical source does not belong to this patient');
      data[key] = source;
    }
    if (problem) {
      data.code = string(ctx, a.problemCode, 'problemCode', 100, true);
      if (a.onsetDate !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(a.onsetDate) || !Number.isFinite(Date.parse(a.onsetDate)) || new Date(a.onsetDate).toISOString().slice(0, 10) !== a.onsetDate) ctx.fail(400, 'onsetDate must be a valid date');
        data.onsetDate = a.onsetDate;
      }
    } else data.reaction = string(ctx, a.reaction, 'reaction', 2000, true);
  }
  const title = string(ctx, a.title, 'title');
  return r ? ctx.update(r, { title, status, data }) : create(ctx, kind, 'gp', status, data);
}
async function hospitalNote(ctx) {
  scope(ctx, ['hospital']);
  const a = ctx.action;
  const command = a.hospitalNoteCommand;
  if (!command || !['save', 'sign', 'addendum'].includes(command.kind)) ctx.fail(400, 'Valid hospitalNoteCommand required');
  const r = a.resourceId ? await existing(ctx, 'hospital-note') : undefined;
  if (r && r.owner !== 'hospital') ctx.fail(403, 'Hospital note is not owned by hospital');
  if (command.kind === 'save') {
    if (r && r.data.stage !== 'draft') ctx.fail(409, 'Signed notes accept addenda only');
    choice(ctx, command.template, ['free-text', 'history-physical', 'progress'], 'template');
    if (!Array.isArray(command.sections) || command.sections.length < 1 || command.sections.length > 12) ctx.fail(400, 'Notes require 1–12 sections');
    const sections = command.sections.map(section => {
      if (!section || typeof section !== 'object') ctx.fail(400, 'Each note section must be an object');
      return { id: string(ctx, section.id, 'section.id', 80), heading: string(ctx, section.heading, 'section.heading', 120), text: string(ctx, section.text, 'section.text', 20000, true) };
    });
    if (new Set(sections.map(s => s.id)).size !== sections.length) ctx.fail(400, 'Section IDs must be unique');
    const data = { ...r?.data, stage: 'draft', template: command.template, sections, text: sections.map(s => `${s.heading}\n${s.text}`).join('\n\n') };
    return r ? ctx.update(r, { title: string(ctx, a.title, 'title'), data }) : create(ctx, 'hospital-note', 'hospital', 'draft', data);
  }
  if (!r) ctx.fail(400, 'Existing note required');
  if (command.kind === 'sign') {
    if (r.data.stage !== 'draft') ctx.fail(409, 'Only a draft can be signed');
    if (!r.data.sections?.some(s => s.text.trim())) ctx.fail(400, 'A blank note cannot be signed');
    return ctx.update(r, { status: 'signed', data: { ...r.data, stage: 'signed', signedAt: ctx.now, signedBy: author(ctx), addenda: [] } });
  }
  if (r.data.stage !== 'signed') ctx.fail(409, 'Only signed notes accept addenda');
  return ctx.update(r, { data: { ...r.data, addenda: [...(r.data.addenda || []), { text: string(ctx, command.text, 'addendum text', 20000), time: ctx.now, author: author(ctx) }] } });
}
async function attendance(ctx) {
  scope(ctx, ['hospital']);
  const a = ctx.action;
  if (a.type === 'register_attendance') {
    await ctx.getPatient(string(ctx, a.patientId, 'patientId'));
    const current = await ctx.list({ kind: 'hospital-attendance', patientId: a.patientId, site: 'hospital' });
    if (current.some(r => r.data.stage !== 'discharged')) ctx.fail(409, 'Patient already has an active attendance');
    const acuity = choice(ctx, a.acuity, ['1', '2', '3', '4', '5'], 'acuity');
    return create(ctx, 'hospital-attendance', 'hospital', 'waiting', { stage: 'waiting', arrivalAt: ctx.now, presentingComplaint: string(ctx, a.title, 'title'), acuity, location: string(ctx, a.location, 'location', 100), clinician: string(ctx, a.clinician ?? 'Unassigned', 'clinician', 100) }, { priority: ['1', '2'].includes(acuity) ? 'urgent' : 'routine' });
  }
  const r = await existing(ctx, 'hospital-attendance');
  if (r.owner !== 'hospital') ctx.fail(403, 'Hospital attendance access required');
  const data = { ...r.data };
  if (data.stage === 'discharged') ctx.fail(409, 'Discharged attendances are closed');
  for (const field of ['location', 'clinician']) if (a[field] !== undefined) data[field] = string(ctx, a[field], field, 100);
  if (a.acuity !== undefined) data.acuity = choice(ctx, a.acuity, ['1', '2', '3', '4', '5'], 'acuity');
  const command = choice(ctx, a.hospitalCommand, ['assign', 'assess', 'refer', 'admit', 'discharge'], 'hospitalCommand');
  if (command === 'assign' && !a.clinician) ctx.fail(400, 'Clinician required for assignment');
  if (command === 'assess') {
    if (data.stage !== 'waiting') ctx.fail(409, 'Only a waiting attendance can start assessment');
    if (!data.clinician || data.clinician === 'Unassigned') ctx.fail(400, 'Assign a clinician before assessment');
    Object.assign(data, { stage: 'assessing', assessmentAt: ctx.now });
  }
  if (command === 'refer') {
    if (data.stage !== 'assessing') ctx.fail(409, 'Only assessed patients can be referred to medical take');
    Object.assign(data, { stage: 'take', referredAt: ctx.now });
  }
  if (command === 'admit') {
    if (data.stage !== 'take') ctx.fail(409, 'Only patients on medical take can be admitted');
    await reserve(ctx, 'beds');
    Object.assign(data, { stage: 'inpatient', admittedAt: ctx.now, capacityReserved: true });
  }
  if (command === 'discharge') {
    const disposition = string(ctx, a.disposition, 'disposition');
    await release(ctx, r, 'beds');
    Object.assign(data, { stage: 'discharged', dischargedAt: ctx.now, assessmentAt: data.assessmentAt ?? null, disposition, capacityReserved: false });
  }
  return ctx.update(r, { status: data.stage, priority: ['1', '2'].includes(data.acuity) ? 'urgent' : 'routine', data });
}

export async function handleClinical(ctx) {
  const a = ctx.action;
  if (!ACTIONS.has(a.type)) return undefined;
  if (['save_consultation', 'save_problem', 'save_allergy'].includes(a.type)) return saveGp(ctx);
  if (a.type === 'hospital_note') return hospitalNote(ctx);
  if (['register_attendance', 'update_attendance'].includes(a.type)) return attendance(ctx);
  if (a.type === 'create_task') {
    scope(ctx, ['gp', 'hospital', 'community', 'diagnostics', 'referrals', 'pharmacy']);
    const owner = a.target ? choice(ctx, a.target, SITES, 'target') : ctx.site === 'control' ? 'gp' : ctx.site;
    return create(ctx, 'task', owner, 'open', { text: string(ctx, a.text, 'text', 20000, true) });
  }
  if (a.type === 'create_referral') {
    scope(ctx, ['gp', 'hospital', 'referrals']);
    const target = choice(ctx, a.target ?? 'hospital', ['hospital', 'community', 'diagnostics', 'referrals'], 'target');
    return create(ctx, 'referral', 'referrals', 'open', { reason: string(ctx, a.text, 'text', 20000, true), target }, { visibleTo: [...new Set(['referrals', ctx.site === 'control' ? 'gp' : ctx.site, target])] });
  }
  if (a.type === 'draft_prescription') {
    scope(ctx, ['gp', 'hospital', 'pharmacy']);
    const data = { drug: string(ctx, a.title, 'title'), note: string(ctx, a.text, 'text', 20000, true) };
    if (a.medicationOrder) {
      const order = {};
      for (const field of ['drug', 'dose', 'unit', 'route', 'frequency', 'duration', 'indication']) order[field] = string(ctx, a.medicationOrder[field], field, field === 'indication' ? 2000 : 500);
      if (!Number.isInteger(a.medicationOrder.quantity) || a.medicationOrder.quantity < 1 || a.medicationOrder.quantity > 100000) ctx.fail(400, 'Medication quantity must be 1–100000');
      order.quantity = a.medicationOrder.quantity;
      Object.assign(data, { medicationOrder: order, drug: order.drug });
    }
    return create(ctx, 'prescription', 'pharmacy', 'draft', data, { visibleTo: [...new Set(['pharmacy', 'patient', ctx.site === 'control' ? 'gp' : ctx.site])] });
  }
  if (a.type === 'order_test') {
    scope(ctx, ['gp', 'hospital', 'diagnostics']);
    const data = { text: string(ctx, a.text, 'text', 20000, true), synthetic: true, simulationSource: 'local' };
    if (a.bloodTestOrder) {
      const input = a.bloodTestOrder;
      const order = {};
      for (const field of ['panel', 'specimen', 'clinicalDetails']) order[field] = string(ctx, input[field], field, field === 'clinicalDetails' ? 2000 : 500);
      order.priority = choice(ctx, input.priority, ['routine', 'urgent'], 'priority');
      order.collection = choice(ctx, input.collection, ['now', 'next-round'], 'collection');
      if (input.panelId !== undefined) order.panelId = choice(ctx, input.panelId, ['fbc', 'ue', 'hba1c', 'lft', 'crp', 'lipids'], 'panelId');
      data.bloodTestOrder = order;
    }
    const at = ctx.now + (data.bloodTestOrder?.collection === 'next-round' ? 240 : 120) * MINUTE;
    const r = await create(ctx, 'test', 'diagnostics', 'ordered', data, { priority: data.bloodTestOrder?.priority ?? 'routine', dueAt: at });
    await ctx.schedule({ type: 'clinical.test-result', at, resourceId: r.id });
    return r;
  }
  if (a.type === 'schedule_visit') {
    scope(ctx, ['gp', 'hospital', 'community']);
    await ctx.getPatient(string(ctx, a.patientId, 'patientId'));
    string(ctx, a.title, 'title');
    await reserve(ctx, 'community');
    const at = ctx.now + 90 * MINUTE;
    const r = await create(ctx, 'visit', 'community', 'scheduled', { text: string(ctx, a.text, 'text', 20000, true), capacityReserved: true }, { dueAt: at, visibleTo: [...new Set(['community', 'patient', ctx.site === 'control' ? 'gp' : ctx.site])] });
    await ctx.schedule({ type: 'clinical.visit-complete', at, resourceId: r.id });
    return r;
  }
  if (a.type === 'connect_device') {
    scope(ctx, ['wearables']);
    if (a.resourceId) ctx.fail(400, 'Connect a device by patient, not resource');
    const patientId = string(ctx, a.patientId, 'patientId');
    await ctx.getPatient(patientId);
    const devices = await ctx.list({ kind: 'device', patientId, site: 'wearables' });
    if (devices.some(r => r.status === 'active' && (r.data.metric === 'steps' || r.title === 'Home activity watch'))) ctx.fail(409, 'Patient already has an active activity watch');
    const r = await ctx.create({ kind: 'device', title: 'Home activity watch', status: 'active', owner: 'wearables', visibleTo: ['wearables', 'patient'], patientId, priority: 'routine', data: { metric: 'steps', battery: 100, quality: 'good', synthetic: true, simulationSource: 'local', connectedAt: ctx.now } });
    await ctx.schedule({ type: 'clinical.device-reading', at: ctx.now + 10 * MINUTE, resourceId: r.id });
    return r;
  }
  const r = await existing(ctx);
  if (['review', 'accept', 'reject', 'complete'].includes(a.type)) {
    if (!GENERIC_KINDS.has(r.kind)) return undefined;
    const manager = r.kind === 'referral' && r.visibleTo.includes('hospital') ? 'hospital' : r.owner;
    const gpResultReview = ctx.site === 'gp' && ['test', 'report'].includes(r.kind) && r.status === 'available' && r.visibleTo.includes('gp') && a.type === 'review';
    if (!gpResultReview) scope(ctx, [manager]);
    const from = { review: ['open', 'draft', 'available'], accept: ['reviewed', 'rejected'], reject: ['open', 'draft', 'reviewed', 'accepted'], complete: ['accepted', 'scheduled', 'waiting'] };
    if (!from[a.type].includes(r.status)) ctx.fail(409, `Cannot ${a.type} a ${r.status} ${r.kind}`);
    const status = { review: 'reviewed', accept: 'accepted', reject: 'rejected', complete: 'completed' }[a.type];
    const data = { ...r.data, [`${status}At`]: ctx.now };
    if (a.text !== undefined) data[a.type === 'reject' ? 'reason' : 'note'] = string(ctx, a.text, 'text', 20000);
    if (r.kind === 'visit' && ['complete', 'reject'].includes(a.type)) { await release(ctx, r, 'community'); data.capacityReserved = false; }
    return ctx.update(r, { status, data });
  }
  if (a.type === 'share_record') {
    scope(ctx, [r.owner]);
    const target = choice(ctx, a.target, SITES, 'target');
    if (r.visibleTo.includes(target)) ctx.fail(409, 'Record is already shared with this service');
    return ctx.update(r, { visibleTo: [...r.visibleTo, target] });
  }
  if (a.type === 'dispatch_robot') {
    scope(ctx, ['robotics', 'pharmacy']);
    if (r.kind !== 'robot' || r.status !== 'available') ctx.fail(409, 'An available robot is required');
    const destination = string(ctx, a.location ?? a.target, 'destination', 100);
    const at = ctx.now + 30 * MINUTE;
    const result = await ctx.update(r, { status: 'dispatched', dueAt: at, data: { ...r.data, destination, simulationSource: 'local', synthetic: true } });
    await ctx.schedule({ type: 'clinical.robot-return', at, resourceId: r.id });
    return result;
  }
  scope(ctx, ['hr', 'roster']);
  if (r.kind !== 'staff') ctx.fail(400, 'Staff resource required');
  if (a.type === 'report_absence') {
    if (r.status === 'absent') ctx.fail(409, 'Staff member is already absent');
    return ctx.update(r, { status: 'absent', data: { ...r.data, allocated: false, absenceReason: string(ctx, a.text, 'text', 20000, true) } });
  }
  if (a.type === 'restore_staff') {
    if (r.status !== 'absent') ctx.fail(409, 'Staff member is not absent');
    return ctx.update(r, { status: 'available' });
  }
  if (r.status !== 'available') ctx.fail(409, 'Only available staff can be allocated');
  return ctx.update(r, { data: { ...r.data, allocated: true, department: string(ctx, a.location ?? a.target ?? r.data.department, 'department', 100) } });
}

export async function processClinicalJob(ctx, job) {
  if (!['clinical.test-result', 'clinical.visit-complete', 'clinical.device-reading', 'clinical.robot-return'].includes(job.type)) return undefined;
  const r = await ctx.get(job.resourceId);
  if (job.type === 'clinical.test-result') {
    if (r.kind !== 'test' || r.status !== 'ordered') return r;
    const report = await ctx.create({ kind: 'report', title: `${r.title} · local synthetic result`, status: 'available', owner: 'diagnostics', visibleTo: r.visibleTo, patientId: r.patientId, priority: r.priority, data: { kind: 'blood-result', panel: { id: r.data.bloodTestOrder?.panelId || 'custom', name: r.data.bloodTestOrder?.panel || r.title }, analytes: [], laboratory: 'Local simulation only', collectedAt: r.createdAt, synthetic: true, simulationSource: 'local', testId: r.id, text: 'Local workflow simulation completed. No specimen was collected and no clinical measurements were generated.' } });
    return ctx.update(r, { status: 'available', data: { ...r.data, resultId: report.id, result: 'Local synthetic workflow result; no clinical measurements.', resultedAt: ctx.now } });
  }
  if (job.type === 'clinical.visit-complete') {
    if (r.kind !== 'visit' || r.status !== 'scheduled') return r;
    await release(ctx, r, 'community');
    return ctx.update(r, { status: 'completed', data: { ...r.data, capacityReserved: false, completedAt: ctx.now, synthetic: true, simulationSource: 'local', outcome: 'Local simulated visit completed. This does not establish a clinical outcome.' } });
  }
  if (job.type === 'clinical.robot-return') {
    if (r.kind !== 'robot' || r.status !== 'dispatched') return r;
    return ctx.update(r, { status: 'available', data: { ...r.data, location: r.data.destination, completedAt: ctx.now } });
  }
  if (r.kind !== 'device' || r.status !== 'active') return r;
  const result = await ctx.create({ kind: 'observation', title: 'Local synthetic activity reading', status: 'available', owner: 'wearables', visibleTo: r.visibleTo, patientId: r.patientId, priority: 'routine', data: { metric: 'steps', value: 120, unit: 'steps/day', quality: 'good', observedAt: ctx.now, deviceId: r.id, synthetic: true, simulationSource: 'local', note: 'Fixed demo value, not a measurement from a person or device.' } });
  await ctx.update(r, { data: { ...r.data, lastReadingAt: ctx.now } });
  await ctx.schedule({ type: 'clinical.device-reading', at: ctx.now + 60 * MINUTE, resourceId: r.id });
  return result;
}
