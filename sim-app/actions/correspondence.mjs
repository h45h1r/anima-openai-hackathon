import { randomUUID } from 'node:crypto';

const sectionNames = ['reason', 'course', 'diagnoses', 'medicationChanges', 'results', 'followUp', 'gpActions'];
const messageCommands = new Set(['create', 'send', 'reply', 'note', 'assign', 'complete', 'reopen', 'delivery', 'retry', 'save_template', 'archive_template']);

function text(ctx, value, name, maximum, allowEmpty = false) {
  if (typeof value !== 'string' || value.trim().length > maximum || (!allowEmpty && !value.trim())) {
    ctx.fail(400, `${name} must be ${allowEmpty ? 'at most' : 'between 1 and'} ${maximum} characters.`);
  }
  return value.trim();
}

function channel(ctx, value) {
  if (!['sms', 'email'].includes(value)) ctx.fail(400, 'Channel must be sms or email.');
  return value;
}

function site(ctx, allowed) {
  if (!allowed.includes(ctx.site)) ctx.fail(403, 'This workspace cannot perform that action.');
}

async function existing(ctx, kind) {
  const id = text(ctx, ctx.action.resourceId, 'resourceId', 500);
  const resource = await ctx.get(id);
  if (resource.kind !== kind) ctx.fail(400, `Expected a ${kind} resource.`);
  ctx.requireVersion(resource, ctx.action.expectedVersion);
  return resource;
}

function entry(ctx, command, direction, chosenChannel) {
  const value = { id: `message-entry-${randomUUID()}`, at: ctx.now, actor: ctx.actor, body: text(ctx, command.body, 'Message body', 5000), direction };
  if (direction !== 'internal') value.channel = channel(ctx, chosenChannel);
  if (direction === 'outgoing') value.delivery = [{ at: ctx.now, actor: ctx.actor, status: 'queued' }];
  return value;
}

