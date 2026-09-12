import type {
  AnimaResource,
  ClinicalContext,
  InformationClass,
  Measurement,
  NormalisedEvent,
} from '../types/domain.js';

const LAB_KIND_RE = /lab|result|blood|panel|patholog|observation|analyte/i;
const APPT_KIND_RE = /appoint|booking|slot|session/i;
const DOC_KIND_RE = /document|discharge|handover|letter|note|consult|summary|inbox/i;
const TASK_KIND_RE = /task|follow.?up|action/i;
const MED_KIND_RE = /medicat|prescri|pharmacy|dispens/i;
const MSG_KIND_RE = /message|sms|email|conversation/i;
const PRIVATE_KIND_RE = /private|sensitive|restricted/i;

export function mapKindToClasses(kind: string, title = ''): InformationClass[] {
  const hay = `${kind} ${title}`;
  const classes = new Set<InformationClass>();
  if (LAB_KIND_RE.test(hay)) classes.add('laboratory_results');
  if (APPT_KIND_RE.test(hay)) classes.add('appointments');
  if (DOC_KIND_RE.test(hay)) classes.add('clinical_documents');
  if (TASK_KIND_RE.test(hay)) classes.add('tasks');
  if (MED_KIND_RE.test(hay)) classes.add('medications');
  if (MSG_KIND_RE.test(hay)) classes.add('logistics');
  if (PRIVATE_KIND_RE.test(hay)) classes.add('private_notes');
  if (/symptom|complaint/i.test(hay)) classes.add('symptoms');
  if (/treatment|plan|care.?plan/i.test(hay)) classes.add('treatment_summary');
  if (classes.size === 0) classes.add('private_notes'); // unknown → restricted until mapped
  return [...classes];
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v;
  if (typeof v === 'number') return String(v);
  return undefined;
}

function toIsoDate(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Heuristic: ms vs days
    const ms = v > 1e12 ? v : v > 1e9 ? v * 1000 : undefined;
    if (ms) return new Date(ms).toISOString();
  }
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
    return v;
  }
  return undefined;
}

function pickPanelId(resource: AnimaResource, data: Record<string, unknown>): string {
  return (
    asString(data.panelId) ||
    asString(data.panel) ||
    asString(data.code) ||
    resource.kind ||
    'panel'
  ).toLowerCase().replace(/\s+/g, '-');
}

