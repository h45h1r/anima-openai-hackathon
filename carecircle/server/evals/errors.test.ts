import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AnimaClientError } from '../src/anima/client.js';
import { animaStatusForKind, humanMessage, humanizeAnimaError } from '../src/errors.js';

describe('error humanization', () => {
  it('maps codes to crisp judge-friendly copy', () => {
    assert.equal(humanMessage('unauthorized'), 'Permission denied — check your Anima API key.');
    assert.equal(humanMessage('unavailable'), 'Anima unreachable — retry.');
    assert.equal(humanMessage('only_patient_may_edit_consent'), 'Consent blocks this — only the patient viewer can edit access.');
    assert.equal(humanMessage('booking_not_submitted'), 'Booking not submitted (API limitation or rejected slot).');
    assert.equal(humanMessage('question_required'), 'Enter a question before asking.');
  });

  it('does not leak snake_case codes or stack traces as messages', () => {
    assert.equal(humanMessage('question_required', 'question_required'), 'Enter a question before asking.');
    assert.equal(
      humanMessage('internal', 'Error: boom\n    at Object.<anonymous> (file.ts:1:1)'),
      'Something went wrong in CareCircle — retry.',
    );
  });

  it('humanizes Anima upstream failures with correct HTTP status mapping', () => {
    const unauth = new AnimaClientError('Get a team API key at POST /api/keys', 'unauthorized', 401);
    assert.equal(humanizeAnimaError(unauth), 'Permission denied — check your Anima API key.');
    assert.equal(animaStatusForKind('unauthorized'), 401);

    const down = new AnimaClientError('fetch failed', 'unavailable');
    assert.equal(humanizeAnimaError(down), 'Anima unreachable — retry.');
    assert.equal(animaStatusForKind('unavailable'), 503);

    const book = new AnimaClientError('unsupported action type', 'bad_request', 400);
    assert.equal(humanizeAnimaError(book), 'Booking not submitted (API limitation or rejected slot).');
  });
});
