/**
 * Daily token-usage ledger.
 *
 * The durable session log is the only source of truth for billing-grade usage:
 * every finished model call appends an `assistant/message` (or, for a failed
 * attempt, an `assistant/attempt`) that carries the provider-reported token
 * counts. This module folds those samples into per-local-day buckets so the
 * report answers "how many tokens did I use on each day" without replaying a
 * session on the browser.
 *
 * The fold mirrors the `tokenUsage` projection unit of `@deepseek-ai/dsh-token-meter`,
 * which is the shipped definition of the same numbers: a second sample for the
 * same turn and step replaces the first one instead of adding to it, and an
 * `llm/retry-started` event closes that replacement slot so the retried attempt
 * counts separately. The only difference is the bucket: this fold groups by the
 * local date of the event instead of one running total per session.
 *
 * Nothing here imports a Harness package: the ledger is plain data in, plain
 * data out, which is also what makes it testable outside the running Host.
 */

/** Shared route constant; the browser resolves it against its document base. */
export const TOKEN_REPORT_PATH = '/api/token-usage-daily/report'

/** The one push route: an open NDJSON stream of snapshots. */
export const TOKEN_STREAM_PATH = '/api/token-usage-daily/stream'

/** Widest accepted history window, in days. */
export const MAX_WINDOW_DAYS = 365

/** Buckets a day may carry when nothing was used. */
function emptyBucket() {
  return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, requests: 0, sessions: new Set() }
}

/** Read a finite number, or 0 for an absent or malformed provider count. */
function count(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Local calendar date of one instant, as the `YYYY-MM-DD` key used everywhere here. */
export function dayKeyOf(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Widest accepted range, in days. */
const MAX_RANGE_DAYS = 366

/** How many hourly buckets survive, enough for a few single-day views. */
const HOUR_KEEP = 96

/** Local calendar date of one instant, as the `YYYY-MM-DD` key used everywhere here. */
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

/** Parse one local day key into noon of that day, or null when it is not a day key. */
export function parseDayKey(key) {
  if (typeof key !== 'string') return null
  const match = DAY_KEY.exec(key)
  if (match === null) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0)
  return Number.isNaN(date.getTime()) || dayKeyOf(date) !== key ? null : date
}

/** The day key `days` away from one day key. */
export function shiftDayKey(key, days) {
  const date = parseDayKey(key)
  if (date === null) return key
  return dayKeyOf(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12, 0, 0, 0))
}

/** One hour bucket key: the local day plus its hour. */
export function hourKeyOf(date) {
  return `${dayKeyOf(date)}T${String(date.getHours()).padStart(2, '0')}`
}

/** Provider token counts of one sample, in this ledger's bucket vocabulary. */
function usageBuckets(usage) {
  return {
    input: count(usage.inputTokens),
    cacheRead: count(usage.cacheReadTokens),
    cacheWrite: count(usage.cacheWriteTokens),
    output: count(usage.outputTokens),
  }
}

/** Whether two samples report the same counts. */
function sameBuckets(left, right) {
  return left.input === right.input
    && left.cacheRead === right.cacheRead
    && left.cacheWrite === right.cacheWrite
    && left.output === right.output
}

/** Whether a sample reports nothing at all. */
function isEmptyBuckets(buckets) {
  return buckets.input === 0 && buckets.cacheRead === 0 && buckets.cacheWrite === 0 && buckets.output === 0
}

/**
 * The last provider usage chunk of one durable assistant stream.
 *
 * Usage travels as a raw `chunk` record; the packed text, reasoning, and
 * tool-call records never carry it, so the backwards scan only inspects raw
 * records, exactly as `lastAssistantStreamChunk(stream, 'usage')` does.
 */
function lastUsageInStream(stream) {
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index]
    if (record === null || typeof record !== 'object') continue
    if (record.type !== 'chunk') continue
    const chunk = record.chunk
    if (chunk === null || typeof chunk !== 'object' || chunk.type !== 'usage') continue
    return chunk.usage
  }
  return undefined
}

/** The usage one durable assistant settlement reports for its attempt, if any. */
function sampleOf(event) {
  const data = event.data
  if (data === null || typeof data !== 'object') return undefined
  if (event.type === 'assistant/message') {
    if (data.usage !== null && typeof data.usage === 'object') return data.usage
    return lastUsageInStream(data.stream)
  }
  if (event.type === 'assistant/attempt') return lastUsageInStream(data.stream)
  return undefined
}

