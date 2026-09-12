export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

export function button(text, action, className = '') {
  const node = el('button', className, text);
  node.type = 'button';
  if (action) node.addEventListener('click', action);
  return node;
}

export function date(value) {
  if (!value) return 'Time not recorded';
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  });
}

export function patientLabel(patient, record) {
  return patient && (patient.id === record.patientId || patient.patientId === record.patientId)
    ? patient.name || patient.displayName || record.patientId
    : record.patientId || 'Practice';
}

export function patientResources(resources, patient) {
  const records = Array.isArray(resources) ? resources : resources?.resources || [];
  const id = typeof patient === 'string' ? patient : patient?.id || patient?.patientId;
  return records.filter(record => !id || !record.patientId || record.patientId === id);
}

export function loadStyles() {
  if (document.querySelector('link[data-correspondence-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./documents-messages.css', import.meta.url).href;
  link.dataset.correspondenceStyles = 'true';
  document.head.append(link);
}

export function inspectButton(record, onRecordSelect, className = '') {
  return button('View access & source record', () => onRecordSelect?.(record), className);
}