/** Defensive extraction of numeric result history from Anima resource payloads. */
export function extractMeasurements(
  resource: AnimaResource,
  patientId: string,
  service: string,
): Measurement[] {
  const data = resource.data || {};
  const out: Measurement[] = [];
  const panelId = pickPanelId(resource, data);

  const push = (partial: {
    analyteId: string;
    displayName: string;
    value: number;
    unit: string;
    sampledAt: string;
    referenceLow?: number;
    referenceHigh?: number;
    referenceLabel?: string;
  }) => {
    out.push({
      evidenceId: `${resource.id}:${partial.analyteId}:${partial.sampledAt}`,
      resourceId: resource.id,
      patientId,
      panelId,
      analyteId: partial.analyteId,
      displayName: partial.displayName,
      value: partial.value,
      unit: partial.unit,
      sampledAt: partial.sampledAt,
      referenceLow: partial.referenceLow,
      referenceHigh: partial.referenceHigh,
      referenceLabel: partial.referenceLabel || 'Illustrative simulator interval',
      service,
      sourceVersion: resource.version,
      informationClass: 'laboratory_results',
    });
  };

  // Shape A: data.results / data.analytes / data.measurements arrays of {name,value,unit,date,...}
  const arrays = [data.results, data.analytes, data.measurements, data.values, data.tests, data.items];
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const row of arr) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const value = asNumber(r.value ?? r.result ?? r.latest ?? r.numericValue);
      const unit = asString(r.unit ?? r.units) || '';
      const name = asString(r.name ?? r.analyte ?? r.displayName ?? r.test ?? r.code) || 'Result';
      const sampledAt =
        toIsoDate(r.sampledAt ?? r.sampleDate ?? r.date ?? r.observedAt ?? r.collectedAt ?? resource.createdAt) ||
        new Date(resource.createdAt).toISOString();
      if (value === undefined) continue;
      // Nested history
      if (Array.isArray(r.history)) {
        for (const h of r.history) {
          if (!h || typeof h !== 'object') continue;
          const hr = h as Record<string, unknown>;
          const hv = asNumber(hr.value ?? hr.result);
          if (hv === undefined) continue;
          push({
            analyteId: (asString(r.code) || name).toLowerCase().replace(/\s+/g, '-'),
            displayName: name,
            value: hv,
            unit: asString(hr.unit) || unit,
            sampledAt:
              toIsoDate(hr.sampledAt ?? hr.date ?? hr.sampleDate) || sampledAt,
            referenceLow: asNumber(hr.referenceLow ?? hr.low ?? r.referenceLow ?? r.low),
            referenceHigh: asNumber(hr.referenceHigh ?? hr.high ?? r.referenceHigh ?? r.high),
            referenceLabel: asString(r.referenceLabel ?? r.rangeLabel),
          });
        }
      } else {
        push({
          analyteId: (asString(r.code) || name).toLowerCase().replace(/\s+/g, '-'),
          displayName: name,
          value,
          unit,
          sampledAt,
          referenceLow: asNumber(r.referenceLow ?? r.low ?? r.refLow),
          referenceHigh: asNumber(r.referenceHigh ?? r.high ?? r.refHigh),
          referenceLabel: asString(r.referenceLabel ?? r.rangeLabel),
        });
        const prev = asNumber(r.previous ?? r.previousValue);
        const prevDate = toIsoDate(r.previousDate ?? r.previousSampleDate);
        if (prev !== undefined && prevDate) {
          push({
            analyteId: (asString(r.code) || name).toLowerCase().replace(/\s+/g, '-'),
            displayName: name,
            value: prev,
            unit,
            sampledAt: prevDate,
            referenceLow: asNumber(r.referenceLow ?? r.low),
            referenceHigh: asNumber(r.referenceHigh ?? r.high),
          });
        }
      }
    }
  }

  // Shape B: data.panels[{id, analytes:[{...}]}]
  if (Array.isArray(data.panels)) {
    for (const panel of data.panels) {
      if (!panel || typeof panel !== 'object') continue;
      const p = panel as Record<string, unknown>;
      const nested = { ...data, results: p.analytes ?? p.results ?? p.measurements, panelId: p.id ?? p.panelId ?? p.name };
      out.push(...extractMeasurements({ ...resource, data: nested }, patientId, service));
    }
  }

  // Shape C: flat single value on resource
  if (out.length === 0) {
    const value = asNumber(data.value ?? data.result);
    const unit = asString(data.unit ?? data.units);
    if (value !== undefined && unit) {
      push({
        analyteId: panelId,
        displayName: resource.title || panelId,
        value,
        unit,
        sampledAt: toIsoDate(data.sampledAt ?? data.sampleDate ?? resource.createdAt) || new Date(resource.createdAt).toISOString(),
        referenceLow: asNumber(data.referenceLow ?? data.low),
        referenceHigh: asNumber(data.referenceHigh ?? data.high),
      });
    }
  }

  // Shape D: history map { ALT: [{date,value,unit}] }
  if (out.length === 0 && data.history && typeof data.history === 'object' && !Array.isArray(data.history)) {
    for (const [analyte, series] of Object.entries(data.history as Record<string, unknown>)) {
      if (!Array.isArray(series)) continue;
      for (const point of series) {
        if (!point || typeof point !== 'object') continue;
        const r = point as Record<string, unknown>;
        const value = asNumber(r.value);
        if (value === undefined) continue;
        push({
          analyteId: analyte.toLowerCase().replace(/\s+/g, '-'),
          displayName: analyte,
          value,
          unit: asString(r.unit) || '',
          sampledAt: toIsoDate(r.date ?? r.sampledAt) || new Date(resource.createdAt).toISOString(),
          referenceLow: asNumber(r.low ?? r.referenceLow),
          referenceHigh: asNumber(r.high ?? r.referenceHigh),
        });
      }
    }
  }

  return dedupeMeasurements(out);
}

function dedupeMeasurements(items: Measurement[]): Measurement[] {
  const map = new Map<string, Measurement>();
  for (const m of items) map.set(m.evidenceId, m);
  return [...map.values()].sort((a, b) => a.sampledAt.localeCompare(b.sampledAt));
}

