const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const requested = new URLSearchParams(location.search).get('patient') || 'SIM-000006';
const patientId = /^SIM-\d{6}$/.test(requested) ? requested : null;
const when = value => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-GB', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
};
let state = null;
let selectedMember = null;
let events = null;
let requestInFlight = null;
let refreshAgain = false;
let streamConnected = false;
let closing = false;

async function api(path, options = {}) {
  const response = await fetch(path, {...options, credentials:'same-origin', headers:{'Content-Type':'application/json',...options.headers}, signal:AbortSignal.timeout(15000)});
  let result;
  try { result = await response.json(); } catch { throw new Error(`The consent service returned an unreadable response (${response.status}).`); }
  if (!response.ok) { const error = new Error(result.message || result.error || `Request failed (${response.status}).`); error.status = response.status; throw error; }
  return result;
}

function error(message) {
  $('error-message').textContent = message;
  $('error').hidden = false;
  document.querySelector('.status-strip').classList.add('stale');
  $('sync-status').textContent = state ? 'Showing last loaded preferences' : 'Consent record unavailable';
}

function connection() {
  $('connection').textContent = streamConnected ? 'Live updates connected' : 'Live updates reconnecting…';
  if (state && !streamConnected) {
    document.querySelector('.status-strip').classList.add('stale');
    $('sync-status').textContent = 'Live connection interrupted · Showing last loaded preferences';
  }
}

function detail() {
  const member = state?.members.find(item => item.id === selectedMember);
  $('member-detail').hidden = !member;
  if (!member) return;
  const fields = [['Relationship',member.relationship],['Email',member.email || 'Not provided'],['Status',member.status],['Permission version',member.version ?? '—'],['Last changed',when(member.updatedAt)],['Shared categories',member.status === 'revoked' ? 'None · Access revoked' : state.categories.filter(category => member.categories.includes(category.id)).map(category => category.label).join(', ') || 'None']];
  $('member-detail').innerHTML = `<div class="section-heading"><div><h2>${escape(member.name)}</h2><p>Saved circle access details · Read only</p></div><button type="button" id="close-detail" aria-label="Close family member details">Close</button></div><div class="detail-body">${fields.map(([label,value]) => `<dl><dt>${escape(label)}</dt><dd>${escape(value)}</dd></dl>`).join('')}</div>`;
  $('close-detail').onclick = () => { selectedMember = null; detail(); };
}

