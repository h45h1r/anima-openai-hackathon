const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label = value => String(value ?? '').replaceAll('-', ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
const date = value => value ? new Date(value).toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric', timeZone:'UTC'}) : '—';
const time = value => value ? new Date(value).toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit', timeZone:'UTC'}) : '—';
const site = value => ({gp:'GP Records', hospital:'Hospital EPR', diagnostics:'Diagnostics', pharmacy:'Pharmacy', community:'Community'}[value] || label(value));
const excluded = new Set(['ehr-record','device','capacity','stock','pharmacy-stock','supplier-quote','appointment-session']);
const documents = new Set(['hospital-note','clinical-note','consultation','encounter','document','discharge','discharge-summary','handover','referral']);

function narrative(record) {
  const data = record.data || {};
  const lines = [];
  const add = (heading, text) => { if (text !== undefined && text !== null && text !== '' && !lines.some(row => row[1] === text)) lines.push([heading, text]); };
  if (data.reason) add('Reason for contact', data.reason);
  const headings = {reason:'Reason for admission',course:'Hospital course',diagnoses:'Diagnoses',medicationChanges:'Medication changes',results:'Results and pending investigations',followUp:'Follow-up arrangements',gpActions:'Requested GP actions'};
  if (Array.isArray(data.sections)) data.sections.forEach(row => add(row.heading, row.text));
  else Object.entries(data.sections || {}).forEach(([key, value]) => add(record.kind === 'discharge-summary' ? headings[key] || label(key) : label(key), value));
  [['Consultation','text'],['Note','note'],['Summary','summary'],['Details','details'],['Outcome','outcome'],['Medication','drug'],['Dose','dose'],['Route','route'],['Frequency','frequency'],['Instructions','instructions']].forEach(([heading,key]) => add(heading,data[key]));
  if (data.value !== undefined) add(data.metric ? label(data.metric) : 'Recorded value', `${data.value} ${data.unit || data.units || ''}`.trim());
  return lines;
}

function attribution(record) {
  const created = record.provenance?.created;
  if (!created) return '<p class="record-attribution">Original author not recorded</p>';
  return `<p class="record-attribution">Created by ${escape(created.actor?.name || 'Unknown')} · ${escape(site(created.source || record.owner))} · ${date(created.time)} ${time(created.time)} UTC · v${escape(created.version || 1)}</p>`;
}

function heading(title, patient, detail = '') {
  return `<div class="ehr-section-heading"><h2>${escape(title)}<small>${escape(patient?.name || '')}${detail ? ` · ${escape(detail)}` : ''}</small></h2></div>`;
}

function table(headers, rows, empty = 'No entries recorded.') {
  return `<div class="records-table-scroll"><table class="ehr-table"><thead><tr>${headers.map(v=>`<th>${escape(v)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row=>`<tr>${row.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">${escape(empty)}</td></tr>`}</tbody></table></div>`;
}

function recordButton(record, text) {
  return `<button type="button" class="records-link" data-record="${escape(record.id)}">${escape(text || record.title)}</button>`;
}

function journal(root, rows, tab) {
  const records = rows.filter(row => !excluded.has(row.kind) && (tab !== 'documents' || documents.has(row.kind)) && (tab !== 'consultations' || ['encounter','consultation','clinical-note'].includes(row.kind)) && (tab !== 'tasks' || ['task','visit','appointment','prescription'].includes(row.kind)) && (tab !== 'care coordination' || ['visit','care-plan','handover','referral','discharge','discharge-summary','task'].includes(row.kind))).sort((a,b) => b.createdAt-a.createdAt);
  let limit=30;
  root.innerHTML=`<section class="clinical-journal journal-gp"><div class="journal-titlebar"><h2>${tab==='journal' || tab==='summary' ? 'Consultation record' : label(tab)}</h2><span>Newest at top · Simulation record</span></div><div class="journal-toolbar"><label>Display <select aria-label="Journal entry type"><option value="">All record types</option>${[...new Set(records.map(r=>r.kind))].sort().map(kind=>`<option value="${escape(kind)}">${escape(label(kind))}</option>`).join('')}</select></label><input type="search" aria-label="Filter clinical journal" placeholder="Search record text or author"><span data-count></span></div><div class="journal-contacts"></div><button type="button" class="journal-load-more" hidden></button></section>`;
  const list=root.querySelector('.journal-contacts'), more=root.querySelector('.journal-load-more');
  const draw=()=>{
    const kind=root.querySelector('select').value, query=root.querySelector('input').value.toLowerCase();
    const filtered=records.filter(row=>(!kind || row.kind===kind) && [row.title,row.owner,row.status,JSON.stringify(row.data),row.provenance?.created?.actor?.name].join(' ').toLowerCase().includes(query));
    root.querySelector('[data-count]').textContent=`${filtered.length} entries`;
    let previous='';
    list.innerHTML=filtered.slice(0,limit).map(record=>{
      const day=date(record.createdAt), newDay=day!==previous; previous=day;
      const lines=narrative(record), data=record.data || {};
      return `${newDay?`<h3 class="journal-date-heading">${day}</h3>`:''}<article class="journal-contact"><header><time>${time(record.createdAt)} UTC</time><div><h4>${escape(record.title)}</h4><span>${escape([data.author || data.clinician,data.channel || data.mode,site(record.owner),label(record.kind),record.status].filter(Boolean).join(' · '))}</span></div></header>${lines.length?`<dl class="journal-narrative">${lines.map(([head,value])=>`<div><dt>${escape(head)}</dt><dd>${escape(typeof value==='object'?JSON.stringify(value):value)}</dd></div>`).join('')}</dl>`:`<p class="journal-no-body">${escape(record.title)}</p>`}${attribution(record)}<details class="journal-entry-details"><summary>Record details and activity</summary><p>Patient ${escape(record.patientId)} · ${escape(record.id)} · ${escape(record.status)} · v${escape(record.version)}</p><p>Visible to: ${escape((record.visibleTo || []).join(', '))}</p>${recordButton(record,'View record and sharing context')}</details></article>`;
    }).join('') || '<p class="journal-no-body">No entries match this view.</p>';
    more.hidden=filtered.length<=limit; more.textContent=`Show 30 older entries (${Math.max(0,filtered.length-limit)} remaining)`;
  };
  root.querySelector('input').addEventListener('input',()=>{limit=30;draw();});
  root.querySelector('select').addEventListener('change',()=>{limit=30;draw();});
  more.addEventListener('click',()=>{limit+=30;draw();}); draw();
}

function problems(root, patient, rows, ehr) {
  const overrides=rows.filter(r=>r.kind==='problem');
  const replaced=new Set(overrides.map(r=>r.data?.sourceProblemKey));
  const items=(ehr?.data?.problems || []).map((p,i)=>({...p,key:`${ehr.id}:${i}`})).filter(p=>!replaced.has(p.key));
  const existing=new Set([...items.map(p=>p.term),...overrides.map(r=>r.title)].map(t=>t.toLowerCase()));
  for(const term of patient?.conditions || []) if(!existing.has(term.toLowerCase())) items.push({term,status:'active'});
  items.push(...overrides.map(r=>({term:r.title,code:r.data?.code,date:r.data?.onsetDate,status:r.status,record:r})));
  let status='all';
  root.innerHTML=heading('Problems',patient,`${items.filter(p=>!['resolved','inactive'].includes(p.status)).length} active`)+`<div class="records-filters"><label>Show <select aria-label="Problem status"><option value="all">All problems</option><option value="active">Active</option><option value="resolved">Resolved</option></select></label><span>Read-only simulator record</span></div><div data-table></div>`;
  const draw=()=>{const filtered=items.filter(p=>status==='all'||(status==='resolved'?['resolved','inactive'].includes(p.status):!['resolved','inactive'].includes(p.status)));root.querySelector('[data-table]').innerHTML=table(['Problem','Code','Onset date','Status'],filtered.map(p=>[p.record?recordButton(p.record,p.term):escape(p.term),escape(p.code||'—'),date(p.date),`<span class="records-status">${escape(p.status || 'active')}</span>`]));};
  root.querySelector('select').onchange=e=>{status=e.target.value;draw();}; draw();
}

function allergies(root, patient, rows, ehr) {
  const overrides=rows.filter(r=>r.kind==='allergy');
  const replaced=new Set(overrides.map(r=>r.data?.sourceAllergyKey));
  const items=(ehr?.data?.allergies || []).map((a,i)=>({...a,key:a.key||`${ehr.id}:${i}`})).filter(a=>!replaced.has(a.key));
  items.push(...overrides.map(r=>({term:r.title,reaction:r.data?.reaction,status:r.status,record:r})));
  root.innerHTML=heading('Allergies',patient,'Recorded allergies and reactions')+table(['Allergy / substance','Reaction','Status'],items.map(a=>[a.record?recordButton(a.record,a.term):escape(a.term),escape(a.reaction||'—'),escape(a.status||'active')]),'No active allergies recorded.');
}

function medications(root,patient,rows,ehr) {
  const prescriptions=rows.filter(r=>r.kind==='prescription');
  const items=ehr?.data?.medications || [];
  root.innerHTML=heading('Medication',patient)+`<h3 class="records-subheading">Prescription requests</h3>`+table(['Medication','Status','Date'],prescriptions.map(r=>[recordButton(r),escape(r.status),date(r.createdAt)]),'No prescription requests recorded.')+`<h3 class="records-subheading">Medication history</h3>`+table(['Medication','Issued','Details','Status'],items.map(m=>[escape(m.term||m.drug),date(m.issueDate),escape([m.indication,m.route,m.frequency,m.dose].filter(Boolean).join(' · ')||'—'),m.current?'Current':'Historical']),'No medications recorded.');
}

function results(root,patient,rows) {
  const reports=rows.filter(r=>Array.isArray(r.data?.analytes)&&r.data?.panel).sort((a,b)=>b.data.collectedAt-a.data.collectedAt);
  const groups=new Map();
  for(const report of reports) for(const analyte of report.data.analytes){const key=`${report.data.panel.id}:${analyte.id}`;if(!groups.has(key))groups.set(key,{panel:report.data.panel,points:[]});groups.get(key).points.push({...analyte,time:report.data.collectedAt,record:report});}
  const panels=[...new Map(reports.map(r=>[r.data.panel.id,r.data.panel.name])).entries()];
  root.innerHTML=heading('Blood test results',patient,'Synthetic laboratory history')+`<div class="results-browser"><nav class="blood-panels" aria-label="Blood test panels"><button type="button" data-panel="all" aria-pressed="true">All panels</button>${panels.map(([id,name])=>`<button type="button" data-panel="${escape(id)}" aria-pressed="false">${escape(name)}</button>`).join('')}</nav><div class="results-values"><p class="blood-hint">Reference intervals and values are fictional simulation data.</p><div data-results></div><div data-history></div></div></div>`;
  const draw=panel=>{root.querySelectorAll('[data-panel]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.panel===panel)));root.querySelector('[data-results]').innerHTML=table(['Test / panel','Latest result','Reference interval','Sample date','Previous result','History'],[...groups.entries()].filter(([,g])=>panel==='all'||g.panel.id===panel).map(([key,g])=>{const [v,p]=g.points;const hasValue=typeof v.value==='number' && Number.isFinite(v.value);const flag=hasValue&&typeof v.referenceLow==='number'&&v.value<v.referenceLow?'Low':hasValue&&typeof v.referenceHigh==='number'&&v.value>v.referenceHigh?'High':'';return [`<strong>${escape(v.name)}</strong><small>${escape(g.panel.name)}</small>`,`${v.value===null||v.value===undefined?'Not available':escape(v.value)} ${escape(v.unit)} ${flag?`<span class="blood-flag">${flag}</span>`:''}`,`${escape(v.referenceLow)}–${escape(v.referenceHigh)} ${escape(v.unit)}`,date(v.time),p?`${p.value===null||p.value===undefined?'Not available':escape(p.value)} ${escape(p.unit)}<small>${date(p.time)}</small>`:'No previous result',`<button type="button" data-history-key="${escape(key)}">View history</button>`];}),'No blood test results are available for this patient.');};
  root.addEventListener('click',e=>{const panel=e.target.closest('[data-panel]');if(panel)draw(panel.dataset.panel);const history=e.target.closest('[data-history-key]');if(history){const g=groups.get(history.dataset.historyKey);root.querySelector('[data-history]').innerHTML=`<h3 class="records-subheading">${escape(g.points[0].name)} · history</h3>`+table(['Sample date','Result','Reference interval','Source'],g.points.map(p=>[date(p.time),`${p.value===null||p.value===undefined?'Not available':escape(p.value)} ${escape(p.unit)}`,`${escape(p.referenceLow)}–${escape(p.referenceHigh)}`,recordButton(p.record,'View report')]));}});
  draw('all');
}

export function renderRecords({patient, resources=[], tab='Journal', onRecordSelect}={}) {
  const root=document.createElement('div'); root.className='records-screen';
  const rows=resources.filter(r=>r.patientId===patient?.id);
  const ehr=rows.find(r=>r.kind==='ehr-record');
  const current=tab.toLowerCase();
  if(!patient){root.innerHTML='<p class="journal-no-body">Select a patient to open their record.</p>';return root;}
  if(current==='problems')problems(root,patient,rows,ehr);
  else if(current==='allergies')allergies(root,patient,rows,ehr);
  else if(current==='medication')medications(root,patient,rows,ehr);
  else if(current==='results')results(root,patient,rows);
  else if(current==='coded history')root.innerHTML=heading('Coded history',patient)+table(['Code','Term'],(ehr?.data?.miscCodes || []).map(c=>[escape(c.code),escape(c.term)]));
  else journal(root,rows,current);
  root.addEventListener('click',event=>{const button=event.target.closest('[data-record]');if(button&&onRecordSelect){const record=rows.find(r=>r.id===button.dataset.record);if(record)onRecordSelect(record);}});
  return root;
}