/** Clamp one requested history window into the accepted range. */
export function clampWindow(value) {
  const requested = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value)
  if (!Number.isFinite(requested)) return 30
  return Math.min(MAX_WINDOW_DAYS, Math.max(1, Math.trunc(requested)))
}

/** How many pre-scan events one session may park before the oldest are dropped. */
const DEFERRED_LIMIT = 5000

/** How many request rows the ledger keeps, and how far it trims when full. */
const REQUEST_KEEP = 4000
const REQUEST_TRIM = 2000

/** Shortest decode window that still yields a meaningful tokens-per-second rate. */
const MIN_RATE_MS = 200

/**
 * First and last output-chunk timestamps of one assistant stream.
 *
 * Raw delta chunks carry their own session timestamp; packed text and reasoning
 * runs carry a start and inter-chunk gaps, so their end is the sum of the gaps.
 * Only visible output counts: a tool-call or block marker is not a first token.
 */
function timingOf(stream) {
  if (!Array.isArray(stream)) return null
  let first = null
  let last = null
  const note = (time) => {
    if (!(time > 0)) return
    if (first === null || time < first) first = time
    if (last === null || time > last) last = time
  }
  for (const record of stream) {
    if (record === null || typeof record !== 'object') continue
    if (record.type === 'chunk') {
      const chunk = record.chunk
      if (chunk === null || typeof chunk !== 'object') continue
      // A tool call is output too: a reply that only asks for a tool still has a
      // first token, and its arguments are billed as output tokens.
      if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' || chunk.type === 'tool-call-delta') {
        note(count(record.time))
      }
      continue
    }
    if (record.type === 'text-chunks' || record.type === 'reasoning-chunks' || record.type === 'tool-call-chunks') {
      const start = count(record.time0)
      let span = 0
      if (Array.isArray(record.dt)) for (const gap of record.dt) span += count(gap)
      note(start)
      note(start + span)
    }
  }
  return first === null ? null : { first, last: last ?? first }
}

/**
 * Build one ledger instance.
 *
 * A ledger owns the accumulated day buckets, the per-session fold bookkeeping
 * needed for sample replacement, and the one-time scan of persisted sessions.
 * The plugin creates exactly one and drops it with the plugin.
 */
