/**
 * Host half of the usage statistics bundle.
 *
 * It owns two things: the usage ledger (see `./ledger.js`), which folds
 * provider-reported token counts from every durable session log into per-day
 * buckets and per-request rows, and the two read-only routes the browser half
 * uses.
 *
 * `/report` answers one snapshot. `/stream` holds one NDJSON connection open and
 * pushes a fresh snapshot whenever the ledger changes, which is what makes the
 * page update on activity instead of on a timer. Both routes live under the
 * shared `/api` channel, so the connection layer authenticates the caller before
 * the handler runs.
 */
import { TOKEN_REPORT_PATH, TOKEN_STREAM_PATH, clampWindow, createLedger } from './ledger.js'

export const name = 'usage-statistics'

/** Both halves are needed: the session corpus to read, the connection to serve. */
export const inject = ['connection', 'sessionQuery']

/** Coalescing window for change pushes: a burst of requests arrives as one snapshot. */
const FLUSH_MS = 400

/** How often an idle stream proves it is still alive. */
const HEARTBEAT_MS = 20000

/**
 * Read the range, row limit, and form of one request from its URL.
 * @param url - request URL carrying `from`/`to` day keys or a `days` count.
 * @returns the arguments `ledger.report` takes.
 */
function rangeOf(url) {
  const requestLimit = Number.parseInt(url.searchParams.get('rows') ?? '100', 10)
  return {
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    windowDays: clampWindow(url.searchParams.get('days') ?? '30'),
    requestLimit: Number.isFinite(requestLimit) ? requestLimit : 100,
  }
}

/**
 * Register the live usage feed, the snapshot route, and the stream route.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  const ledger = createLedger()
  /** One open stream: `push` sends a snapshot, `close` ends it. */
  const streams = new Set()
  let flushTimer = null

  const flush = () => {
    flushTimer = null
    for (const stream of [...streams]) {
      // One broken subscriber must not silence the others.
      try {
        stream.push()
      } catch {
        stream.close()
      }
    }
  }

  // A burst of folds (one turn appends several events) becomes one push.
  const schedule = () => {
    if (flushTimer !== null) return
    flushTimer = setTimeout(flush, FLUSH_MS)
  }

  ctx.effect(() => ledger.subscribe(schedule), 'usage-statistics: change feed')
  ctx.effect(() => () => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    for (const stream of [...streams]) stream.close()
  }, 'usage-statistics: open streams')

  // One committed event at a time: the ledger folds it into the day it belongs
  // to, so the page stays current without re-reading a session log.
  ctx.on('session/event', (session, event) => {
    ledger.observe(session, event)
  })

  ctx.effect(
    () => ctx.connection.fetch.register({
      path: TOKEN_REPORT_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const range = rangeOf(new URL(request.url))
        await ledger.synchronize(ctx.sessionQuery)
        const report = ledger.report(range)
        const headers = {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        }
        // A corpus that could not be listed is a failed read, not an empty day:
        // answer with an error so the page states what happened.
        if (report.scanned.failed) {
          return new Response(JSON.stringify({ error: 'the local session corpus could not be listed' }), {
            status: 503,
            headers,
          })
        }
        return new Response(JSON.stringify(report), { headers })
      },
    }),
    'usage-statistics: report route',
  )

  ctx.effect(
    () => ctx.connection.fetch.register({
      path: TOKEN_STREAM_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const range = rangeOf(new URL(request.url))
        await ledger.synchronize(ctx.sessionQuery)
        const encoder = new TextEncoder()
        let controller = null
        let closed = false
        let heartbeat = null

        const cleanup = () => {
          if (closed) return
          closed = true
          streams.delete(entry)
          if (heartbeat !== null) {
            clearInterval(heartbeat)
            heartbeat = null
          }
        }

        const write = (payload) => {
          if (closed || controller === null) return
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`))
          } catch {
            cleanup()
          }
        }

        const entry = {
          push: () => write({ type: 'snapshot', report: ledger.report(range) }),
          close: () => {
            cleanup()
            try {
              if (controller !== null) controller.close()
            } catch {
              // A controller already closed by the reader is fine.
            }
          },
        }

        const stream = new ReadableStream({
          start(value) {
            controller = value
            streams.add(entry)
            entry.push()
            heartbeat = setInterval(() => write({ type: 'ping' }), HEARTBEAT_MS)
            request.signal?.addEventListener('abort', () => entry.close(), { once: true })
          },
          cancel() {
            cleanup()
            controller = null
          },
        })

        return new Response(stream, {
          headers: {
            'content-type': 'application/x-ndjson; charset=utf-8',
            // `no-transform` keeps the compression middleware from buffering
            // frames, and the proxy hint keeps an intermediary from doing the
            // same: either one would turn this push channel into a batch.
            'cache-control': 'no-store, no-transform',
            'x-accel-buffering': 'no',
          },
        })
      },
    }),
    'usage-statistics: stream route',
  )
}