async function messaging(ctx) {
  const { action } = ctx;
  const command = action.messagingCommand;
  if (!command || !messageCommands.has(command.kind)) ctx.fail(400, 'Unsupported messaging command.');
  const patientRole = ['patient', 'wearables'].includes(ctx.site);
  site(ctx, ['gp', 'patient', 'wearables']);
  if (patientRole && command.kind !== 'reply') ctx.fail(403, 'Patients can only reply to delivered conversations.');

  if (command.kind === 'create') {
    const patientId = text(ctx, action.patientId, 'patientId', 500);
    const title = text(ctx, command.subject, 'Subject', 160);
    if (typeof command.allowReply !== 'boolean') ctx.fail(400, 'allowReply must be a boolean.');
    return ctx.create({ kind: 'conversation', owner: 'gp', visibleTo: ['gp', 'patient'], patientId, title,
      status: 'open', priority: 'routine', data: { assignee: '', allowReply: command.allowReply, entries: [entry(ctx, command, 'outgoing', command.channel)] } });
  }

  if (command.kind === 'save_template') {
    const title = text(ctx, command.title, 'Template title', 120);
    const data = { body: text(ctx, command.body, 'Template body', 5000), channel: channel(ctx, command.channel) };
    if (action.resourceId) {
      const resource = await existing(ctx, 'message-template');
      if (resource.owner !== 'gp') ctx.fail(403, 'This template belongs to another workspace.');
      if (resource.status !== 'active') ctx.fail(409, 'Archived templates cannot be edited.');
      return ctx.update(resource, { title, data });
    }
    return ctx.create({ kind: 'message-template', owner: 'gp', visibleTo: ['gp'], title, status: 'active', priority: 'routine', data });
  }

  if (command.kind === 'archive_template') {
    const resource = await existing(ctx, 'message-template');
    if (resource.owner !== 'gp') ctx.fail(403, 'This template belongs to another workspace.');
    if (resource.status !== 'active') ctx.fail(409, 'Template is already archived.');
    return ctx.update(resource, { status: 'archived' });
  }

  const resource = await existing(ctx, 'conversation');
  if (resource.owner !== 'gp') ctx.fail(403, 'This conversation belongs to another workspace.');
  const data = structuredClone(resource.data);
  if (patientRole && (!action.patientId || resource.patientId !== action.patientId)) ctx.fail(403, 'Conversation does not belong to the selected patient.');

  if (command.kind === 'reply') {
    if (!patientRole) ctx.fail(403, 'Replies must be sent from the patient workspace.');
    if (resource.status !== 'open' || !data.allowReply) ctx.fail(409, 'This conversation does not accept replies.');
    const delivered = data.entries.filter(e => e.direction === 'outgoing' && e.delivery?.at(-1)?.status === 'delivered').at(-1);
    if (!delivered) ctx.fail(409, 'A practice message must be delivered before the patient can reply.');
    data.entries.push(entry(ctx, command, 'incoming', delivered.channel));
  } else if (command.kind === 'send' || command.kind === 'note') {
    if (resource.status !== 'open') ctx.fail(409, 'Reopen the conversation before adding messages.');
    data.entries.push(entry(ctx, command, command.kind === 'note' ? 'internal' : 'outgoing', command.channel));
  } else if (command.kind === 'assign') {
    data.assignee = text(ctx, command.assignee, 'Assignee', 120, true);
  } else if (command.kind === 'complete' || command.kind === 'reopen') {
    const expectedStatus = command.kind === 'complete' ? 'open' : 'done';
    if (resource.status !== expectedStatus) ctx.fail(409, `Conversation must be ${expectedStatus}.`);
    return ctx.update(resource, { status: command.kind === 'complete' ? 'done' : 'open' });
  } else if (command.kind === 'delivery' || command.kind === 'retry') {
    const target = data.entries.find(e => e.id === command.entryId);
    if (!target || target.direction !== 'outgoing') ctx.fail(400, 'Select an outgoing message.');
    const status = target.delivery?.at(-1)?.status;
    if (command.kind === 'retry') {
      if (status !== 'failed') ctx.fail(409, 'Only failed messages can be retried.');
      target.delivery.push({ at: ctx.now, actor: ctx.actor, status: 'queued' });
    } else {
      if (!['delivered', 'failed'].includes(command.status)) ctx.fail(400, 'Delivery outcome must be delivered or failed.');
      if (status !== 'queued') ctx.fail(409, 'Only queued messages can receive a delivery outcome.');
      target.delivery.push({ at: ctx.now, actor: ctx.actor, status: command.status });
    }
  }
  return ctx.update(resource, { data });
}

function dischargeSections(ctx, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) ctx.fail(400, 'dischargeSections is required.');
  return Object.fromEntries(sectionNames.map(key => [key, text(ctx, input[key], key, 10000, true)]));
}

async function saveDischarge(ctx) {
  site(ctx, ['hospital']);
  const { action } = ctx;
  const sections = dischargeSections(ctx, action.dischargeSections);
  const title = text(ctx, action.title, 'Letter title', 500);
  if (action.resourceId) {
    const resource = await existing(ctx, 'discharge-summary');
    if (resource.owner !== 'hospital') ctx.fail(403, 'Only hospital-authored summaries can be edited here.');
    if (resource.status !== 'draft' || resource.data.stage !== 'draft') ctx.fail(409, 'Sent letters are locked.');
    if (action.patientId && action.patientId !== resource.patientId) ctx.fail(400, 'A letter cannot be moved to another patient.');
    return ctx.update(resource, { title, data: { ...resource.data, sections } });
  }
  const patientId = text(ctx, action.patientId, 'patientId', 500);
  return ctx.create({ kind: 'discharge-summary', owner: 'hospital', visibleTo: ['hospital'], patientId, title,
    status: 'draft', priority: 'routine', data: { stage: 'draft', sections, assignee: '', tags: [], snomedCodes: [] } });
}

