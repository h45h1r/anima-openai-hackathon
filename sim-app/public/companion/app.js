const role = document.body.dataset.mode;
const api = `/api/companion/${role}`;
const root = document.querySelector('#app');
let state, stream, busy = false, lastFocus;
const patientId = new URLSearchParams(location.search).get('patient') || 'SIM-000006';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('');
const date = (value, full = false) => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', ...(full ? { hour: '2-digit', minute: '2-digit' } : { year: 'numeric' }) }).format(new Date(value)) : 'Not recorded';
const gpLink = () => `/gp/consent/?patient=${encodeURIComponent(state?.patient.id || patientId)}`;
async function request(route, method = 'GET', input) {
  const query = role === 'patient' ? `?patientId=${encodeURIComponent(patientId)}` : '';
  const response = await fetch(api + route + query, { method, headers: input ? { 'Content-Type': 'application/json' } : {}, ...(input ? { body: JSON.stringify(input) } : {}), signal: AbortSignal.timeout(15000), cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Please try again.'), { status: response.status });
  return data;
}
function notify(message) {
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div'); toast.className = 'toast'; toast.textContent = message; toast.setAttribute('role', 'status'); document.body.append(toast);
  document.querySelector('#announcement').textContent = message;
  setTimeout(() => toast.remove(), 4500);
}
function modal(html, drawer = false) {
  lastFocus = document.activeElement;
  const d = document.createElement('dialog'); d.className = drawer ? 'drawer' : 'modal'; d.innerHTML = html;
  d.setAttribute('aria-labelledby', 'dialog-title'); document.body.append(d);
  d.addEventListener('close', () => { d.remove(); if (lastFocus?.isConnected) lastFocus.focus(); });
  d.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => d.close()));
  d.showModal(); return d;
}
function renderPatient() {
  const active = state.members.filter(m => m.status === 'active');
  root.innerHTML = `<div class="shell"><aside class="sidebar"><div><a class="wordmark" href="/companion/?patient=${esc(state.patient.id)}">kindred<span>✳</span></a><p class="tagline">Your care. Your choice.</p></div><div class="profile"><span class="avatar">${esc(initials(state.patient.name))}</span><div><strong>${esc(state.patient.name)}</strong><small>Your patient account</small></div></div><nav class="nav" aria-label="Main navigation"><a class="active" href="#circle"><span aria-hidden="true">♧</span>Family & sharing</a><a href="#activity"><span aria-hidden="true">◷</span>Sharing history</a><a href="${gpLink()}" target="_blank" rel="noopener"><span aria-hidden="true">▤</span>View GP consent ↗</a></nav><div class="side-bottom"><span class="demo-tag">Local demo</span><p>Synthetic patient records.<br>Patient and GP demo accounts.</p><a href="/control/">← Back to the neighbourhood</a></div></aside><main class="main"><div class="topline"><span>My care / Family & sharing</span><span data-live><span class="dot"></span>Live connection</span></div><div id="load-error"></div><div class="heading-row"><div><p class="eyebrow">YOU DECIDE WHO KNOWS WHAT</p><h1>Your circle of care.</h1><p class="lead">Keep the people you trust in the loop.<br>Choose what you share with each person, and change it whenever you need.</p></div><button class="button" data-add><span aria-hidden="true">＋</span> Add family member</button></div><section class="sync-card" aria-label="GP sync status"><div class="sync-copy"><span class="sync-icon" aria-hidden="true">✓</span><div><strong>${state.revision ? 'Your choices are synced with GP Records' : 'Your GP will see the choices you make here'}</strong><p>${state.revision ? `Saved ${esc(date(state.updatedAt, true))} · Revision ${state.revision} · Local GP record` : 'Nothing is shared with family until you choose.'}</p></div></div><a href="${gpLink()}" target="_blank" rel="noopener">View GP consent ↗</a></section><div class="layout"><div><section id="circle"><div class="section-heading"><h2>People you trust <span class="count">${active.length}</span></h2><small>Different people. Different permissions.</small></div><div class="members">${state.members.length ? state.members.map(memberCard).join('') : `<div class="card empty"><div class="circle-art" aria-hidden="true"><span>♧</span><span>♡</span><span>♧</span></div><h3>A little support starts here.</h3><p>Add a family member or carer. You can share appointment details with one person and more with another.</p><button class="button secondary" data-add>＋ Add your first person</button></div>`}</div></section><section class="activity" id="activity"><div class="section-heading"><h2>Your sharing history</h2><small>Every change is recorded</small></div><div class="card">${state.audit.length ? `<ol class="audit-list">${state.audit.slice(0, 12).map(a => `<li><span class="audit-dot" aria-hidden="true"></span><div><p>${esc(a.detail)}</p><small>${esc(date(a.createdAt, true))} · ${esc(a.actor)} · Revision ${a.revision}</small></div></li>`).join('')}</ol>` : '<p class="blank-audit">Your changes will appear here when you add someone or update sharing.</p>'}</div></section></div><aside class="right-col"><div class="aside-card"><p class="eyebrow">ALWAYS YOUR CHOICE</p><h3>Small choices.<br>Peace of mind.</h3><ol class="steps"><li><span class="step-num">1</span><div><b>Add someone you trust</b>A family member, a friend or a carer.</div></li><li><span class="step-num">2</span><div><b>Choose what they can see</b>Sharing starts off for every category.</div></li><li><span class="step-num">3</span><div><b>Everyone stays up to date</b>Your GP sees your choices. Each person sees only the records you allow.</div></li></ol></div><div class="aside-note"><strong>You're in control.</strong>Family access never lets someone edit your medical record. You can stop future access at any time.<p>These choices apply to family sharing. They do not change your GP's access for your care.</p></div></aside></div><p class="footer-note">Kindred · Local simulation · Changes are saved in the local GP system.</p></main></div>`;
  root.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => editMember()));
  root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editMember(state.members.find(m => m.id === b.dataset.edit))));
  root.querySelectorAll('[data-invite]').forEach(b => b.addEventListener('click', () => invitation(state.members.find(m => m.id === b.dataset.invite), b)));
  root.querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', () => restore(state.members.find(m => m.id === b.dataset.restore), b)));
}
function memberCard(m) {
  const revoked = m.status === 'revoked';
  return `<article class="card member ${revoked ? 'revoked' : ''}"><div class="person"><span class="avatar">${esc(initials(m.name))}</span><div><h3>${esc(m.name)}</h3><p>${esc(m.relationship)} ${revoked ? '· <span class="badge">Access removed</span>' : ''}</p></div></div><p class="label">${revoked ? 'NO CURRENT ACCESS' : 'YOU SHARE'}</p>${!revoked && m.categories.length ? `<div class="chips">${state.categories.filter(c => m.categories.includes(c.id)).map(c => `<span class="chip">${esc(c.label)}</span>`).join('')}</div>` : `<p class="nothing">${revoked ? 'Their access link no longer works.' : 'Nothing yet. You choose when to start.'}</p>`}<div class="member-footer">${revoked ? `<button class="button secondary small" data-restore="${m.id}">Restore member</button>` : `<button class="button secondary small" data-edit="${m.id}">Manage sharing</button><button class="text-button" data-invite="${m.id}">Access link ↗</button>`}</div></article>`;
}
function editMember(m) {
  const relationships = ['Daughter', 'Son', 'Partner', 'Spouse', 'Sibling', 'Parent', 'Grandchild', 'Friend', 'Carer', 'Other'];
  if (m && !relationships.includes(m.relationship)) relationships.push(m.relationship);
  const d = modal(`<form><header class="drawer-head"><div><h2 id="dialog-title">${m ? 'Manage sharing' : 'Add someone you trust'}</h2><p>${m ? 'Choose what ' + esc(m.name) + ' can see.' : 'Their access is separate from everyone else in your circle.'}</p></div><button type="button" class="close" aria-label="Close" data-close>×</button></header><div class="drawer-body"><label class="field">Full name<input name="name" required maxlength="100" autocomplete="name" value="${esc(m?.name || '')}"></label><div class="field-row"><label class="field">Relationship<select name="relationship" required><option value="">Choose relationship</option>${relationships.map(r => `<option ${r === m?.relationship ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label><label class="field">Email (optional)<input name="email" type="email" maxlength="254" autocomplete="email" value="${esc(m?.email || '')}"></label></div><div class="sharing-heading"><h3>What would you like to share?</h3><p>${m ? 'Save your changes to update their access and your GP record.' : 'Everything starts off. Turn on only what you want to share.'}</p></div>${state.categories.map(c => `<label class="scope"><span class="scope-text"><strong>${esc(c.label)}</strong><small>${esc(c.description)}</small></span><input type="checkbox" role="switch" name="category" value="${c.id}" aria-label="Share ${esc(c.label)}" ${m?.categories.includes(c.id) ? 'checked' : ''}></label>`).join('')}${m ? '<button type="button" class="remove" id="remove-access">Remove all access for this person</button>' : ''}<p class="form-error" role="alert"></p></div><footer class="drawer-foot"><small id="selected-count">${m?.categories.length || 0} of 5 categories selected</small><div><button type="button" class="button secondary" data-close>Cancel</button> <button type="submit" class="button">${m ? 'Save changes' : 'Add family member'}</button></div></footer></form>`, true);
  d.querySelector('select[name=relationship]').setAttribute('aria-label', 'Relationship');
  d.querySelectorAll('input[type=checkbox]').forEach(input => input.addEventListener('change', () => { d.querySelector('#selected-count').textContent = `${d.querySelectorAll('input:checked').length} of 5 categories selected`; }));
  d.querySelector('#remove-access')?.addEventListener('click', () => revoke(m, d));
  d.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault(); const f = new FormData(e.target); const submit = d.querySelector('[type=submit]'); submit.disabled = true; submit.textContent = 'Saving…';
    d.querySelector('.form-error').textContent = '';
    try {
      await request(m ? `/members/${m.id}` : '/members', m ? 'PUT' : 'POST', { name: f.get('name'), relationship: f.get('relationship'), email: f.get('email'), categories: f.getAll('category'), ...(m ? { expectedVersion: m.version } : {}) });
      d.close(); await load(true); notify('Saved. Your GP consent record is up to date.');
    } catch (error) { d.querySelector('.form-error').textContent = error.message; }
    finally { submit.disabled = false; submit.textContent = m ? 'Save changes' : 'Add family member'; }
  });
}
function revoke(m, editor) {
  const d = modal(`<h2 id="dialog-title">Remove ${esc(m.name)}'s access?</h2><p>They will no longer be able to open shared records. Their access link will stop working, and your GP will see the change.</p><p>This cannot erase information they have already seen or saved.</p><p class="form-error" role="alert"></p><div class="modal-actions"><button class="button secondary" data-close>Keep access</button><button class="button danger" id="confirm-remove">Remove access</button></div>`);
  d.querySelector('#confirm-remove').addEventListener('click', async e => { e.target.disabled = true; try { await request(`/members/${m.id}/revoke`, 'POST', { expectedVersion: m.version }); d.close(); editor.close(); await load(true); notify('Access removed and GP record updated.'); } catch (error) { d.querySelector('.form-error').textContent = error.message; e.target.disabled = false; } });
}
async function restore(m, button) {
  button.disabled = true;
  try { await request(`/members/${m.id}/restore`, 'POST', { expectedVersion: m.version }); await load(true); notify('Member restored. Nothing is shared yet.'); } catch (error) { notify(error.message); button.disabled = false; }
}
async function invitation(m, button) {
  const d = modal(`<h2 id="dialog-title">An access link for ${esc(m.name)}</h2><p>Create a private link to their family view. Anyone holding this link can see the categories you allow for ${esc(m.name)}.</p><p>A new link replaces any earlier link and closes their existing sessions. No email is sent.</p><p class="form-error" role="alert"></p><div class="modal-actions"><button class="button secondary" data-close>Cancel</button><button class="button" id="create-link">Create access link</button></div>`);
  d.querySelector('#create-link').addEventListener('click', async e => {
    e.target.disabled = true;
    try {
      const result = await request(`/members/${m.id}/invitation`, 'POST', { expectedVersion: m.version });
      await load(true);
      d.innerHTML = `<h2 id="dialog-title">Ready to share with ${esc(m.name)}.</h2><p>This private link opens only their permitted records. It expires in 30 days, or sooner if you remove access or replace it.</p><div class="link-box">${esc(result.invitationUrl)}</div><p>Copy it and send it privately to ${esc(m.name)}. No email has been sent.</p><div class="modal-actions"><button class="button secondary" id="done-link">Done</button><a class="button secondary" target="_blank" rel="noopener noreferrer" href="${esc(result.invitationUrl)}">Open family view ↗</a><button class="button" id="copy-link">Copy link</button></div>`;
      d.querySelector('#done-link').addEventListener('click', () => d.close());
      d.querySelector('#copy-link').addEventListener('click', async event => { try { await navigator.clipboard.writeText(result.invitationUrl); event.target.textContent = 'Copied'; } catch { event.target.textContent = 'Select and copy the link above'; } });
      d.querySelector('#copy-link').focus();
    } catch (error) { d.querySelector('.form-error').textContent = error.message; e.target.disabled = false; }
  });
}
function renderFamily() {
  root.innerHTML = `<main class="family-shell"><header class="family-top"><span class="wordmark">kindred<span>✳</span></span><span class="demo-tag">Family view · Local demo</span></header><div id="load-error"></div><div class="family-welcome"><div><p class="eyebrow">SHARED WITH YOU</p><h1>${esc(state.patient.name)}'s care,<br>a little closer.</h1><p class="lead">Hello ${esc(state.member.name.split(' ')[0])}. These are the records ${esc(state.patient.name.split(' ')[0])} has chosen to share with you.</p></div><button class="button secondary" id="refresh-family">↻ Refresh</button></div><section class="sync-card"><div class="sync-copy"><span class="sync-icon" aria-hidden="true">✓</span><div><strong>You're seeing ${state.categories.length} of 5 categories</strong><p>Permissions updated ${esc(date(state.updatedAt, true))} · Revision ${state.revision}</p></div></div><span data-live><span class="dot"></span>Live connection</span></section><div class="chips">${state.categories.map(c => `<span class="chip">${esc(c.label)}</span>`).join('')}</div>${state.categories.length ? state.categories.map(c => {
    const records = state.records.filter(r => r.category === c.id);
    return `<section class="family-section"><h2>${esc(c.label)} <span class="count">${records.length}</span></h2><div class="card">${records.length ? records.slice(0, 15).map(recordCard).join('') + (records.length > 15 ? `<details><summary class="record">Show ${records.length - 15} older records</summary>${records.slice(15).map(recordCard).join('')}</details>` : '') : '<p class="blank-audit">No recorded items in this category yet.</p>'}</div></section>`;
  }).join('') : '<div class="card empty"><div class="circle-art" aria-hidden="true"><span>♡</span></div><h3>A place in their circle.</h3><p>No health information is shared with you yet. The patient can change this whenever they choose.</p></div>'}<p class="footer-note">Read-only access · Other family members and unshared categories are not shown.<br>Synthetic records from the local simulation.</p></main>`;
  document.querySelector('#refresh-family').addEventListener('click', () => load(true));
}
function recordCard(r) { return `<article class="record"><div class="record-head"><strong>${esc(r.title)}</strong><time>${esc(date(r.date))}</time></div>${r.details.map(d => `<p>${esc(d)}</p>`).join('')}<small>${esc(r.status)}</small></article>`; }
function fatal(error) {
  state = null; stream?.close(); document.querySelectorAll('dialog').forEach(d => d.close());
  root.innerHTML = `<main class="loading"><span class="wordmark">kindred<span>✳</span></span><h1 style="margin-top:45px;font-size:36px">${role === 'family' ? 'This view is no longer available.' : 'We couldn’t open your circle.'}</h1><p role="alert">${esc(error.message)}</p>${role === 'family' ? '<p>Ask the patient for a current access link.</p>' : '<button class="button" id="retry">Try again</button>'}</main>`;
  document.querySelector('#retry')?.addEventListener('click', init);
}
async function load(force = false) {
  try {
    const next = await request('/state');
    if (state && next.revision < state.revision) return;
    if (force || JSON.stringify(next) !== JSON.stringify(state)) { state = next; role === 'patient' ? renderPatient() : renderFamily(); }
    document.querySelector('#load-error').innerHTML = '';
  } catch (error) {
    if (!state || error.status === 401 || error.status === 403) return fatal(error);
    document.querySelector('#load-error').innerHTML = `<div class="error-banner" role="alert">Couldn't refresh. Showing previously loaded information. ${esc(error.message)} <button class="text-button" id="retry-load">Retry</button></div>`;
    document.querySelector('#retry-load').addEventListener('click', () => load(true));
  }
}
function connect() {
  stream?.close(); stream = new EventSource(api + '/events' + (role === 'patient' ? `?patientId=${encodeURIComponent(patientId)}` : ''));
  stream.addEventListener('change', () => load());
  stream.addEventListener('access-ended', () => fatal(new Error('This access link or session has been closed.')));
  stream.onopen = () => { const el = document.querySelector('[data-live]'); if (el) el.innerHTML = '<span class="dot"></span>Live connection'; load(); };
  stream.onerror = () => { const el = document.querySelector('[data-live]'); if (el) el.textContent = 'Reconnecting…'; };
}
async function init() {
  if (busy) return; busy = true;
  try {
    if (role === 'patient') await request('/session', 'POST', { patientId });
    else {
      const invitationToken = new URLSearchParams(location.hash.slice(1)).get('token');
      if (invitationToken) { await request('/session', 'POST', { invitationToken }); history.replaceState(null, '', location.pathname); }
      else await request('/session');
    }
    await load(true); if (state) connect();
  } catch (error) { fatal(error); }
  finally { busy = false; }
}
window.addEventListener('pagehide', () => stream?.close());
window.addEventListener('pageshow', e => { if (e.persisted && state) { load(true); connect(); } });
window.addEventListener('focus', () => { if (state) load(); });
setInterval(() => { if (state && document.visibilityState === 'visible') load(); }, 15000);
init();
