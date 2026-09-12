const MINUTE = 60_000;
const DAY = 86_400_000;
const dayKey = value => new Date(value).toISOString().slice(0, 10);
const time = value => new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, action, className, label) {
  const node = el('button', className, text);
  node.type = 'button';
  if (action) node.addEventListener('click', action);
  if (label) node.setAttribute('aria-label', label);
  return node;
}

function disabledButton(text) {
  const node = button(text);
  node.disabled = true;
  node.title = 'Read-only preview. This action is not connected.';
  return node;
}

/** Original GP appointment layout, populated with the simulator's day response. */
export function renderAppointments({ appointments = [], sessions = [], patients = [], onRecordSelect, date, onDateChange, now }) {
  const root = el('section', 'gp-appointment-book appt-book');
  root.setAttribute('aria-label', 'Appointment book');
  const names = new Map(patients.map(patient => [patient.id, patient.name]));
  const validSessions = sessions.filter(session => Number.isFinite(session.data?.startsAt) && Number.isFinite(session.data?.endsAt) && session.data.slotMinutes > 0).sort((a, b) => a.data.startsAt - b.data.startsAt);
  const initialDay = date || dayKey(now ?? validSessions[0]?.data.startsAt ?? appointments[0]?.data?.startsAt ?? Date.now());
  let selectedDay = initialDay;
  let clinician = '';
  let period = 'all';
  let overlay;

  function changeDay(next) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || !Number.isFinite(Date.parse(next))) return;
    selectedDay = next;
    draw();
    onDateChange?.(next);
  }

  function appointmentAt(session, start) {
    return appointments.find(appointment => !['cancelled', 'rejected'].includes(appointment.status) && appointment.data?.clinician === session.data.clinician && Number(appointment.data.startsAt) < start + session.data.slotMinutes * MINUTE && Number(appointment.data.startsAt) + Number(appointment.data.durationMinutes) * MINUTE > start);
  }

  function openSlot(session, start, appointment, blocked, trigger) {
    overlay?.remove();
    overlay = el('div', 'appt-overlay');
    const dialog = el('section', 'appt-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Appointment slot');
    const close = () => { overlay.remove(); overlay = undefined; trigger?.focus(); };
    overlay.addEventListener('click', close);
    dialog.addEventListener('click', event => event.stopPropagation());
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') close();
      if (event.key === 'Tab') {
        const focusable = [...dialog.querySelectorAll('button:not(:disabled),summary')];
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    const closeButton = button('×', close, 'appt-close', 'Close appointment panel');
    dialog.append(closeButton, el('h2', '', `${time(start)} · ${session.data.clinician}`), el('p', '', `${session.title} · ${session.data.location} · ${session.data.slotMinutes} minutes`));
    if (appointment) {
      dialog.append(el('h3', '', names.get(appointment.patientId) || appointment.patientId || 'Patient not supplied'), el('p', '', appointment.title), el('p', '', `Status: ${appointment.status}`));
      const info = el('dl');
      for (const [label, value] of [['Patient ID', appointment.patientId], ['Appointment ID', appointment.id], ['Start (UTC)', `${dayKey(appointment.data.startsAt)} ${time(appointment.data.startsAt)}`], ['Duration', `${appointment.data.durationMinutes} minutes`], ['Mode', appointment.data.mode], ['Version', appointment.version]]) {
        info.append(el('dt', '', label), el('dd', '', String(value ?? 'Not supplied')));
      }
      dialog.append(info);
      const provenance = appointment.provenance;
      if (provenance) {
        const details = el('details');
        details.append(el('summary', '', 'Record history'));
        const created = provenance.created;
        if (created) details.append(el('p', '', `Created ${dayKey(created.time)} ${time(created.time)} UTC · ${created.actor?.name || created.actor?.kind || 'Unknown actor'} · ${created.action}`));
        for (const change of provenance.changes || []) details.append(el('p', '', `${dayKey(change.time)} ${time(change.time)} UTC · ${change.actor?.name || change.actor?.kind || 'Unknown actor'} · ${change.action}`));
        dialog.append(details);
      }
      const actions = el('div', 'appt-dialog-actions');
      const recordButton = button('Open patient record', () => { close(); onRecordSelect?.(appointment); });
      recordButton.disabled = !appointment.patientId || !onRecordSelect;
      actions.append(recordButton);
      if (appointment.status === 'booked') actions.append(disabledButton('Arrive'));
      if (['booked', 'arrived'].includes(appointment.status)) actions.append(disabledButton('Complete'), disabledButton('Cancel appointment'));
      dialog.append(actions);
    } else if (blocked) {
      dialog.append(el('h3', '', 'Blocked slot'), el('p', '', blocked.reason), disabledButton('Unblock slot'));
    } else {
      dialog.append(el('h3', '', 'Available slot'), el('p', '', `${session.data.mode} · ${session.data.slotMinutes} minutes`), disabledButton('Book appointment'), disabledButton('Block slot'));
    }
    dialog.append(el('p', 'appt-readonly', 'Read-only preview. Booking and appointment changes are not connected.'));
    overlay.append(dialog);
    root.append(overlay);
    closeButton.focus();
  }

  function draw() {
    root.replaceChildren();
    const daySessions = validSessions.filter(session => dayKey(session.data.startsAt) === selectedDay);
    const dayAppointments = appointments.filter(appointment => Number.isFinite(Number(appointment.data?.startsAt)) && dayKey(Number(appointment.data.startsAt)) === selectedDay);
    const visible = daySessions.filter(session => (!clinician || session.data.clinician === clinician) && (period === 'all' || (period === 'am' ? time(session.data.startsAt) < '12:00' : time(session.data.startsAt) >= '12:00')));
    const ribbon = el('header', 'appt-ribbon');
    const heading = el('div');
    heading.append(el('h2', '', 'Appointment book'), el('span', '', 'Riverside Practice · Session diary · UTC'));
    const refresh = button('↻ Refresh', () => onDateChange?.(selectedDay));
    refresh.disabled = !onDateChange;
    ribbon.append(heading, disabledButton('＋ Create session'), refresh);
    const periods = el('div', 'appt-period');
    periods.setAttribute('aria-label', 'Session period');
    for (const [value, label] of [['all', 'All day'], ['am', 'AM only'], ['pm', 'PM only']]) {
      const item = button(label, () => { period = value; draw(); });
      item.setAttribute('aria-pressed', String(period === value));
      periods.append(item);
    }
    ribbon.append(periods);
    const layout = el('div', 'appt-layout');
    const sidebar = el('aside', 'appt-date-panel');
    sidebar.setAttribute('aria-label', 'Appointment date navigation');
    const dayControls = el('div', 'appt-day-controls');
    dayControls.append(button('◀', () => changeDay(dayKey(Date.parse(selectedDay) - DAY)), '', 'Previous day'), el('strong', '', new Date(`${selectedDay}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })), button('▶', () => changeDay(dayKey(Date.parse(selectedDay) + DAY)), '', 'Next day'));
    sidebar.append(dayControls);
    const dateLabel = el('label', '', 'Book date');
    const dateInput = el('input');
    dateInput.type = 'date';
    dateInput.value = selectedDay;
    dateInput.addEventListener('change', () => changeDay(dateInput.value));
    dateLabel.append(dateInput);
    sidebar.append(dateLabel);
    const calendar = el('div', 'appt-calendar');
    calendar.setAttribute('aria-label', 'Choose a day');
    for (const label of ['M', 'T', 'W', 'T', 'F', 'S', 'S']) calendar.append(el('b', '', label));
    const monthStart = new Date(`${selectedDay.slice(0, 7)}-01T00:00:00Z`);
    const calendarStart = monthStart.getTime() - ((monthStart.getUTCDay() + 6) % 7) * DAY;
    for (let index = 0; index < 42; index++) {
      const day = dayKey(calendarStart + index * DAY);
      const item = button(String(Number(day.slice(-2))), () => changeDay(day), day.slice(0, 7) === selectedDay.slice(0, 7) ? '' : 'outside', day);
      item.setAttribute('aria-pressed', String(day === selectedDay));
      calendar.append(item);
    }
    sidebar.append(calendar, button('Today', () => changeDay(now ? dayKey(now) : initialDay), 'appt-today'));
    const clinicianLabel = el('label', '', 'Clinician filter');
    const select = el('select');
    const all = el('option', '', 'All clinicians');
    all.value = '';
    select.append(all);
    for (const name of new Set(daySessions.map(session => session.data.clinician))) {
      const option = el('option', '', name);
      option.value = name;
      select.append(option);
    }
    select.value = clinician;
    select.addEventListener('change', () => { clinician = select.value; draw(); });
    clinicianLabel.append(select);
    sidebar.append(clinicianLabel);
    const legend = el('div', 'appt-legend');
    for (const [state, label] of [['free', 'Available'], ['booked', 'Booked'], ['arrived', 'Arrived'], ['blocked', 'Blocked'], ['completed', 'Completed']]) {
      const item = el('span');
      item.append(el('i', state), document.createTextNode(label));
      legend.append(item);
    }
    sidebar.append(legend, el('p', '', `${visible.length} sessions · ${dayAppointments.filter(appointment => !['cancelled', 'rejected'].includes(appointment.status)).length} appointments`), el('p', 'appt-readonly', 'Read-only preview'));
    const diary = el('div', 'appt-diary');
    const columns = el('div', 'appt-columns');
    for (const name of new Set(visible.map(session => session.data.clinician))) {
      const column = el('section', 'appt-clinician');
      column.setAttribute('aria-label', `${name} sessions`);
      column.append(el('h3', '', name));
      for (const session of visible.filter(item => item.data.clinician === name)) {
        const block = el('section', 'appt-session');
        block.setAttribute('aria-label', session.title);
        const header = el('header');
        header.append(el('strong', '', session.title), el('span', '', `${time(session.data.startsAt)}–${time(session.data.endsAt)} · ${session.data.location}`), el('small', '', `${session.data.slotMinutes} min · ${session.data.mode}`));
        const tableHeader = el('div', 'appt-slot-head');
        tableHeader.append(el('span', '', 'Time'), el('span', '', 'Patient / slot description'));
        block.append(header, tableHeader);
        const slotDuration = session.data.slotMinutes * MINUTE;
        for (let start = session.data.startsAt; start + slotDuration <= session.data.endsAt; start += slotDuration) {
          const appointment = appointmentAt(session, start);
          const blocked = session.data.blockedSlots?.find(slot => slot.startsAt === start);
          const status = appointment?.status || (blocked ? 'blocked' : 'free');
          const label = appointment ? names.get(appointment.patientId) || appointment.patientId || 'Patient not supplied' : blocked?.reason || 'Available';
          const slot = button('', () => openSlot(session, start, appointment, blocked, slot), `appt-slot appt-slot-${status}`, `${name} ${time(start)} ${label}`);
          const description = el('span');
          description.append(el('strong', '', label));
          if (appointment) description.append(el('small', '', `${Number(appointment.data.startsAt) < start ? 'Continued · ' : ''}${appointment.title}`));
          slot.append(el('time', '', time(start)), description, el('em', '', status === 'free' ? '' : status));
          block.append(slot);
        }
        column.append(block);
      }
      columns.append(column);
    }
    if (visible.length) diary.append(columns);
    else {
      const empty = el('div', 'appt-empty');
      empty.append(el('h3', '', 'No sessions for this selection'), el('p', '', 'Choose another date or clinician.'));
      diary.append(empty);
    }
    const outside = dayAppointments.filter(appointment => !daySessions.some(session => appointment.data.clinician === session.data.clinician && Number(appointment.data.startsAt) >= session.data.startsAt && Number(appointment.data.startsAt) < session.data.endsAt));
    if (outside.length) {
      const details = el('details', 'appt-unallocated');
      details.append(el('summary', '', `${outside.length} appointments outside session hours`));
      for (const appointment of outside) {
        const row = el('p');
        const patient = button(names.get(appointment.patientId) || appointment.patientId || 'Patient not supplied', () => onRecordSelect?.(appointment));
        patient.disabled = !onRecordSelect || !appointment.patientId;
        row.append(document.createTextNode(`${time(Number(appointment.data.startsAt))} · ${appointment.data.clinician} · `), patient, document.createTextNode(` · ${appointment.title} · ${appointment.status}`));
        details.append(row);
      }
      diary.append(details);
    }
    layout.append(sidebar, diary);
    root.append(ribbon, layout);
  }

  draw();
  return root;
}
