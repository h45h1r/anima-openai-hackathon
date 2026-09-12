import test from 'node:test';
import assert from 'node:assert/strict';
import { createAskAgent, createCareCircleAdkApp } from './adkApp';

test('ADK sends priority service tier in the actual OpenAI request', async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  const requests: Record<string, unknown>[] = [];
  const part = { type: 'output_text', text: 'Ready.', annotations: [] };
  const item = { id: 'msg-test', type: 'message', role: 'assistant', status: 'completed', content: [part] };
  const response = { id: 'resp-test', object: 'response', created_at: 1, model: 'gpt-5.6-sol', status: 'completed', output: [item], service_tier: 'priority', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const events = [
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
      { type: 'response.content_part.added', item_id: item.id, output_index: 0, content_index: 0, part: { ...part, text: '' } },
      { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'Ready.' },
      { type: 'response.output_text.done', item_id: item.id, output_index: 0, content_index: 0, text: 'Ready.' },
      { type: 'response.content_part.done', item_id: item.id, output_index: 0, content_index: 0, part },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response },
    ];
    return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    const app = createCareCircleAdkApp();
    const agent = createAskAgent(app, 'gpt-5.6-sol', []);
    const session = await app.sessions.create();
    const result = await app.run(agent, { session, input: { message: 'Hello' } });
    assert.equal(result.status, 'completed');
    assert.equal(result.output.text, 'Ready.');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].service_tier, 'priority');
    assert.deepEqual(requests[0].reasoning, { effort: 'medium' });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});
