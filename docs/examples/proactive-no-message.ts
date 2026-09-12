// Can the agent run with NO user message, with the trigger injected by a context renderer?
import { z } from 'zod'
import { adk } from '@animahealth/adk'
import { claude } from '@animahealth/adk/claude'
import { MockAdapter } from '@animahealth/adk/testing'

const mock = new MockAdapter({ responses: [{ text: 'Family reminder drafted.' }] })
const app = adk({
  name: 'proactive-test',
  schema: { session: { trigger: z.object({ kind: z.string(), patientId: z.string(), horizon: z.string() }) } },
  adapters: { claude: mock },
})
const agent = app.agent({
  name: 'reminder',
  model: claude('claude-sonnet-4-5', { vertex: { project: 'x', location: 'us-east5' } }),
  context: [
    app.context.system('You draft family reminders.'),
    // Trigger arrives as a *rendered* user turn — no `user` event is written to the ledger.
    app.context.user((ctx) => `TRIGGER ${ctx.state.trigger.kind} for ${ctx.state.trigger.patientId} within ${ctx.state.trigger.horizon}`),
    app.context.history(),
  ],
})
async function main() {
  const session = await app.sessions.create({ sessionId: 'thread:p001:family-group', scopes: { patient: 'p001' } })
  const result = await app.run(agent, {
    session,
    input: { state: { trigger: { kind: 'appointment_reminder', patientId: 'p001', horizon: '7d' } } }, // no message!
  })
  await app.sessions.commit(session, session.version)
  console.log('status:', result.status, '| text:', result.output.text)
  const call = mock.stepCalls[0]
  console.log('RenderContext keys:', Object.keys(call.ctx).join(', '))
  const rendered = (call.ctx as any).events ?? (call.ctx as any).messages ?? []
  console.log('rendered turns sent to model:', JSON.stringify(rendered.map((m: any) => ({ type: m.type, text: m.text })), null, 0))
  console.log('ledger event types:', session.events.map((e) => e.type).join(' -> '))
  console.log('user events in ledger:', session.events.filter((e) => e.type === 'user').length)
}
main().catch((e) => { console.error(e); process.exit(1) })