function annotation(ctx) {
  const { documentTags: tags, documentSnomedCodes: codes } = ctx.action;
  if (!Array.isArray(tags) || tags.length > 20 || !Array.isArray(codes) || codes.length > 20) ctx.fail(400, 'Provide at most 20 tags and 20 SNOMED codes.');
  const cleanTags = tags.map(tag => text(ctx, tag, 'Tag', 50));
  if (new Set(cleanTags.map(t => t.toLowerCase())).size !== cleanTags.length) ctx.fail(400, 'Document tags must be unique.');
  const cleanCodes = codes.map(code => {
    if (!code || typeof code.code !== 'string' || !/^[0-9]{6,18}$/.test(code.code)) ctx.fail(400, 'Invalid SNOMED code.');
    return { code: code.code, display: text(ctx, code.display, 'SNOMED display', 200) };
  });
  if (new Set(cleanCodes.map(c => c.code)).size !== cleanCodes.length) ctx.fail(400, 'SNOMED codes must be unique.');
  return { tags: cleanTags, snomedCodes: cleanCodes };
}

async function processDocument(ctx) {
  const { action } = ctx;
  const command = action.documentCommand;
  if (!['send', 'assign', 'review', 'file', 'annotate'].includes(command)) ctx.fail(400, 'Unsupported document command.');
  site(ctx, command === 'send' ? ['hospital'] : ['gp']);
  const resource = await existing(ctx, 'discharge-summary');
  if (resource.owner !== 'hospital') ctx.fail(403, 'This is not hospital correspondence.');
  const data = { ...resource.data };
  if (resource.status !== data.stage) ctx.fail(409, 'The document stage and status disagree.');
  if (command === 'send') {
    if (data.stage !== 'draft') ctx.fail(409, 'Only draft letters can be sent.');
    const sections = dischargeSections(ctx, data.sections);
    if (sectionNames.some(key => !sections[key])) ctx.fail(400, 'Complete every letter section before sending.');
    return ctx.update(resource, { status: 'sent', visibleTo: [...new Set([...resource.visibleTo, 'gp'])],
      data: { ...data, sections, stage: 'sent', sentAt: ctx.now, sentBy: ctx.actor.name } });
  }
  if (data.stage === 'draft') ctx.fail(409, 'Draft letters have not been sent to the GP practice.');
  if (!resource.visibleTo.includes('gp')) ctx.fail(403, 'This letter has not been shared with the GP practice.');
  if (command === 'annotate') return ctx.update(resource, { data: { ...data, ...annotation(ctx) } });
  if (command === 'assign') {
    if (data.stage === 'filed') ctx.fail(409, 'Filed letters cannot be reassigned.');
    return ctx.update(resource, { data: { ...data, assignee: text(ctx, action.clinician, 'Clinician or team', 100) } });
  }
  if (command === 'review') {
    if (data.stage !== 'sent') ctx.fail(409, 'Only letters awaiting review can be reviewed.');
    return ctx.update(resource, { status: 'reviewed', data: { ...data, stage: 'reviewed', reviewNote: text(ctx, action.text, 'Review note', 20000), reviewedAt: ctx.now, reviewedBy: ctx.actor.name } });
  }
  if (data.stage !== 'reviewed') ctx.fail(409, 'Review the letter before filing.');
  return ctx.update(resource, { status: 'filed', data: { ...data, stage: 'filed', filingNote: text(ctx, action.text, 'Filing note', 20000), filedAt: ctx.now, filedBy: ctx.actor.name } });
}

export async function handleCorrespondence(ctx) {
  switch (ctx.action.type) {
    case 'messaging_action': return messaging(ctx);
    case 'save_discharge_summary': return saveDischarge(ctx);
    case 'process_document': return processDocument(ctx);
    default: return undefined;
  }
}
