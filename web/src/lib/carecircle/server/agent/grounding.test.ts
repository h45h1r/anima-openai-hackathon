import test from 'node:test';
import assert from 'node:assert/strict';
import { proseFromFacts } from './grounding';

test('a flagged result stays outside the range in the displayed answer', () => {
  const text = proseFromFacts([
    { text: 'Latest requested results on record are from 11 September 2026.', evidenceIds: ['a'] },
    { text: 'HbA1c: 48 mmol/mol — outside illustrative range (illustrative range 20–41 mmol/mol).', evidenceIds: ['a'] },
  ], { labIntent: true });
  assert.match(text, /HbA1c: 48/);
  assert.match(text, /One value sits outside/);
  assert.doesNotMatch(text, /within.*range/);
});

test('results without a reference interval do not acquire a normal-range claim', () => {
  const text = proseFromFacts([{ text: 'Recorded result: 48 units.', evidenceIds: ['a'] }], { labIntent: true });
  assert.doesNotMatch(text, /within.*range/);
});