function render() {
  const {patient,categories,members,audit,sync} = state;
  $('patient-name').textContent = patient.name;
  $('patient-id').textContent = patient.id;
  $('patient-birth').textContent = patient.dateOfBirth ? `Born ${new Date(patient.dateOfBirth).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'})}` : '';
  $('revision').textContent = `Revision ${state.revision}`;
  $('last-sync').textContent = `Last synced ${when(sync?.updatedAt)}`;
  $('sync-status').textContent = sync?.status === 'synced' ? 'Synced with patient app' : sync?.status === 'not_configured' ? 'No sharing preferences configured' : `Sync status: ${sync?.status || 'unknown'}`;
  document.querySelector('.status-strip').classList.toggle('stale', !['synced','not_configured'].includes(sync?.status));
  $('member-count').textContent = `${members.filter(member => member.status === 'active').length} active · ${members.length} total`;
  $('matrix').setAttribute('aria-busy','false');
  if (!members.length) {
    $('matrix').innerHTML = '<div class="empty"><strong>No circle members have been added</strong>The patient can add family members and choose what to share in the patient app.</div>';
  } else {
    $('matrix').innerHTML = `<table><thead><tr><th scope="col">Circle member</th>${categories.map(category => `<th scope="col" title="${escape(category.description)}">${escape(category.label)}</th>`).join('')}</tr></thead><tbody>${members.map(member => `<tr class="${member.status === 'revoked' ? 'revoked' : ''}"><td><button class="member-button" type="button" data-member="${escape(member.id)}">${escape(member.name)}</button>${member.status === 'revoked' ? '<span class="member-status">Revoked</span>' : ''}<div class="member-meta">${escape(member.relationship)} · v${escape(member.version)}</div></td>${categories.map(category => { const allowed = member.status === 'active' && member.categories.includes(category.id); return `<td><span class="${allowed ? 'allowed' : 'blocked'}" role="img" aria-label="${escape(category.label)}: ${allowed ? 'Allowed' : 'Not shared'}" title="${escape(category.description)} · ${allowed ? 'Allowed' : 'Not shared'}">${allowed ? '✓' : '—'}</span></td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
  }
  $('audit-list').innerHTML = audit.length ? [...audit].sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)).map(entry => `<article class="audit-entry"><time class="audit-time" datetime="${escape(entry.createdAt)}">${when(entry.createdAt)}</time><div><div class="audit-title">${escape(entry.action.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase()))}${entry.memberName ? ` · ${escape(entry.memberName)}` : ''}</div><div class="audit-detail">${escape(typeof entry.detail === 'object' ? JSON.stringify(entry.detail) : entry.detail)}</div><div class="audit-actor">By ${escape(typeof entry.actor === 'object' ? entry.actor.name || entry.actor.id || JSON.stringify(entry.actor) : entry.actor)}</div></div></article>`).join('') : '<p class="empty">No permission changes recorded yet.</p>';
  detail();
}

async function loadState() {
  if (requestInFlight) { refreshAgain = true; return requestInFlight; }
  $('refresh').disabled = true;
  requestInFlight = (async () => {
    try {
      const result = await api(`/api/companion/gp/state?patientId=${encodeURIComponent(patientId)}`);
      if (!result.patient || !Array.isArray(result.categories) || !Array.isArray(result.members) || !Array.isArray(result.audit)) throw new Error('The consent service returned an incomplete record.');
      state = result;
      $('error').hidden = true;
      render();
      if (events && !streamConnected) connection();
    } catch (problem) {
      error(problem.name === 'TimeoutError' ? 'The consent service took too long to respond. Try again.' : problem.message);
      throw problem;
    } finally { requestInFlight = null; $('refresh').disabled = false; }
  })();
  try { await requestInFlight; } finally { if (refreshAgain) { refreshAgain = false; void loadState().catch(() => {}); } }
}

function listen() {
  events?.close();
  streamConnected = false;
  events = new EventSource(`/api/companion/gp/events?patientId=${encodeURIComponent(patientId)}`);
  events.onopen = () => { streamConnected = true; connection(); void loadState().catch(() => {}); };
  events.addEventListener('change', event => {
    try { const change = JSON.parse(event.data); if (!state || change.revision !== state.revision) void loadState().catch(() => {}); }
    catch { void loadState().catch(() => {}); }
  });
  events.onerror = () => { if (!closing) { streamConnected = false; connection(); } };
}

async function start() {
  if (!patientId) { error('Invalid patient identifier. Open this page with a SIM patient ID.'); return; }
  $('patient-id').textContent = patientId;
  for (const id of ['gp-link','back-record']) $(id).href = `/gp/?patient=${encodeURIComponent(patientId)}`;
  $('companion-link').href = `/companion/?patient=${encodeURIComponent(patientId)}`;
  $('retry').disabled = true;
  try {
    await api('/api/companion/gp/session',{method:'POST',body:JSON.stringify({patientId})});
    await loadState();
    listen();
  } catch (problem) { error(problem.message); $('connection').textContent = 'Consent connection unavailable'; }
  finally { $('retry').disabled = false; }
}

$('matrix').addEventListener('click', event => {
  const button = event.target.closest('[data-member]');
  if (button) { selectedMember = button.dataset.member; detail(); }
});
$('refresh').onclick = () => { void loadState().catch(() => {}); };
$('retry').onclick = () => { void start(); };
window.addEventListener('beforeunload', () => { closing = true; events?.close(); });
void start();
