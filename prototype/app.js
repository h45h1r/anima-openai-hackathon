import { renderRecords } from './screens/records.js';
import { renderAppointments } from './screens/appointments.js';
import { renderDocuments } from './screens/documents.js';
import { renderMessages } from './screens/messages.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const state = { mode: params.get('mode') === 'snapshot' ? 'snapshot' : 'live', patientId: params.get('patient') || 'SIM-000006', tab: params.get('tab') || 'Journal', patient: null, view: null, context: null, date: '2026-09-12' };
let revision = 0;
const dateLabel = value => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const button = (label, action, className) => {
  const node = element('button', label, className);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
};

async function api(path, query = {}) {
  const url = new URL(path, location.origin);
  url.searchParams.set('mode', state.mode);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function showError(error) {
  $('load-error').textContent = error.message;
  $('load-error').hidden = false;
}

function updateUrl() {
  const query = new URLSearchParams({ patient: state.patientId, tab: state.tab, mode: state.mode });
  history.replaceState(null, '', `/?${query}`);
}

const groups = {
  Record: ['Journal', 'Consultations', 'Documents', 'Coded history'],
  Clinical: ['Problems', 'Allergies', 'Medication', 'Results'],
  Workflow: ['Appointment book', 'Tasks', 'Document Inbox', 'Messagey', 'Care coordination'],
};

function navigate(tab) {
  state.tab = tab;
  updateUrl();
  renderNav();
  renderScreen();
}

function renderNav() {
  const tree = $('record-tree');
  tree.replaceChildren(button('⌂  Practice home', () => navigate('Home'), 'practice-tree-home'));
  for (const [name, tabs] of Object.entries(groups)) {
    const details = element('details');
    details.open = true;
    details.append(element('summary', name));
    for (const tab of tabs) {
      const item = button(tab, () => navigate(tab), state.tab === tab ? 'active' : '');
      if (state.tab === tab) item.setAttribute('aria-current', 'page');
      details.append(item);
    }
    tree.append(details);
  }
}

for (const [name, tabs] of Object.entries({ Patient: ['Home', 'Journal'], Appointments: ['Appointment book'], 'Clinical tools': groups.Clinical, Workflow: groups.Workflow })) {
  const details = element('details', undefined, 'shell-menu');
  details.append(element('summary', name));
  const items = element('div', undefined, 'practice-menu-items');
  tabs.forEach(tab => items.append(button(tab, () => { details.open = false; navigate(tab); })));
  details.append(items);
  $('menu').append(details);
}
const help = element('a', 'Help');
help.href = 'https://sim.animahealth.com/docs/systemtwo/';
help.target = '_blank';
help.rel = 'noreferrer';
$('menu').append(help);

const shortcuts = [['⌕', 'Search', () => $('patient-search').focus()], ['⌂', 'Home', () => navigate('Home')], ['▤', 'Consultations', () => navigate('Consultations')], ['▣', 'Appointment book', () => navigate('Appointment book')], ['✓', 'Tasks', () => navigate('Tasks')], ['▥', 'Results', () => navigate('Results')], ['▧', 'Document Inbox', () => navigate('Document Inbox')], ['✉', 'Messagey', () => navigate('Messagey')]];
for (const [icon, label, action] of shortcuts) {
  const control = button('', action);
  control.append(element('span', icon, 'shell-icon'), element('span', label));
  $('toolbar').append(control);
}

function renderPatient() {
  const patient = state.patient;
  const allergies = state.view.resources.filter(r => r.patientId === patient.id && r.kind === 'ehr-record').flatMap(r => r.data.allergies || []).filter(a => a.status !== 'inactive');
  $('patient-strip').replaceChildren(element('strong', patient.name), element('span', patient.id), element('span', `Born ${dateLabel(patient.birthDate)}`), element('span', `Allergies: ${allergies.map(a => a.term).join(', ') || 'None recorded'}`, 'practice-allergies'), element('small', 'Synthetic patient'));
  const count = state.view.resources.filter(r => r.patientId === patient.id).length;
  $('record-status').textContent = `${patient.id} · ${count} patient records · ${state.mode === 'live' ? 'Live simulator' : 'Captured 12 Sep 2026'}`;
}

async function loadPatient(id = state.patientId) {
  const current = ++revision;
  ++screenRevision;
  $('detail-dialog').close();
  $('consent-dialog').close();
  state.patientId = id;
  state.patient = null;
  state.view = null;
  $('load-error').hidden = true;
  $('patient-strip').replaceChildren(element('strong', `Loading ${id}…`));
  $('screen').replaceChildren(element('p', 'Loading patient records…', 'shell-empty'));
  $('record-status').textContent = 'Loading…';
  $('clock').textContent = '';
  $('search-results').hidden = true;
  try {
    const [data, context] = await Promise.all([api('/api/patient', { patient: id }), api('/api/context')]);
    if (current !== revision) return;
    state.patient = data.patient;
    state.view = data.view;
    state.context = context;
    state.date = new Date(context.now).toISOString().slice(0, 10);
    $('clock').textContent = `${dateLabel(context.now)} · ${new Date(context.now).toISOString().slice(11, 16)} UTC · ${context.paused ? 'Paused' : 'Running'}`;
    renderPatient();
    updateUrl();
    await renderScreen();
  } catch (error) {
    if (current !== revision) return;
    showError(error);
    $('patient-strip').replaceChildren(element('strong', 'Patient records unavailable'));
    $('screen').replaceChildren(element('p', 'Use Refresh records to retry, or choose Captured snapshot in the bottom bar.', 'shell-empty'));
    $('record-status').textContent = 'Unable to load records';
  }
}

let screenRevision = 0;
async function renderScreen() {
  const current = ++screenRevision;
  if (!state.patient || !state.view) return;
  const common = { patient: state.patient, resources: state.view.resources.filter(r => r.patientId === state.patientId || r.kind === 'message-template'), onRecordSelect: showRecord };
  const screen = $('screen');
  screen.replaceChildren();
  try {
    if (state.tab === 'Home') {
      const home = element('div', undefined, 'practice-desktop');
      const tools = element('section', undefined, 'practice-shortcuts');
      tools.append(element('h2', 'Riverside Practice'), element('p', 'Clinical workspace'));
      const grid = element('div');
      shortcuts.forEach(([icon, label, action]) => { const item = button('', action); item.append(element('span', icon, 'shell-icon'), element('span', label)); grid.append(item); });
      tools.append(grid);
      const recent = element('section', undefined, 'practice-recent');
      recent.append(element('h2', 'Open a patient record'), element('p', 'Search the directory or open the selected patient.'), button(`${state.patient.name} · ${state.patient.id}`, () => navigate('Journal')));
      home.append(tools, recent);
      screen.append(home);
    } else if (state.tab === 'Appointment book') {
      screen.append(element('p', 'Loading appointment book…', 'shell-empty'));
      const data = await api('/api/appointments', { date: state.date });
      if (current !== screenRevision) return;
      screen.replaceChildren(renderAppointments({ ...data, date: state.date, now: state.context.now, onRecordSelect: showRecord, onDateChange: date => { state.date = date; renderScreen(); } }));
    } else if (state.tab === 'Document Inbox') screen.append(renderDocuments(common));
    else if (state.tab === 'Messagey') screen.append(renderMessages(common));
    else screen.append(renderRecords({ ...common, tab: state.tab }));
  } catch (error) {
    if (current === screenRevision) { screen.replaceChildren(element('p', error.message, 'shell-empty')); }
  }
}

function dataTree(value) {
  if (value === null || value === undefined) return element('span', 'Not recorded');
  if (typeof value !== 'object') return element('span', String(value));
  if (Array.isArray(value)) {
    if (!value.length) return element('span', 'No entries recorded');
    const list = element('ul');
    for (const item of value) { const li = element('li'); li.append(dataTree(item)); list.append(li); }
    return list;
  }
  const list = element('dl');
  for (const [key, item] of Object.entries(value)) { list.append(element('dt', key.replace(/([a-z])([A-Z])/g, '$1 $2'))); const dd = element('dd'); dd.append(dataTree(item)); list.append(dd); }
  return list;
}

function showRecord(record) {
  if (typeof record === 'string') record = state.view.resources.find(r => r.id === record);
  if (!record) return;
  $('detail-title').textContent = record.title || 'Record details';
  $('detail-content').replaceChildren(element('p', `${record.id} · ${record.status} · Version ${record.version ?? 'not recorded'}`));
  if (record.patientId && record.patientId !== state.patientId) {
    $('detail-content').append(button(`Open patient ${record.patientId}`, () => { $('detail-dialog').close(); navigate('Journal'); loadPatient(record.patientId); }));
  }
  $('detail-content').append(element('h3', 'Record data'), dataTree(record.data || {}), element('h3', 'Source and changes'), dataTree(record.provenance || {}), element('p', `Visible to services: ${(record.visibleTo || []).join(', ') || 'Not recorded'}`));
  $('detail-dialog').showModal();
}

$('search-form').addEventListener('submit', async event => {
  event.preventDefault();
  const results = $('search-results');
  results.hidden = false;
  results.replaceChildren(element('p', 'Searching…'));
  const mode = state.mode;
  try {
    const data = await api('/api/patients', { q: $('patient-search').value });
    if (mode !== state.mode) return;
    results.replaceChildren(element('p', `${data.total} matches${data.total > data.items.length ? ' · first 30 shown, refine your search' : ''}`));
    data.items.forEach(patient => results.append(button(`${patient.name} · ${patient.id} · ${patient.birthDate}`, () => { state.tab = 'Journal'; renderNav(); loadPatient(patient.id); })));
    results.append(button('Close search', () => { results.hidden = true; }));
  } catch (error) { results.replaceChildren(element('p', error.message)); }
});

$('consent-launch').addEventListener('click', () => {
  const panel = $('consent-content');
  panel.replaceChildren();
  if (!state.patient) { panel.append(element('p', 'Open a patient record first.')); }
  else {
    panel.append(element('h3', state.patient.name), element('p', 'This is the place for our consent engine. These controls are not connected yet.', 'consent-note'));
    const card = element('section', undefined, 'consent-card');
    card.append(element('h3', 'Patient-managed sharing'));
    for (const label of ['Who can receive updates', 'Which records can be shared', 'Purpose and expiry', 'Withdraw permission']) {
      const row = element('div', undefined, 'consent-row');
      row.append(element('span', label), element('span', 'Not configured', 'consent-badge'));
      card.append(row);
    }
    panel.append(card, element('h3', 'What the simulator currently exposes'));
    const counts = new Map();
    for (const record of state.view.resources.filter(r => r.patientId === state.patientId)) for (const service of record.visibleTo || []) counts.set(service, (counts.get(service) || 0) + 1);
    for (const [service, count] of counts) {
      const row = element('div', undefined, 'consent-row');
      row.append(element('span', service), element('span', `${count} of the loaded records`));
      panel.append(row);
    }
    panel.append(element('p', 'Service visibility is recorded by the simulator. It is not patient consent. Family accounts and consent grants will belong to our application.', 'consent-note'));
    panel.append(element('h3', 'Where enforcement belongs'), element('p', 'Every agent tool and family-data request must pass the backend consent check before returning records. The backend must check again before sending an update.'));
  }
  $('consent-dialog').showModal();
});
$('close-consent').onclick = () => $('consent-dialog').close();
$('close-detail').onclick = () => $('detail-dialog').close();
$('reload').onclick = () => loadPatient();
$('data-mode').value = state.mode;
$('data-mode').onchange = () => { state.mode = $('data-mode').value; loadPatient(state.mode === 'snapshot' ? 'SIM-000006' : state.patientId); };
renderNav();
loadPatient();
