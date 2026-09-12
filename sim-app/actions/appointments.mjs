const MINUTE = 60_000;
const MODES = ['in-person', 'telephone', 'video', 'online'];
const ACTIONS = new Set(['create_appointment_session', 'book_appointment', 'set_appointment_slot', 'arrive_appointment', 'cancel_appointment', 'complete']);
const occupiesSlot = resource => !['cancelled', 'rejected'].includes(resource.status);
const overlaps = (start, end, otherStart, otherEnd) => start < otherEnd && end > otherStart;

function text(ctx, value, field, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) ctx.fail(400, `${field} must contain 1–${max} characters`);
  return value.trim();
}

function timestamp(ctx, value, field) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) ctx.fail(400, `${field} must be a UTC timestamp in milliseconds`);
  return value;
}

function minutes(ctx, value, field) {
  if (!Number.isInteger(value) || value < 5 || value > 120) ctx.fail(400, `${field} must be an integer between 5 and 120`);
  return value;
}

function mode(ctx, value) {
  if (!MODES.includes(value)) ctx.fail(400, 'Unsupported appointment mode');
  return value;
}

function requireGp(ctx, resource) {
  if (!['gp', 'control'].includes(ctx.site) || (resource && resource.owner !== 'gp')) ctx.fail(403, 'Appointment changes require GP access');
}

function requireSession(ctx, resource) {
  requireGp(ctx, resource);
  if (resource.kind !== 'appointment-session') ctx.fail(400, 'Resource is not an appointment session');
  if (resource.status !== 'open') ctx.fail(409, 'Appointment session is not open');
}

function requireSlot(ctx, session, start) {
  timestamp(ctx, start, 'startsAt');
  const { startsAt, endsAt, slotMinutes } = session.data;
  const duration = slotMinutes * MINUTE;
  if (!(duration > 0) || start < startsAt || start + duration > endsAt || (start - startsAt) % duration !== 0) ctx.fail(400, 'Appointment must start on the session slot grid');
}

async function assertAvailable(ctx, { startsAt, durationMinutes, clinician, patientId }) {
  const appointments = await ctx.list({ kind: 'appointment', site: 'gp' });
  const conflict = appointments.find(resource => occupiesSlot(resource) && (resource.data.clinician === clinician || (patientId && resource.patientId === patientId)) && overlaps(startsAt, startsAt + durationMinutes * MINUTE, Number(resource.data.startsAt), Number(resource.data.startsAt) + Number(resource.data.durationMinutes) * MINUTE));
  if (conflict) ctx.fail(409, conflict.patientId === patientId ? 'Patient already has an overlapping appointment' : 'Clinician already has an overlapping appointment');
}

async function reserveLegacyCapacity(ctx) {
  const capacity = await ctx.get('capacity-gp');
  if (capacity.kind !== 'capacity' || capacity.owner !== 'gp') ctx.fail(409, 'GP appointment capacity is unavailable');
  if (!(Number(capacity.data.remaining) > 0)) ctx.fail(409, 'No GP appointment capacity remains');
  await ctx.update(capacity, { data: { ...capacity.data, remaining: Number(capacity.data.remaining) - 1 } });
}

async function releaseLegacyCapacity(ctx, appointment) {
  if (!appointment.data.capacityReserved) return;
  const capacity = await ctx.get('capacity-gp');
  const remaining = Number(capacity.data.remaining) + 1;
  await ctx.update(capacity, { data: { ...capacity.data, remaining: Math.min(Number(capacity.data.total), remaining) } });
}

