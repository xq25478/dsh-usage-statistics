/** Fold tests for the token-usage-daily ledger, run outside the Host. */
import assert from 'node:assert/strict'
import { createLedger, clampWindow, dayKeyOf, MAX_WINDOW_DAYS } from '../ledger.js'

const NOW = new Date(2026, 10, 17, 14, 0, 0).getTime()
const at = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute, 0).getTime()
const usageChunk = (usage) => ({ type: 'chunk', time: 0, chunk: { type: 'usage', usage } })

function message(seq, time, turn, step, usage) {
  return { type: 'assistant/message', seq, time, data: { turn, step, message: { role: 'assistant' }, stream: [], usage } }
}
function attempt(seq, time, turn, step, usage) {
  return { type: 'assistant/attempt', seq, time, data: { turn, step, stream: [usageChunk(usage)] } }
}
function retry(seq, time, turn, step) {
  return { type: 'llm/retry-started', seq, time, data: { turn, step } }
}

/** A sessionQuery stub: `listSessions` yields headers, `readSession` the snapshots. */
function queryOf(snapshots) {
  const calls = []
  return {
    calls,
    async listSessions() {
      return snapshots.map((snapshot) => ({ header: snapshot.session, live: false, persisted: true }))
    },
    async readSession(id) {
      calls.push(id)
      const found = snapshots.find((snapshot) => snapshot.session.id === id)
      if (found === undefined) throw new Error(`missing session ${id}`)
      return { ...found, events: found.events.map((event) => ({ ...event })) }
    },
  }
}

const day17 = dayKeyOf(new Date(NOW))
const day16 = dayKeyOf(new Date(NOW - 86400000))
assert.equal(day17, '2026-11-17')
assert.equal(day16, '2026-11-16')

const sessions = [
  {
    session: { id: 's1' },
    inheritedEventCount: 0,
    events: [
      message(0, at(17, 10), 1, 1, { inputTokens: 100, outputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 1 }),
      attempt(1, at(17, 10), 1, 2, { inputTokens: 200, outputTokens: 20 }),
      message(2, at(17, 11), 1, 2, { inputTokens: 200, outputTokens: 25 }),
      attempt(3, at(17, 11), 2, 1, { inputTokens: 50, outputTokens: 5 }),
      retry(4, at(17, 11), 2, 1),
      attempt(5, at(17, 12), 2, 1, { inputTokens: 60, outputTokens: 6 }),
    ],
  },
  {
    // A fork: the first two events are the parent's history and must not count again.
    session: { id: 's2' },
    inheritedEventCount: 2,
    events: [
      message(0, at(16, 9), 1, 1, { inputTokens: 1000, outputTokens: 100 }),
      message(1, at(16, 9), 1, 2, { inputTokens: 1000, outputTokens: 100 }),
      message(2, at(16, 20), 2, 1, { inputTokens: 7, outputTokens: 3 }),
    ],
  },
]

{
  const ledger = createLedger()
  const query = queryOf(sessions)
  await Promise.all([ledger.synchronize(query), ledger.synchronize(query)])
  assert.deepEqual(query.calls, ['s1', 's2'], 'one shared scan reads each session once')

  const report = ledger.report({ windowDays: 7, now: NOW })
  assert.equal(report.today, day17)
  assert.equal(report.days.length, 7)
  assert.equal(report.days[6].date, day17)
  assert.deepEqual(
    { input: report.days[6].input, cacheRead: report.days[6].cacheRead, cacheWrite: report.days[6].cacheWrite, output: report.days[6].output, requests: report.days[6].requests, sessions: report.days[6].sessions },
    { input: 410, cacheRead: 5, cacheWrite: 1, output: 46, requests: 4, sessions: 1 },
    'a settlement replaces the streamed sample of the same step, a retry starts a new one',
  )
  assert.equal(report.days[6].total, 410 + 5 + 1 + 46)
  assert.deepEqual(
    { input: report.days[5].input, output: report.days[5].output, total: report.days[5].total, sessions: report.days[5].sessions },
    { input: 7, output: 3, total: 10, sessions: 1 },
    'a fork seed is not counted again',
  )
  assert.equal(report.days[0].total, 0, 'a quiet day reports zeros')
  assert.equal(report.requests.length, 5, 'six settled samples, one of them a replacement, make five rows')
  assert.equal(report.requests[0].time, at(17, 12), 'rows are newest first')
  assert.equal(report.requests[0].session, 's1')
  assert.deepEqual(report.scanned, { sessions: 2, samples: 6, unreadable: 0, failed: false })
}