export function resourceToEvent(resource: AnimaResource, patientId: string, service: string): NormalisedEvent {
  const classes = mapKindToClasses(resource.kind, resource.title);
  const data = resource.data || {};
  const summaryParts: string[] = [];
  for (const key of ['text', 'body', 'summary', 'notes', 'reason', 'statusText', 'followUp', 'gpActions', 'clinicalDetails']) {
    const v = asString(data[key]);
    if (v) summaryParts.push(v.slice(0, 500));
  }
  if (summaryParts.length === 0) {
    const snippet = JSON.stringify(data);
    if (snippet && snippet !== '{}') summaryParts.push(snippet.slice(0, 400));
  }
  return {
    evidenceId: `${resource.id}:event`,
    resourceId: resource.id,
    patientId,
    kind: resource.kind,
    title: resource.title,
    status: resource.status,
    at: new Date(resource.createdAt).toISOString(),
    summary: summaryParts.join('\n') || resource.title,
    informationClass: classes[0],
    service,
    sourceVersion: resource.version,
    rawSnippet: summaryParts[0],
    fields: {
      owner: resource.owner,
      dueAt: resource.dueAt,
      priority: resource.priority,
      visibleTo: resource.visibleTo,
      ...flattenScalars(data),
    },
  };
}

function flattenScalars(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v == null) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

export function buildClinicalContext(input: {
  patientId: string;
  siteResources: { site: string; resources: AnimaResource[]; now?: number }[];
  errors?: { site: string; message: string }[];
}): ClinicalContext {
  const resources: AnimaResource[] = [];
  const measurements: Measurement[] = [];
  const events: NormalisedEvent[] = [];
  const classSet = new Set<InformationClass>();
  let simulationNowMs: number | undefined;

  for (const bundle of input.siteResources) {
    if (typeof bundle.now === 'number') simulationNowMs = bundle.now;
    for (const resource of bundle.resources) {
      if (resource.patientId && resource.patientId !== input.patientId) continue;
      // Keep resources without patientId only if they clearly reference the patient in data
      if (!resource.patientId) {
        const ref = asString((resource.data || {}).patientId);
        if (ref && ref !== input.patientId) continue;
        if (!ref && !JSON.stringify(resource.data || {}).includes(input.patientId)) {
          // service-level resources without patient — skip for patient binding
          continue;
        }
      }
      resources.push({ ...resource, patientId: resource.patientId || input.patientId });
      const classes = mapKindToClasses(resource.kind, resource.title);
      classes.forEach((c) => classSet.add(c));
      if (classes.includes('laboratory_results') || LAB_KIND_RE.test(resource.kind + resource.title)) {
        measurements.push(...extractMeasurements(resource, input.patientId, bundle.site));
        if (measurements.some((m) => m.resourceId === resource.id)) classSet.add('laboratory_results');
      }
      events.push(resourceToEvent(resource, input.patientId, bundle.site));
    }
  }

  // Also try measurement extraction on any resource with numeric-looking data
  if (measurements.length === 0) {
    for (const resource of resources) {
      const extra = extractMeasurements(resource, input.patientId, resource.owner || 'unknown');
      if (extra.length) {
        measurements.push(...extra);
        classSet.add('laboratory_results');
      }
    }
  }

  const uniqueMeas = dedupeMeasurements(measurements);
  return {
    patientId: input.patientId,
    sites: [...new Set(input.siteResources.map((s) => s.site))],
    fetchedAt: new Date().toISOString(),
    simulationNowMs,
    resources,
    measurements: uniqueMeas,
    events: events.sort((a, b) => b.at.localeCompare(a.at)),
    recordClasses: [...classSet],
    sparse: resources.length === 0,
    errors: input.errors || [],
  };
}

export function buildSuggestions(ctx: ClinicalContext, allowedClasses: InformationClass[]): string[] {
  const suggestions: string[] = [];
  const has = (c: InformationClass) => allowedClasses.includes(c) && ctx.recordClasses.includes(c);
  if (has('laboratory_results') && ctx.measurements.length) {
    const latest = ctx.measurements[ctx.measurements.length - 1];
    suggestions.push(`Explain my latest ${latest.displayName} result`);
    const byAnalyte = new Map<string, Measurement[]>();
    for (const m of ctx.measurements) {
      const list = byAnalyte.get(m.analyteId) || [];
      list.push(m);
      byAnalyte.set(m.analyteId, list);
    }
    for (const [, series] of byAnalyte) {
      if (series.length >= 2) {
        suggestions.push(`How has ${series[0].displayName} changed over time?`);
        break;
      }
    }
  }
  if (has('clinical_documents')) {
    suggestions.push('What does the latest clinical document say I need to do next?');
  }
  if (has('appointments') || has('logistics')) {
    suggestions.push('Is my follow-up appointment confirmed, and when is it?');
  }
  if (has('tasks')) {
    suggestions.push('What open tasks or follow-ups are recorded?');
  }
  if (has('medications')) {
    suggestions.push('What is the status of my discharge medication supply?');
  }
  if (!suggestions.length) {
    suggestions.push('What information is available in my shared care record right now?');
  }
  return suggestions.slice(0, 5);
}