/** Called inside the dispatcher's transaction so availability checks and writes are atomic. */
export async function handleAppointments(ctx) {
  const action = ctx.action;
  if (!ACTIONS.has(action.type)) return undefined;
  let appointment;
  if (['arrive_appointment', 'cancel_appointment', 'complete'].includes(action.type)) {
    appointment = await ctx.get(text(ctx, action.resourceId, 'resourceId'));
    if (action.type === 'complete' && appointment.kind !== 'appointment') return undefined;
    requireGp(ctx, appointment);
    if (appointment.kind !== 'appointment') ctx.fail(400, 'Resource is not an appointment');
    await ctx.requireVersion(appointment, action.expectedVersion);
  } else requireGp(ctx);

  if (action.type === 'create_appointment_session') {
    const title = text(ctx, action.title, 'title');
    const data = {
      clinician: text(ctx, action.clinician, 'clinician', 100),
      location: text(ctx, action.location, 'location', 100),
      startsAt: timestamp(ctx, action.startsAt, 'startsAt'),
      endsAt: timestamp(ctx, action.endsAt, 'endsAt'),
      slotMinutes: minutes(ctx, action.slotMinutes, 'slotMinutes'),
      mode: mode(ctx, action.mode),
      blockedSlots: [],
    };
    const length = data.endsAt - data.startsAt;
    if (length <= 0 || length > 86_400_000 || length % (data.slotMinutes * MINUTE)) ctx.fail(400, 'Session must contain whole slots and last no more than 24 hours');
    const sessions = await ctx.list({ kind: 'appointment-session', site: 'gp' });
    if (sessions.some(resource => resource.status === 'open' && resource.data.clinician === data.clinician && overlaps(data.startsAt, data.endsAt, resource.data.startsAt, resource.data.endsAt))) ctx.fail(409, 'Clinician already has an overlapping session');
    return ctx.create({ kind: 'appointment-session', title, status: 'open', owner: 'gp', visibleTo: ['gp'], priority: 'routine', data });
  }

  if (action.type === 'book_appointment') {
    const patientId = text(ctx, action.patientId, 'patientId');
    await ctx.getPatient(patientId);
    const title = text(ctx, action.title, 'title');
    let session;
    let data;
    if (action.sessionId !== undefined) {
      session = await ctx.get(text(ctx, action.sessionId, 'sessionId'));
      requireSession(ctx, session);
      await ctx.requireVersion(session, action.sessionVersion);
      requireSlot(ctx, session, action.startsAt);
      if ((session.data.blockedSlots || []).some(slot => slot.startsAt === action.startsAt)) ctx.fail(409, 'Appointment slot is blocked');
      data = { sessionId: session.id, startsAt: action.startsAt, durationMinutes: session.data.slotMinutes, clinician: session.data.clinician, location: session.data.location, mode: session.data.mode, capacityReserved: false };
    } else {
      data = {
        startsAt: timestamp(ctx, action.startsAt ?? ctx.now + 30 * MINUTE, 'startsAt'),
        durationMinutes: minutes(ctx, action.durationMinutes ?? 15, 'durationMinutes'),
        clinician: text(ctx, action.clinician ?? 'Practice team', 'clinician', 100),
        mode: mode(ctx, action.mode ?? 'in-person'),
        capacityReserved: true,
      };
    }
    if (data.startsAt < ctx.now) ctx.fail(409, 'Cannot book an appointment in the past');
    await assertAvailable(ctx, { ...data, patientId });
    if (session) await ctx.update(session, { data: { ...session.data } });
    else await reserveLegacyCapacity(ctx);
    return ctx.create({ kind: 'appointment', title, status: 'booked', owner: 'gp', visibleTo: ['gp'], patientId, priority: 'routine', dueAt: data.startsAt, data });
  }

  if (action.type === 'set_appointment_slot') {
    const session = await ctx.get(text(ctx, action.resourceId, 'resourceId'));
    requireSession(ctx, session);
    await ctx.requireVersion(session, action.expectedVersion);
    requireSlot(ctx, session, action.startsAt);
    if (!['block', 'unblock'].includes(action.slotCommand)) ctx.fail(400, 'slotCommand must be block or unblock');
    let blockedSlots = [...(session.data.blockedSlots || [])];
    const exists = blockedSlots.some(slot => slot.startsAt === action.startsAt);
    if (action.slotCommand === 'block') {
      const reason = text(ctx, action.text, 'text');
      if (action.startsAt < ctx.now) ctx.fail(409, 'Cannot block a slot in the past');
      if (exists) ctx.fail(409, 'Appointment slot is already blocked');
      await assertAvailable(ctx, { startsAt: action.startsAt, durationMinutes: session.data.slotMinutes, clinician: session.data.clinician });
      blockedSlots.push({ startsAt: action.startsAt, reason });
      blockedSlots.sort((a, b) => a.startsAt - b.startsAt);
    } else {
      if (!exists) ctx.fail(409, 'Appointment slot is not blocked');
      blockedSlots = blockedSlots.filter(slot => slot.startsAt !== action.startsAt);
    }
    return ctx.update(session, { data: { ...session.data, blockedSlots } });
  }

  if (action.type === 'arrive_appointment') {
    if (appointment.status !== 'booked') ctx.fail(409, 'Only booked appointments can arrive');
    return ctx.update(appointment, { status: 'arrived', data: { ...appointment.data, arrivedAt: ctx.now } });
  }

  if (!['booked', 'arrived'].includes(appointment.status)) ctx.fail(409, 'Only booked or arrived appointments can be completed or cancelled');
  await releaseLegacyCapacity(ctx, appointment);
  if (action.type === 'cancel_appointment' && appointment.data.sessionId) {
    const session = await ctx.get(appointment.data.sessionId);
    await ctx.update(session, { data: { ...session.data } });
  }
  const status = action.type === 'complete' ? 'completed' : 'cancelled';
  return ctx.update(appointment, { status, data: { ...appointment.data, capacityReserved: false, [status === 'completed' ? 'completedAt' : 'cancelledAt']: ctx.now } });
}