{
  // One settled request becomes one log row: route, split, and stream timing.
  const start = at(17, 9)
  const ledger = createLedger()
  await ledger.synchronize(queryOf([{
    session: { id: 'r1', cwd: '/x/code/sglang' },
    inheritedEventCount: 0,
    events: [
      { type: 'step/start', seq: 0, time: start, data: { turn: 1, step: 1 } },
      {
        type: 'assistant/message',
        seq: 1,
        time: start + 4000,
        data: {
          turn: 1,
          step: 1,
          message: { role: 'assistant', source: { kind: 'model', provider: 'maas', model: 'deepseek-x' } },
          usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 900 },
          stream: [{ type: 'text-chunks', time0: start + 1000, index: 0, dt: [100, 200, 300], texts: ['a', 'b', 'c', 'd'] }],
        },
      },
    ],
  }]))
  const rows = ledger.report({ windowDays: 1, now: NOW, requestLimit: 10 }).requests
  assert.equal(rows.length, 1, 'one settled request, one row')
  assert.deepEqual(
    { cwd: rows[0].cwd, provider: rows[0].provider, model: rows[0].model, input: rows[0].input, cacheRead: rows[0].cacheRead, output: rows[0].output, ttftMs: rows[0].ttftMs, decodeMs: rows[0].decodeMs, tps: rows[0].tps },
    { cwd: '/x/code/sglang', provider: 'maas', model: 'deepseek-x', input: 100, cacheRead: 900, output: 50, ttftMs: 1000, decodeMs: 600, tps: 83.3 },
    'the row carries the route, the split, and the stream timing',
  )
  // The row limit is honoured and the newest row comes first.
  assert.equal(ledger.report({ windowDays: 1, now: NOW, requestLimit: 0 }).requests.length, 1, 'a zero limit still yields one row')
  assert.equal(ledger.report({ windowDays: 1, now: NOW, requestLimit: 1 }).requests.length, 1)
}

{
  // A replacement rewrites its row instead of adding one; a retry adds another.
  const ledger = createLedger()
  await ledger.synchronize(queryOf([{
    session: { id: 'r2' },
    inheritedEventCount: 0,
    events: [
      attempt(0, at(17, 9) + 0, 1, 1, { inputTokens: 10, outputTokens: 2 }),
      message(1, at(17, 9) + 1000, 1, 1, { inputTokens: 10, outputTokens: 3 }),
      retry(2, at(17, 9) + 2000, 1, 1),
      attempt(3, at(17, 9) + 3000, 1, 1, { inputTokens: 11, outputTokens: 4 }),
    ],
  }]))
  const rows = ledger.report({ windowDays: 1, now: NOW }).requests
  assert.equal(rows.length, 2, 'the settlement rewrote its own row; the retry started another')
  assert.deepEqual(rows.map((row) => row.output), [4, 3], 'the retry is the newest row')
}

{
  // A range is its own two day keys; one day also carries its hours.
  const ledger = createLedger()
  await ledger.synchronize(queryOf([{
    session: { id: 'range' },
    inheritedEventCount: 0,
    events: [
      message(0, at(15, 9), 1, 1, { inputTokens: 5, outputTokens: 1 }),
      message(1, at(16, 10), 1, 2, { inputTokens: 7, outputTokens: 2 }),
      message(2, at(17, 11), 1, 3, { inputTokens: 11, outputTokens: 3 }),
    ],
  }]))

  const ranged = ledger.report({ from: '2026-11-15', to: '2026-11-16', now: NOW })
  assert.deepEqual(ranged.days.map((entry) => entry.date), ['2026-11-15', '2026-11-16'], 'the range is the two days asked for')
  assert.deepEqual(ranged.days.map((entry) => entry.total), [6, 9])
  assert.deepEqual(ranged.requests.map((row) => row.day), ['2026-11-16', '2026-11-15'], 'request rows are filtered to the range')
  assert.equal(ranged.hourly.length, 0, 'a multi-day range carries no hourly series')

  const single = ledger.report({ from: '2026-11-16', to: '2026-11-16', now: NOW })
  assert.equal(single.days.length, 1)
  assert.equal(single.hourly.length, 24, 'a single day carries 24 hour buckets')
  assert.deepEqual(
    single.hourly[10],
    { hour: 10, input: 7, cacheRead: 0, cacheWrite: 0, output: 2, prompt: 7, total: 9, requests: 1 },
    'the sample landed in its own hour',
  )
  assert.equal(single.hourly[0].total, 0, 'an unused hour reports zeros')

  // Today's own bucket is independent of the range on screen.
  assert.equal(single.todayRow.date, '2026-11-17')
  assert.equal(single.todayRow.total, 14)

  const reversed = ledger.report({ from: '2026-11-16', to: '2026-11-15', now: NOW })
  assert.deepEqual(reversed.range, { from: '2026-11-15', to: '2026-11-16' }, 'a reversed pair is read the way it was meant')

  const wide = ledger.report({ from: '2020-01-01', to: '2026-11-17', now: NOW })
  assert.equal(wide.days.length, 366, 'a range wider than a year keeps its newest end')
  assert.equal(wide.days[wide.days.length - 1].date, '2026-11-17')

  const nonsense = ledger.report({ from: 'not-a-day', to: '', windowDays: 7, now: NOW })
  assert.deepEqual(nonsense.range, { from: '2026-11-11', to: '2026-11-17' }, 'an unparsable range falls back to the window')
}

