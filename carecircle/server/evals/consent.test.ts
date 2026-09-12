import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createDefaultPolicy,
  evaluateConsent,
  holdResource,
  updateGrants,
  type EvidenceItem,
} from '../src/consent/policy.js';
import type { Measurement, NormalisedEvent } from '../src/types/domain.js';

function meas(partial: Partial<Measurement> & Pick<Measurement, 'evidenceId' | 'resourceId'>): EvidenceItem {
  const payload: Measurement = {
    patientId: 'SIM-000001',
    panelId: 'lft',
    analyteId: 'alt',
    displayName: 'ALT',
    value: 42,
    unit: 'U/L',
    sampledAt: '2026-09-11T00:00:00.000Z',
    service: 'gp',
    sourceVersion: 1,
    informationClass: 'laboratory_results',
    ...partial,
  };
  return {
    evidenceId: payload.evidenceId,
    resourceId: payload.resourceId,
    informationClass: 'laboratory_results',
    fields: ['value', 'unit'],
    payload,
    kind: 'measurement',
  };
}

function event(partial: Partial<NormalisedEvent> & Pick<NormalisedEvent, 'evidenceId' | 'resourceId' | 'informationClass'>): EvidenceItem {
  const payload: NormalisedEvent = {
    patientId: 'SIM-000001',
    kind: 'appointment',
    title: 'Follow-up',
    status: 'booked',
    at: '2026-09-12T00:00:00.000Z',
    summary: 'Practice follow-up',
    service: 'gp',
    sourceVersion: 1,
    fields: { reason: 'review' },
    ...partial,
  };
  return {
    evidenceId: payload.evidenceId,
    resourceId: payload.resourceId,
    informationClass: payload.informationClass,
    fields: ['reason'],
    payload,
    kind: 'event',
  };
}

describe('consent policy', () => {
  it('allows patient full access', () => {
    const policy = createDefaultPolicy('SIM-000001', 'Amira Khan');
    const decision = evaluateConsent({
      policy,
      viewerId: 'patient',
      evidence: [meas({ evidenceId: 'e1', resourceId: 'r1', value: 55 })],
    });
    assert.equal(decision.outcome, 'allow');
    assert.ok(decision.allowedEvidenceIds.includes('e1'));
    assert.ok(decision.reasonCodes.includes('SELF_ACCESS'));
  });

  it('denies Tom laboratory results with no leakage fields', () => {
    const policy = createDefaultPolicy('SIM-000001', 'Amira Khan');
    const decision = evaluateConsent({
      policy,
      viewerId: 'tom',
      evidence: [meas({ evidenceId: 'e1', resourceId: 'r1', value: 99 })],
    });
    assert.equal(decision.outcome, 'deny');
    assert.deepEqual(decision.allowedEvidenceIds, []);
    assert.ok(!JSON.stringify(decision).includes('99'));
  });

  it('holds newly disclosed results for Sarah even with grant', () => {
    let policy = createDefaultPolicy('SIM-000001', 'Amira Khan');
    policy = holdResource(policy, 'r-new', 'system');
    const decision = evaluateConsent({
      policy,
      viewerId: 'sarah',
      evidence: [meas({ evidenceId: 'e1', resourceId: 'r-new', value: 12 })],
    });
    assert.equal(decision.outcome, 'hold');
    assert.deepEqual(decision.allowedEvidenceIds, []);
    assert.ok(decision.reasonCodes.includes('RESULT_HELD_FOR_DISCLOSURE'));
  });

  it('allows John appointments but not results (partial)', () => {
    const policy = createDefaultPolicy('SIM-000001', 'Amira Khan');
    const decision = evaluateConsent({
      policy,
      viewerId: 'john',
      evidence: [
        event({ evidenceId: 'a1', resourceId: 'ra', informationClass: 'appointments' }),
        meas({ evidenceId: 'm1', resourceId: 'rm', value: 7 }),
      ],
    });
    assert.equal(decision.outcome, 'partial');
    assert.deepEqual(decision.allowedEvidenceIds, ['a1']);
  });

  it('applies immediate consent revocation for Sarah results', () => {
    let policy = createDefaultPolicy('SIM-000001', 'Amira Khan');
    policy = updateGrants(policy, 'sarah', { laboratory_results: false }, policy.policyVersion, 'patient');
    const decision = evaluateConsent({
      policy,
      viewerId: 'sarah',
      evidence: [meas({ evidenceId: 'e1', resourceId: 'r1', value: 33 })],
    });
    assert.equal(decision.outcome, 'deny');
  });

  it('rejects wrong viewer / patient mismatch', () => {
    const policy = createDefaultPolicy('SIM-000001', 'Amira Khan');
    const decision = evaluateConsent({
      policy,
      viewerId: 'unknown',
      evidence: [meas({ evidenceId: 'e1', resourceId: 'r1' })],
    });
    assert.equal(decision.outcome, 'deny');
    assert.ok(decision.reasonCodes.includes('VIEWER_MISMATCH'));
  });
});
