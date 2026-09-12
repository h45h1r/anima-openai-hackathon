import { el, button, date, patientLabel, patientResources, loadStyles, inspectButton } from './correspondence-ui.js';

export function renderMessages({ resources = [], patient, onRecordSelect } = {}) {
  loadStyles();
  const records = patientResources(resources, patient);
  const conversations = records.filter(r => r.kind === 'conversation').sort((a, b) => (b.data?.entries?.at(-1)?.at || b.createdAt) - (a.data?.entries?.at(-1)?.at || a.createdAt));
  const templates = records.filter(r => r.kind === 'message-template' && r.status === 'active');
  const root = el('section', 'messaging-workspace'); root.setAttribute('aria-label', 'Messagey messaging');
  const header = el('header', 'messaging-header');
  const brand = el('div'); brand.append(el('strong', '', 'Messagey'), el('small', '', 'Riverside Practice · patient conversations'));
  header.append(brand, el('span', 'record-view-notice', 'Read-only preview'));
  const toolbar = el('div', 'messaging-toolbar');
  const folders = el('nav'); folders.setAttribute('aria-label', 'Messaging folders');
  const compose = button('＋ New message'); compose.disabled = true; compose.title = 'Sending is disabled in this read-only preview';
  toolbar.append(folders, compose);
  const content = el('div'); root.append(header, toolbar, content);
  let folder = 'inbox'; let selected; let query = '';
  const tabs = new Map();
  for (const [key, title] of [['inbox', `Inbox (${conversations.filter(r => r.status === 'open').length})`], ['done', 'Done'], ['templates', 'Templates']]) {
    const tab = button(title, () => { folder = key; selected = undefined; draw(); }); folders.append(tab); tabs.set(key, tab);
  }

  function draw() {
    for (const [key, tab] of tabs) tab.setAttribute('aria-pressed', String(folder === key));
    if (folder === 'templates') { drawTemplates(); return; }
    const columns = el('div', 'messaging-columns');
    const inbox = el('aside', 'messaging-inbox');
    const searchLabel = el('label', '', 'Search conversations');
    const search = el('input'); search.type = 'search'; search.placeholder = 'Patient or subject'; search.value = query;
    searchLabel.append(search); inbox.append(searchLabel);
    const list = el('div'); inbox.append(list);
    const thread = el('main', 'messaging-thread');
    columns.append(inbox, thread); content.replaceChildren(columns);
    function drawList() {
      const filtered = conversations.filter(r => r.status === (folder === 'done' ? 'done' : 'open') && `${r.title} ${r.patientId} ${patientLabel(patient, r)}`.toLowerCase().includes(query.toLowerCase()));
      const record = filtered.find(r => r.id === selected) || filtered[0];
      list.replaceChildren();
      for (const item of filtered) {
        const entry = item.data?.entries?.at(-1);
        const row = button('', () => { selected = item.id; drawList(); }, item.id === record?.id ? 'selected' : '');
        row.classList.add('message-list-row');
        const rowHead = el('span', 'messaging-row-heading'); rowHead.append(el('strong', '', patientLabel(patient, item)), el('small', '', date(entry?.at || item.createdAt)));
        row.append(rowHead, el('b', '', item.title), el('span', '', entry?.body || 'No message text returned'), el('small', '', item.status === 'done' ? 'Completed' : item.data?.assignee || 'Unassigned'));
        list.append(row);
      }
      if (!filtered.length) list.append(el('p', 'record-screen-empty', 'No conversations here yet.'));
      drawThread(thread, record);
    }
    search.addEventListener('input', () => { query = search.value; selected = undefined; drawList(); });
    drawList();
  }

  function drawThread(thread, record) {
    thread.replaceChildren();
    if (!record) { thread.append(el('p', 'messaging-empty', 'Choose a conversation to read its messages.')); return; }
    const data = record.data || {};
    const head = el('header', 'messaging-thread-header');
    const title = el('div'); title.append(el('small', '', patientLabel(patient, record)), el('h1', '', record.title), el('span', '', `${record.status === 'done' ? 'Conversation completed' : 'Open conversation'} · ${data.allowReply ? 'Replies enabled' : 'One-way message'}`));
    head.append(title, inspectButton(record, onRecordSelect));
    const context = el('details', 'messaging-context'); context.append(el('summary', '', 'Patient & assignment'), el('p', '', `${patientLabel(patient, record)} · ${record.patientId}`), el('p', '', `Assigned to ${data.assignee || 'Unassigned'}`));
    const timeline = el('div', 'messaging-timeline');
    for (const entry of data.entries || []) {
      const bubble = el('article', `messaging-bubble messaging-${entry.direction}`);
      const entryHead = el('div');
      const actor = entry.direction === 'internal' ? 'Internal note' : entry.direction === 'incoming' ? patientLabel(patient, record) : entry.actor?.name || 'Practice';
      entryHead.append(el('strong', '', actor), el('small', '', `${date(entry.at)} UTC · ${entry.direction === 'internal' ? 'Practice only' : (entry.channel || '').toUpperCase()}`));
      bubble.append(entryHead, el('p', '', entry.body));
      if (entry.direction === 'outgoing') {
        const status = entry.delivery?.at(-1)?.status || 'No delivery status';
        bubble.append(el('span', `messaging-delivery messaging-${status}`, `${status} · attempt ${(entry.delivery || []).filter(d => d.status === 'queued').length}`));
      }
      timeline.append(bubble);
    }
    if (!data.entries?.length) timeline.append(el('p', '', 'No message entries returned.'));
    const composer = el('div', 'messaging-composer');
    composer.append(el('p', 'record-view-notice', 'Messages and internal notes can be read here. Sending is disabled in this preview.'));
    const send = button('Queue message', null, 'messaging-primary'); send.disabled = true; composer.append(send);
    const delivery = el('details', 'messaging-simulator'); delivery.append(el('summary', '', 'Delivery history'));
    for (const entry of data.entries || []) {
      if (entry.direction !== 'outgoing') continue;
      const history = el('div', 'messaging-sim-row');
      for (const item of entry.delivery || []) history.append(el('p', '', `${date(item.at)} UTC · ${item.status} · ${item.actor?.name || 'Unknown author'}`));
      delivery.append(history);
    }
    thread.append(head, context, timeline, composer, delivery);
  }

  function drawTemplates() {
    const columns = el('div', 'messaging-templates');
    const list = el('aside'); list.append(el('h2', '', 'Practice templates'));
    const detail = el('article', 'messaging-template-detail');
    function selectTemplate(record) {
      selected = record.id;
      for (const row of list.querySelectorAll('button')) row.setAttribute('aria-pressed', String(row.dataset.recordId === selected));
      detail.replaceChildren(el('small', '', (record.data?.channel || '').toUpperCase()), el('h2', '', record.title), el('p', '', record.data?.body || 'No template text returned'), inspectButton(record, onRecordSelect));
    }
    for (const record of templates) {
      const row = button(record.title, () => selectTemplate(record)); row.dataset.recordId = record.id; list.append(row);
    }
    if (templates.length) selectTemplate(templates.find(r => r.id === selected) || templates[0]);
    else detail.append(el('p', '', 'No active templates returned.'));
    columns.append(list, detail); content.replaceChildren(columns);
  }
  draw();
  return root;
}