{
  // Live events: sequences the scan already covered are ignored, later ones fold.
  const ledger = createLedger()
  await ledger.synchronize(queryOf([{ session: { id: 's1' }, inheritedEventCount: 0, events: [message(0, at(17, 9), 1, 1, { inputTokens: 5, outputTokens: 1 })] }]))
  const live = {
    id: 's1',
    // Replay of an already scanned event must not add again.
    duplicate: () => ledger.observe({ id: 's1' }, message(0, at(17, 9), 1, 1, { inputTokens: 5, outputTokens: 1 })),
    fresh: () => ledger.observe({ id: 's1' }, message(1, at(17, 13), 2, 1, { inputTokens: 8, outputTokens: 2, cacheReadTokens: 4 })),
  }
  live.duplicate()
  assert.equal(ledger.report({ windowDays: 1, now: NOW }).days[0].total, 6)
  live.fresh()
  assert.equal(ledger.report({ windowDays: 1, now: NOW }).days[0].total, 6 + 14)
  // A session created after the scan folds directly, first event included.
  ledger.observe({ id: 's3' }, message(0, at(17, 13, 30), 1, 1, { inputTokens: 11, outputTokens: 1 }))
  const today = ledger.report({ windowDays: 1, now: NOW }).days[0]
  assert.equal(today.total, 6 + 14 + 12)
  assert.equal(today.sessions, 2)
}

{
  // A replacement that lands after midnight moves its counts to the new day.
  const ledger = createLedger()
  await ledger.synchronize(queryOf([{
    session: { id: 'late' },
    inheritedEventCount: 0,
    events: [
      attempt(0, at(16, 23, 55), 1, 1, { inputTokens: 30, outputTokens: 3 }),
      message(1, at(17, 0, 5), 1, 1, { inputTokens: 30, outputTokens: 4 }),
    ],
  }]))
  const report = ledger.report({ windowDays: 2, now: NOW })
  assert.deepEqual(
    { date: report.days[0].date, input: report.days[0].input, output: report.days[0].output, total: report.days[0].total },
    { date: day16, input: 0, output: 0, total: 0 },
  )
  assert.deepEqual(
    { date: report.days[1].date, input: report.days[1].input, output: report.days[1].output, total: report.days[1].total },
    { date: day17, input: 30, output: 4, total: 34 },
  )
}

{
  // Malformed input never throws and never invents usage.
  const ledger = createLedger()
  await ledger.synchronize(queryOf([
    { session: { id: 'odd' }, inheritedEventCount: 0, events: [
      { type: 'assistant/message', seq: 0, time: at(17, 9), data: { turn: 1, step: 1, stream: [], usage: null } },
      { type: 'assistant/message', seq: 1, time: 0, data: { turn: 1, step: 1, stream: [], usage: { inputTokens: 4, outputTokens: 2 } } },
      { type: 'assistant/message', seq: 2, time: at(17, 9), data: { turn: 1, step: 2, stream: [], usage: { inputTokens: 0, outputTokens: 0 } } },
      { type: 'tool/result', seq: 3, time: at(17, 9) },
      null,
    ] },
    { session: { id: 'broken' }, inheritedEventCount: 0, events: [] },
  ]))
  const report = ledger.report({ windowDays: 1, now: NOW })
  assert.equal(report.days[0].total, 0)
  assert.equal(report.scanned.unreadable, 0)
}

{
  // An unreadable session is reported, not fatal.
  const ledger = createLedger()
  await ledger.synchronize({
    async listSessions() { return [{ header: { id: 'gone' } }] },
    async readSession() { throw new Error('migration required') },
  })
  const report = ledger.report({ windowDays: 1, now: NOW })
  assert.equal(report.days[0].total, 0)
  assert.deepEqual(report.scanned, { sessions: 0, samples: 0, unreadable: 1, failed: false })
}

{
  // A failing corpus listing leaves an empty, still-readable report.
  const ledger = createLedger()
  await ledger.synchronize({ async listSessions() { throw new Error('corpus unavailable') }, async readSession() { throw new Error('unused') } })
  const report = ledger.report({ windowDays: 3, now: NOW })
  assert.equal(report.days.length, 3)
  assert.equal(report.scanned.failed, true, 'a corpus that cannot be listed is a reported failure')
}

{
  // Window clamping keeps the route's `days` parameter inside the accepted range.
  assert.equal(clampWindow('7'), 7)
  assert.equal(clampWindow('0'), 1)
  assert.equal(clampWindow('9999'), MAX_WINDOW_DAYS)
  assert.equal(clampWindow(undefined), 30)
  assert.equal(clampWindow('nope'), 30)
}

console.log('ledger tests passed')
