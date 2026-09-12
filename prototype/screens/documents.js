import { el, button, date, patientLabel, patientResources, loadStyles, inspectButton } from './correspondence-ui.js';

const stages = { all: 'All correspondence', sent: 'Awaiting review', reviewed: 'Ready to file', filed: 'Filed', draft: 'Draft' };
const sections = {
  reason: 'Reason for attendance', diagnoses: 'Diagnoses', course: 'Clinical course',
  results: 'Results', medicationChanges: 'Medication changes', followUp: 'Follow-up', gpActions: 'Actions for GP',
};

export function renderDocuments({ resources = [], patient, onRecordSelect } = {}) {
  loadStyles();
  const records = patientResources(resources, patient).filter(r => r.kind === 'discharge-summary')
    .sort((a, b) => Number(b.priority === 'urgent') - Number(a.priority === 'urgent') || (b.data?.sentAt || b.createdAt) - (a.data?.sentAt || a.createdAt));
  const root = el('section', 'document-workspace document-gp');
  root.setAttribute('aria-label', 'Document Inbox document processing');
  const banner = el('header', 'document-banner');
  const brand = el('div');
  brand.append(el('strong', '', 'Document Inbox'), el('small', '', 'Clinical correspondence · Riverside Practice'));
  banner.append(brand, el('span', '', 'Read-only preview'));
  const toolbar = el('div', 'document-toolbar');
  const searchLabel = el('label', 'document-search', 'Search correspondence');
  const search = el('input'); search.type = 'search'; search.placeholder = 'Patient, letter title or ID';
  searchLabel.append(search);
  const queueLabel = el('label', '', 'Queue');
  const queue = el('select');
  for (const [value, label] of Object.entries(stages)) {
    const option = el('option', '', `${label} (${value === 'all' ? records.length : records.filter(r => r.status === value).length})`);
    option.value = value; queue.append(option);
  }
  queueLabel.append(queue);
  const urgentLabel = el('label', 'document-check');
  const urgent = el('input'); urgent.type = 'checkbox'; urgentLabel.append(urgent, ' Urgent');
  const unassignedLabel = el('label', 'document-check');
  const unassigned = el('input'); unassigned.type = 'checkbox'; unassignedLabel.append(unassigned, ' Unassigned');
  toolbar.append(searchLabel, queueLabel, urgentLabel, unassignedLabel);
  const columns = el('div', 'document-columns');
  root.append(banner, toolbar, columns);
  let selected;

  function draw() {
    const query = search.value.toLowerCase().trim();
    const filtered = records.filter(r => (queue.value === 'all' || r.status === queue.value)
      && (!urgent.checked || r.priority === 'urgent') && (!unassigned.checked || !r.data?.assignee)
      && `${patientLabel(patient, r)} ${r.title} ${r.id} ${(r.data?.tags || []).join(' ')}`.toLowerCase().includes(query));
    const record = filtered.find(r => r.id === selected) || filtered[0];
    const inbox = el('nav', 'document-inbox'); inbox.setAttribute('aria-label', 'Document inbox');
    const heading = el('div', 'document-inbox-heading');
    heading.append(el('strong', '', 'Correspondence'), el('span', '', `${filtered.length} ${filtered.length === 1 ? 'letter' : 'letters'}`));
    inbox.append(heading);
    for (const item of filtered) {
      const row = button('', () => { selected = item.id; draw(); });
      row.setAttribute('aria-current', String(item.id === record?.id));
      const top = el('span', 'document-row-top'); top.append(el('strong', '', patientLabel(patient, item)));
      if (item.priority === 'urgent') top.append(el('b', 'document-urgent', 'Urgent'));
      const bottom = el('span', 'document-row-bottom');
      bottom.append(el('span', `document-stage document-stage-${item.status}`, stages[item.status] || item.status), el('small', '', item.data?.assignee || 'Unassigned'));
      row.append(top, el('span', 'document-row-title', item.title), el('small', '', `${item.patientId} · ${date(item.data?.sentAt || item.createdAt)}`), bottom);
      inbox.append(row);
    }
    if (!filtered.length) inbox.append(el('p', 'document-queue-empty', 'No letters match these filters. Try another queue or search.'));
    const reading = el('main', 'document-reading');
    const processing = el('aside', 'document-processing-pane');
    if (!record) {
      reading.append(el('p', 'document-empty', 'Choose a letter from the correspondence queue.'));
      columns.replaceChildren(inbox, reading, processing); return;
    }
    const data = record.data || {};
    const head = el('div', 'document-letter-head');
    const route = el('div', 'document-letter-route');
    route.append(el('span', '', 'Hospital → GP practice'), el('span', `document-stage document-stage-${record.status}`, stages[record.status] || record.status));
    head.append(route, el('h1', '', record.title), el('span', 'document-patient-link', `${patientLabel(patient, record)} · ${record.patientId}`), el('p', 'document-sender', `Received ${date(data.sentAt || record.createdAt)} UTC${data.sentBy ? ` · ${data.sentBy}` : ''}`));
    const letter = el('article', 'document-letter'); letter.setAttribute('aria-label', 'Letter contents');
    const paperLabel = el('div', 'document-paper-label'); paperLabel.append('Clinical correspondence', el('span', '', 'Synthetic record'));
    letter.append(paperLabel);
    for (const [key, title] of Object.entries(sections)) {
      const section = el('section'); section.append(el('h3', '', title), el('p', data.sections?.[key] ? '' : 'document-empty-section', data.sections?.[key] || 'Not entered')); letter.append(section);
    }
    const history = el('details', 'document-history'); history.append(el('summary', '', 'Authorship and activity history'));
    const historyBody = el('div', 'document-record-history');
    const events = [record.provenance?.created, ...(record.provenance?.changes || [])].filter(Boolean);
    for (const event of events) historyBody.append(el('p', '', `${date(event.time)} UTC · ${event.actor?.name || event.actor?.kind || 'Unknown author'} · ${event.action} · version ${event.version}`));
    if (!events.length) historyBody.append(el('p', '', 'No authorship history returned.'));
    history.append(historyBody); reading.append(head, letter, history);
    processing.append(el('h2', '', 'Process this letter'));
    const steps = el('ol', 'document-steps');
    ['Review', 'File', 'Complete'].forEach((title, i) => { const step = el('li', ['sent', 'reviewed', 'filed'][i] === record.status ? 'active' : ''); step.append(el('span', '', i + 1), title); steps.append(step); });
    const facts = el('dl', 'document-facts');
    for (const [title, value] of [['Patient', patientLabel(patient, record)], ['Assigned to', data.assignee || 'Unassigned'], ['Priority', record.priority || 'Routine']]) facts.append(el('dt', '', title), el('dd', '', value));
    processing.append(steps, facts, inspectButton(record, onRecordSelect, 'document-privacy-button'));
    const codes = el('details', 'document-coding'); codes.append(el('summary', '', `Tags and SNOMED codes · ${(data.tags || []).length} tags · ${(data.snomedCodes || []).length} codes`));
    for (const tag of data.tags || []) codes.append(el('p', '', tag));
    for (const code of data.snomedCodes || []) codes.append(el('p', '', `${code.display} · ${code.code}`));
    if (!data.tags?.length && !data.snomedCodes?.length) codes.append(el('p', 'document-help', 'No tags or codes recorded.'));
    processing.append(codes);
    for (const [field, title] of [['reviewNote', 'Review recorded'], ['filingNote', 'Filed to patient history']]) {
      if (data[field]) { const outcome = el('section', 'document-outcome'); outcome.append(el('h3', '', title), el('p', '', data[field])); processing.append(outcome); }
    }
    processing.append(el('p', 'document-help', 'Assignment, review and filing controls are disabled in this read-only preview.'));
    const disabled = button(record.status === 'reviewed' ? 'File to patient history' : 'Confirm reviewed', null, 'document-primary'); disabled.disabled = true; processing.append(disabled);
    columns.replaceChildren(inbox, reading, processing);
  }
  [search, queue, urgent, unassigned].forEach(input => input.addEventListener(input === search ? 'input' : 'change', () => { selected = undefined; draw(); }));
  draw();
  return root;
}
