/** Host integration check: mount the plugin's apply() against the real corpus. */
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { apply, inject } from '../index.js'
import { TOKEN_REPORT_PATH, TOKEN_STREAM_PATH } from '../ledger.js'

const root = path.join(process.env.HOME, '.dsh', 'sessions')

function listFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(full))
    else if (entry.name.endsWith('.jsonl.zstd')) out.push(full)
  }
  return out
}

const snapshots = new Map()
for (const file of listFiles(root)) {
  const text = execFileSync('zstd', ['-dc', file], { maxBuffer: 1 << 30 }).toString('utf8')
  const records = []
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      records.push(JSON.parse(line))
    } catch {}
  }
  const header = records.find((record) => record.type === 'session')
  if (header === undefined) continue
  snapshots.set(header.id, {
    session: header,
    inheritedEventCount: 0,
    events: records.filter((record) => record.type !== 'session'),
  })
}

const reads = []
const routes = new Map()
const listeners = new Set()
const fakeCtx = {
  on(name, listener) {
    listeners.add([name, listener])
    return () => listeners.delete([name, listener])
  },
  effect(callback) {
    return callback()
  },
  connection: {
    fetch: {
      register(route) {
        routes.set(route.path, route)
        return async () => {}
      },
    },
  },
  sessionQuery: {
    async listSessions() {
      return [...snapshots.values()].map((snapshot) => ({ header: snapshot.session, live: false, persisted: true }))
    },
    async readSession(id) {
      reads.push(id)
      const found = snapshots.get(id)
      if (found === undefined) throw new Error(`unknown session ${id}`)
      return found
    },
  },
}

assert.deepEqual(inject, ['connection', 'sessionQuery'])
apply(fakeCtx)
assert.deepEqual([...routes.keys()].sort(), [TOKEN_REPORT_PATH, TOKEN_STREAM_PATH].sort(), 'both routes are registered')
assert.equal([...listeners].filter(([name]) => name === 'session/event').length, 1, 'one live feed listener')
assert.equal(routes.get(TOKEN_REPORT_PATH).methods.length, 1)
assert.equal(routes.get(TOKEN_REPORT_PATH).methods[0], 'GET')

const route = routes.get(TOKEN_REPORT_PATH)
const answer = await route.fetch(new Request(`http://127.0.0.1:60884${TOKEN_REPORT_PATH}?days=7`))
assert.equal(answer.status, 200)
assert.match(answer.headers.get('content-type'), /application\/json/)
const report = await answer.json()

assert.equal(report.windowDays, 7)
assert.equal(report.days.length, 7)
assert.equal(report.days[6].date, report.today)
assert.equal(reads.length, snapshots.size, 'every session is read once')
assert.equal(report.scanned.sessions, snapshots.size)
assert.equal(report.scanned.unreadable, 0)
assert.equal(report.scanned.failed, false)
assert.ok(report.scanned.samples > 0, 'usage records were folded')
assert.ok(report.days.every((day) => day.total === day.input + day.cacheRead + day.cacheWrite + day.output))
assert.ok(report.days.every((day) => day.prompt === day.input + day.cacheRead + day.cacheWrite))

// A second request reuses the finished scan instead of re-reading the corpus.
const again = await (await route.fetch(new Request(`http://127.0.0.1:60884${TOKEN_REPORT_PATH}`))).json()
assert.equal(reads.length, snapshots.size, 'the scan is not repeated')
assert.equal(again.windowDays, 30, 'an absent window defaults to 30 days')
assert.equal(again.days.length, 30)

// A custom range wins over the day count, and one day carries hours.
const ranged = await (await route.fetch(new Request(`http://127.0.0.1:60884${TOKEN_REPORT_PATH}?from=2026-11-16&to=2026-11-17&rows=5`))).json()
assert.deepEqual(ranged.range, { from: '2026-11-16', to: '2026-11-17' })
assert.deepEqual(ranged.days.map((entry) => entry.date), ['2026-11-16', '2026-11-17'])
assert.equal(ranged.hourly.length, 0)
assert.ok(ranged.requests.every((row) => row.day >= '2026-11-16' && row.day <= '2026-11-17'), 'rows stay inside the range')
assert.equal(ranged.todayRow.date, report.today, 'today stays available whatever the range')

const singleDay = await (await route.fetch(new Request(`http://127.0.0.1:60884${TOKEN_REPORT_PATH}?from=${report.today}&to=${report.today}`))).json()
assert.equal(singleDay.days.length, 1)
assert.equal(singleDay.hourly.length, 24, 'a single day answers with its hours')
assert.equal(singleDay.hourly.reduce((sum, slot) => sum + slot.total, 0), singleDay.days[0].total, 'the hours add up to the day')

// Clamping keeps a hostile window inside the accepted range.
const clamped = await (await route.fetch(new Request(`http://127.0.0.1:60884${TOKEN_REPORT_PATH}?days=100000`))).json()
assert.equal(clamped.windowDays, 365)

// A live event after the scan folds into today.
const before = report.days[6].total
const live = [...listeners].find(([name]) => name === 'session/event')[1]
live({ id: 'live-check' }, {
  type: 'assistant/message',
  seq: 0,
  time: Date.now(),
  data: { turn: 1, step: 1, message: { role: 'assistant' }, stream: [], usage: { inputTokens: 7, outputTokens: 3 } },
})
const after = (await (await route.fetch(new Request(`http://127.0.0.1:60884${TOKEN_REPORT_PATH}?days=7`))).json()).days[6].total
assert.equal(after, before + 10, 'a live sample lands on today')

// The stream answers with a snapshot, then pushes another one when a request
// settles: no timer, no polling.
const streamResponse = await routes.get(TOKEN_STREAM_PATH).fetch(new Request(`http://127.0.0.1:60884${TOKEN_STREAM_PATH}?days=7&rows=5`))
assert.equal(streamResponse.status, 200)
assert.match(streamResponse.headers.get('content-type'), /ndjson/)
const reader = streamResponse.body.pipeThrough(new TextDecoderStream()).getReader()
let pending = ''
const nextLine = async () => {
  for (;;) {
    const index = pending.indexOf('\n')
    if (index >= 0) {
      const line = pending.slice(0, index)
      pending = pending.slice(index + 1)
      return line
    }
    const { done, value } = await reader.read()
    if (done) throw new Error('the stream ended before a line arrived')
    pending += value
  }
}

const opened = JSON.parse(await nextLine())
assert.equal(opened.type, 'snapshot', 'the stream opens with a snapshot')
assert.equal(opened.report.days.length, 7)
assert.equal(opened.report.requests.length, 5, 'the row limit reaches the stream')

const beforePush = opened.report.todayRow.total
live({ id: 'stream-check' }, {
  type: 'assistant/message',
  seq: 0,
  time: Date.now(),
  data: { turn: 1, step: 1, message: { role: 'assistant' }, stream: [], usage: { inputTokens: 4, outputTokens: 6 } },
})
const pushed = JSON.parse(await nextLine())
assert.equal(pushed.type, 'snapshot', 'a settled request pushes a new snapshot')
assert.equal(pushed.report.todayRow.total, beforePush + 10, 'the push carries the new total')
await reader.cancel()

const day = report.days[6]
console.log('host integration passed')
console.log(`today ${day.date}: total=${day.total} input=${day.input} cacheRead=${day.cacheRead} cacheWrite=${day.cacheWrite} output=${day.output} requests=${day.requests} sessions=${day.sessions}`)
console.log(`window 7d total=${report.days.reduce((n, entry) => n + entry.total, 0)} across ${report.scanned.sessions} sessions / ${report.scanned.samples} usage records`)