export function createLedger() {
  /** Local-date key to accumulated bucket; the only long-lived usage state. */
  const days = new Map()
  /** Session id to `{ through, last }`, where `through` is the last folded sequence. */
  const sessions = new Map()
  /** Events that arrived before their session was scanned, replayed afterwards. */
  const deferred = new Map()
  /** The one running or finished backfill, so concurrent requests share it. */
  let scan = null
  /** What the ledger saw, reported beside the numbers so gaps stay visible. */
  const scanned = { samples: 0, unreadable: 0, failed: false }
  /** Per-request rows, newest kept; bounded because a long-running Host sees unbounded traffic. */
  const requests = []
  /** Hour buckets of the last few days, for a single-day chart. */
  const hours = new Map()
  /** Listeners told that a fold changed something worth re-reporting. */
  const listeners = new Set()

  /** Announce one change; a listener that throws must not break the fold. */
  function notify() {
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // A subscriber owns its own failures.
      }
    }
  }

  /** Fold bookkeeping of one session, created on first sight. */
  function ensureSession(id) {
    let entry = sessions.get(id)
    if (entry === undefined) {
      entry = { through: -1, last: null, step: null, cwd: null }
      sessions.set(id, entry)
    }
    return entry
  }

  /** The bucket of one day, created on first write. */
  function ensureDay(key) {
    let bucket = days.get(key)
    if (bucket === undefined) {
      bucket = emptyBucket()
      days.set(key, bucket)
    }
    return bucket
  }

  /** Add one sample's counts to a day, attributing the day to one session. */
  function addToDay(key, hour, buckets, sessionId, isRequest) {
    if (key === undefined) return
    const bucket = ensureDay(key)
    bucket.input += buckets.input
    bucket.cacheRead += buckets.cacheRead
    bucket.cacheWrite += buckets.cacheWrite
    bucket.output += buckets.output
    if (isRequest) bucket.requests += 1
    if (sessionId !== undefined) bucket.sessions.add(sessionId)
    if (hour === undefined) return
    let byHour = hours.get(hour)
    if (byHour === undefined) {
      byHour = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, requests: 0 }
      hours.set(hour, byHour)
      if (hours.size > HOUR_KEEP) {
        for (const old of [...hours.keys()].sort().slice(0, hours.size - HOUR_KEEP)) hours.delete(old)
      }
    }
    byHour.input += buckets.input
    byHour.cacheRead += buckets.cacheRead
    byHour.cacheWrite += buckets.cacheWrite
    byHour.output += buckets.output
    if (isRequest) byHour.requests += 1
  }

  /** Remove one replaced sample's counts from the day it was attributed to. */
  function subtractFromDay(key, hour, buckets) {
    if (key === undefined) return
    const bucket = days.get(key)
    if (bucket !== undefined) {
      bucket.input -= buckets.input
      bucket.cacheRead -= buckets.cacheRead
      bucket.cacheWrite -= buckets.cacheWrite
      bucket.output -= buckets.output
    }
    const byHour = hour === undefined ? undefined : hours.get(hour)
    if (byHour === undefined) return
    byHour.input -= buckets.input
    byHour.cacheRead -= buckets.cacheRead
    byHour.cacheWrite -= buckets.cacheWrite
    byHour.output -= buckets.output
  }

  /**
   * Append one request row, trimming occasionally so the buffer cannot grow
   * without bound on a Host that runs for weeks.
   */
  function pushRequest(record) {
    requests.push(record)
    if (requests.length <= REQUEST_KEEP) return
    requests.sort((left, right) => right.time - left.time)
    requests.length = REQUEST_TRIM
  }

  /** The provider and model one durable message names, when it names them. */
  function routeOf(event) {
    const message = event.data.message
    if (message === null || typeof message !== 'object') return { provider: null, model: null }
    const source = message.source
    if (source === null || typeof source !== 'object') return { provider: null, model: null }
    return {
      provider: typeof source.provider === 'string' ? source.provider : null,
      model: typeof source.model === 'string' ? source.model : null,
    }
  }

  /** Fold one committed event into the day buckets. */
  function fold(entry, sessionId, event) {
    if (event.type === 'step/start') {
      const data = event.data
      if (data === null || typeof data !== 'object') return
      entry.step = { turn: count(data.turn), step: count(data.step), time: count(event.time) }
      return
    }
    if (event.type === 'llm/retry-started') {
      const data = event.data
      if (entry.last === null || data === null || typeof data !== 'object') return
      if (entry.last.turn === count(data.turn) && entry.last.step === count(data.step)) entry.last = null
      return
    }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return
    const usage = sampleOf(event)
    if (usage === undefined) return
    const time = count(event.time)
    if (time <= 0) return
    const data = event.data
    const turn = count(data.turn)
    const step = count(data.step)
    const buckets = usageBuckets(usage)
    if (isEmptyBuckets(buckets)) return
    const stamp = new Date(time)
    const key = dayKeyOf(stamp)
    const hour = hourKeyOf(stamp)
    const previous = entry.last !== null && entry.last.turn === turn && entry.last.step === step
      ? entry.last
      : null
    if (previous !== null && sameBuckets(previous.buckets, buckets)) return
    if (previous !== null) subtractFromDay(previous.day, previous.hour, previous.buckets)
    addToDay(key, hour, buckets, sessionId, previous === null)
    entry.last = { turn, step, day: key, hour, buckets }
    scanned.samples += 1

    // One row per settled request. A sample that only restates its step is a
    // replacement, so it rewrites the row instead of adding another one.
    const timing = timingOf(event.data.stream)
    const stepStart = entry.step !== null && entry.step.turn === turn && entry.step.step === step
      ? entry.step.time
      : 0
    const ttftMs = timing !== null && stepStart > 0 && timing.first > stepStart ? timing.first - stepStart : null
    const decodeMs = timing !== null && timing.last > timing.first ? timing.last - timing.first : null
    const route = routeOf(event)
    const row = {
      time,
      day: key,
      session: sessionId,
      cwd: entry.cwd,
      provider: route.provider,
      model: route.model,
      input: buckets.input,
      cacheRead: buckets.cacheRead,
      cacheWrite: buckets.cacheWrite,
      output: buckets.output,
      ttftMs,
      decodeMs,
      tps: decodeMs !== null && decodeMs >= MIN_RATE_MS && buckets.output >= 10
        ? Math.round((buckets.output / (decodeMs / 1000)) * 10) / 10
        : null,
    }
    if (previous === null) {
      pushRequest(row)
    } else if (requests.length > 0) {
      requests[requests.length - 1] = row
    }
    notify()
  }

  /** Fold one event into its session, ignoring sequences already covered. */
  function append(id, event) {
    if (event === null || typeof event !== 'object') return
    const entry = ensureSession(id)
    const seq = count(event.seq)
    if (seq <= entry.through) return
    fold(entry, id, event)
    entry.through = seq
  }

  /**
   * Replay one session snapshot into the ledger.
   *
   * `inheritedEventCount` is the fork seed copied from a parent session; those
   * events were already counted for that parent, so only own events fold.
   */
  function foldSnapshot(id, snapshot) {
    const events = snapshot !== null && Array.isArray(snapshot.events) ? snapshot.events : []
    const inherited = count(Number(snapshot?.inheritedEventCount ?? 0))
    const entry = ensureSession(id)
    const header = snapshot !== null && typeof snapshot === 'object' ? snapshot.session : undefined
    if (header !== null && typeof header === 'object' && typeof header.cwd === 'string') entry.cwd = header.cwd
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index]
      if (event === null || typeof event !== 'object') continue
      const seq = count(event.seq)
      if (inherited > 0 && seq < inherited) continue
      if (seq <= entry.through) continue
      fold(entry, id, event)
      entry.through = seq
    }
  }

  /** Drain the events queued for one session before it was scanned. */
  function drainDeferred(id) {
    const queue = deferred.get(id)
    if (queue === undefined) return
    deferred.delete(id)
    for (const event of queue) append(id, event)
  }

  /**
   * Scan every persisted session once.
   *
   * The ledger is built on first use rather than at plugin load: a session is
   * read exactly once per Host process, and the live feed keeps it current
   * afterwards. Concurrent callers share the one running scan.
   */
  async function synchronize(sessionQuery) {
    if (scan !== null) return scan
    scan = (async () => {
      let records = []
      try {
        records = await sessionQuery.listSessions()
      } catch (error) {
        // A corpus that cannot be listed is a reported failure, not an empty day.
        scanned.failed = true
        return
      }
      for (const record of records) {
        const id = record !== null && typeof record === 'object' && record.header !== undefined
          ? record.header.id
          : undefined
        if (typeof id !== 'string' || id.length === 0) continue
        try {
          foldSnapshot(id, await sessionQuery.readSession(id))
        } catch (error) {
          scanned.unreadable += 1
        }
      }
      for (const id of [...deferred.keys()]) drainDeferred(id)
      notify()
    })()
    return scan
  }

  /**
   * Fold one live session event.
   *
   * Before the scan starts, events queue up so a session the scan will read is
   * not counted twice. After it, every session folds directly: a session the
   * scan already read is guarded by its `through` sequence, and a session
   * created later starts from an empty fold state.
   */
  function observe(session, event) {
    if (session === null || typeof session !== 'object') return
    if (event === null || typeof event !== 'object') return
    const id = session.id
    if (typeof id !== 'string' || id.length === 0) return
    const header = session.header
    if (header !== null && typeof header === 'object' && typeof header.cwd === 'string') {
      const known = sessions.get(id)
      if (known !== undefined) known.cwd = header.cwd
    }
    if (scan === null) {
      let queue = deferred.get(id)
      if (queue === undefined) {
        queue = []
        deferred.set(id, queue)
      }
      queue.push(event)
      // The scan re-reads a session it can read, so a parked event only matters
      // for one it cannot: bound the parking instead of the process memory.
      if (queue.length > DEFERRED_LIMIT) queue.splice(0, queue.length - DEFERRED_LIMIT)
      return
    }
    append(id, event)
  }

  /** One day's numbers in the wire shape the browser reads. */
  function summarize(key) {
    const bucket = days.get(key)
    if (bucket === undefined) {
      return { date: key, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, prompt: 0, total: 0, requests: 0, sessions: 0 }
    }
    const prompt = bucket.input + bucket.cacheRead + bucket.cacheWrite
    return {
      date: key,
      input: bucket.input,
      cacheRead: bucket.cacheRead,
      cacheWrite: bucket.cacheWrite,
      output: bucket.output,
      prompt,
      total: prompt + bucket.output,
      requests: bucket.requests,
      sessions: bucket.sessions.size,
    }
  }

  /**
   * Build the report for one history window.
   *
   * Days run oldest first and are continuous, so a chart can render the window
   * without filling gaps itself; a day without usage reports zeros.
   */
  /** One day's hour buckets, zero-filled to 24 entries. */
  function hourlyOf(dayKey) {
    const list = []
    for (let hour = 0; hour < 24; hour += 1) {
      const bucket = hours.get(`${dayKey}T${String(hour).padStart(2, '0')}`)
      const input = bucket === undefined ? 0 : bucket.input
      const cacheRead = bucket === undefined ? 0 : bucket.cacheRead
      const cacheWrite = bucket === undefined ? 0 : bucket.cacheWrite
      const output = bucket === undefined ? 0 : bucket.output
      const prompt = input + cacheRead + cacheWrite
      list.push({
        hour,
        input,
        cacheRead,
        cacheWrite,
        output,
        prompt,
        total: prompt + output,
        requests: bucket === undefined ? 0 : bucket.requests,
      })
    }
    return list
  }

  /**
   * Resolve the requested range into two day keys.
   *
   * `from`/`to` win when both parse as local day keys; otherwise the legacy
   * `windowDays` count produces the range ending today. A reversed pair is read
   * the way it was meant, and a range wider than a year keeps its newest end.
   */
  function resolveRange({ from, to, windowDays, now }) {
    const today = dayKeyOf(new Date(now))
    const end = parseDayKey(to) === null ? today : to
    const requested = parseDayKey(from) === null ? shiftDayKey(end, -(clampWindow(windowDays) - 1)) : from
    const low = requested <= end ? requested : end
    const high = requested <= end ? end : requested
    const floor = shiftDayKey(high, -(MAX_RANGE_DAYS - 1))
    return { from: low < floor ? floor : low, to: high }
  }

  /**
   * Build the report for one day range.
   *
   * Days run oldest first and are continuous, so a chart can render the range
   * without filling gaps itself; a day without usage reports zeros. A range of
   * one day also carries its 24 hour buckets, which is what a single-day chart
   * wants. Request rows are newest first and already filtered to the range.
   */
  function report({ from, to, windowDays, requestLimit = 100, now = Date.now() } = {}) {
    const rowLimit = Math.min(500, Math.max(1, Math.trunc(requestLimit)))
    const today = dayKeyOf(new Date(now))
    const range = resolveRange({ from, to, windowDays, now })
    const days = []
    for (let key = range.from; ; key = shiftDayKey(key, 1)) {
      days.push(summarize(key))
      if (key >= range.to || days.length >= MAX_RANGE_DAYS) break
    }
    return {
      generatedAt: now,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      today,
      range,
      windowDays: days.length,
      days,
      // Today's own bucket, independent of the selected range: the bottom bar
      // stays a live "right now" strip whatever range the page is showing.
      todayRow: summarize(today),
      hourly: range.from === range.to ? hourlyOf(range.from) : [],
      // `sessions` is every session the ledger holds a fold for: the scanned
      // corpus plus anything that started after the scan. `samples` counts the
      // provider usage records folded so far, live ones included.
      scanned: {
        sessions: sessions.size,
        samples: scanned.samples,
        unreadable: scanned.unreadable,
        failed: scanned.failed,
      },
      // Newest first. Rows are per settled request, so a client can render a
      // live log without replaying anything.
      requests: requests.slice()
        .filter((row) => row.day >= range.from && row.day <= range.to)
        .sort((left, right) => right.time - left.time)
        .slice(0, rowLimit)
        .map((row) => ({ ...row })),
    }
  }

  /** Subscribe to fold changes; the disposer stops the subscription. */
  function subscribe(listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  return { synchronize, observe, report, subscribe }
}
