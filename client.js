/**
 * Browser half of the daily token usage bundle.
 *
 * It contributes two slot entries: the icon in the left rail's panel list and
 * the page it opens in the main column. The page reads its numbers from the
 * Host route the other half registers, so nothing here replays a session log.
 */
window.__ModuleLoader__.load({
  id: '@local/token-usage-daily',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'token-usage-daily'

    /** The push route: one NDJSON connection the Host writes snapshots into. */
    const STREAM_ROUTE = 'api/token-usage-daily/stream'

    /** Panel id: the rail entry address, which is also the `main` dispatch key. */
    const PANEL_ID = 'token-usage'

    /** How long to wait before reopening a closed stream. */
    const RECONNECT_MS = 1500

    /** Silence this long means the push channel died: the Host pings every 20s. */
    const IDLE_MS = 45000

    /** Dwell before a histogram column explains itself. */
    const TIP_DELAY_MS = 1000

    /** How many request rows one report carries. */
    const ROW_LIMIT = 100

    /** English copy; also the fallback for a language this namespace lacks. */
    const EN = {
      panel: 'Usage statistics',
      title: 'Usage statistics',
      subtitle: 'Provider-reported usage of every local session, grouped by {zone} local date.',
      subtitlePlain: 'Provider-reported usage of every local session.',
      rangeLabel: 'History window',
      rangeToday: 'Today',
      range7: 'Last 7 days',
      range30: 'Last 30 days',
      rangeCustom: 'Custom',
      rangeFrom: 'From',
      rangeTo: 'To',
      rangeInvalid: 'The start date is after the end date',
      cardRangeTotal: 'Range total',
      cardRequests: 'Requests',
      cardAverage: 'Average {value} tokens per request',
      refresh: 'Refresh',
      cardToday: 'Today',
      cardYesterday: 'Yesterday',
      cardWindow: 'Last {days} days',
      cardSplit: 'New input {input} · Cache {cache} · Output {output}',
      cardHitRate: 'Cache hit rate',
      hitSplit: 'Cache read {cache} · Prompt side {prompt}',
      tableHit: 'Cache hit',
      chartTitle: 'Daily total',
      chartHourly: 'Tokens · by hour',
      chartPeak: 'Peak {value}',
      legendInput: 'Cache miss',
      legendCache: 'Cache hit',
      legendOutput: 'Output',
      tableDate: 'Date',
      tableInput: 'New input',
      tableCacheRead: 'Cache read',
      tableCacheWrite: 'Cache write',
      tableOutput: 'Output',
      tableTotal: 'Total',
      tableSessions: 'Sessions',
      dayToday: 'Today',
      loading: 'Reading session logs…',
      empty: 'No token usage recorded in this window yet.',
      error: 'Could not read the usage report: {message}',
      scanFailed: 'Could not read the local session logs, so there is nothing to report yet.',
      retry: 'Try again',
      refreshFailed: 'Refresh failed ({message}); showing the last report.',
      updated: 'Updated {time}',
      scope: '{sessions} sessions · {samples} usage records',
      unreadable: '{unreadable} unreadable',
      statusLabel: 'Live totals',
      statusRequests: 'Requests',
      logTitle: 'Request log',
      logLive: 'Live · updated {time}',
      logStale: 'Reconnecting…',
      logNote: 'No price table, so no cost column',
      logEmpty: 'No requests recorded yet.',
      logJump: '↑ New requests',
      colTime: 'Time',
      colDir: 'Directory',
      colProvider: 'Provider',
      colModel: 'Model',
      colSpeed: 'Speed',
      colTtft: 'First token',
      statusTotal: 'Total',
      statusInput: 'New input',
      statusCache: 'Cache',
      statusOutput: 'Output',
      statusHit: 'Cache hit',
      statusWindow: 'Last {days} days {total} · {hit}',
      sourcesTitle: 'Where these numbers come from',
      sourcesWhat: 'Usage: the usage block every model reply writes into the session log, reported by the provider. New input is the uncached part of the prompt; cache reads and writes are separate; a total adds all four counts with output.',
      sourcesWhere: 'Files: each session under ~/.dsh/sessions, read through the Host session query (the plugin never unpacks or parses a log itself). Once the page is open, new replies arrive live from the session event feed.',
      sourcesRules: 'Counting rules: a streamed sample is replaced by its settlement, a retried attempt counts separately, a fork does not re-count inherited history, and subagent sessions are included.',
      sourcesCheck: 'Checked: for every record carrying a provider total, the four-count sum equals that total exactly.',
      sourcesGaps: 'Gaps: a reply without a usage report adds nothing; usage lands on the day the reply settled, so a request spanning midnight counts on the next day; sessions written by another process need a restart to appear; cache fields exist only when the provider reports them.',
      footnote: 'Counts are the usage each model reply reports; a reply without a usage report contributes nothing. A total adds new input, cache reads, cache writes, and output, so a prompt reused from cache is counted once per reply. The cache hit rate is cache reads divided by prompt-side tokens (new input + cache reads + cache writes), so a day without a usage report shows no rate. A session forked from another one does not count the inherited history again.',
    }

    /** Chinese copy. */
    const ZH = {
      panel: '用量统计',
      title: '用量统计',
      subtitle: '汇总本机所有会话的模型用量，按 {zone} 本地日期归并。',
      subtitlePlain: '汇总本机所有会话的模型用量。',
      rangeLabel: '时间范围',
      rangeToday: '今天',
      range7: '近 7 天',
      range30: '近 30 天',
      rangeCustom: '自定义',
      rangeFrom: '开始',
      rangeTo: '结束',
      rangeInvalid: '开始日期晚于结束日期',
      cardRangeTotal: '时间范围合计',
      cardRequests: '请求数',
      cardAverage: '平均每次请求 {value} token',
      refresh: '刷新',
      cardToday: '今天',
      cardYesterday: '昨天',
      cardWindow: '近 {days} 天',
      cardSplit: '新输入 {input} · 缓存 {cache} · 输出 {output}',
      cardHitRate: '缓存命中率',
      hitSplit: '缓存读取 {cache} · 提示侧 {prompt}',
      tableHit: '缓存命中',
      chartTitle: '每日合计',
      chartHourly: 'Tokens · 按小时',
      chartPeak: '峰值 {value}',
      legendInput: '未命中',
      legendCache: '命中',
      legendOutput: '输出',
      tableDate: '日期',
      tableInput: '新输入',
      tableCacheRead: '缓存读取',
      tableCacheWrite: '缓存写入',
      tableOutput: '输出',
      tableTotal: '合计',
      tableSessions: '会话',
      dayToday: '今天',
      loading: '正在读取会话日志…',
      empty: '这个时间范围内还没有记录到用量。',
      error: '读取用量报告失败：{message}',
      scanFailed: '读不到本机会话日志，暂时没有可统计的数据。',
      retry: '重试',
      refreshFailed: '刷新失败（{message}），显示上一次的结果。',
      updated: '{time} 更新',
      scope: '{sessions} 个会话 · {samples} 条用量记录',
      unreadable: '{unreadable} 个读取失败',
      statusLabel: '汇总数字',
      statusRequests: '请求',
      logTitle: '请求日志',
      logLive: '实时 · {time} 更新',
      logStale: '连接断开，重连中…',
      logNote: '未接价格表，不显示成本',
      logEmpty: '还没有请求记录。',
      logJump: '↑ 有新请求',
      colTime: '时间',
      colDir: '目录',
      colProvider: '供应商',
      colModel: '模型',
      colSpeed: '速度',
      colTtft: '首字',
      statusTotal: '合计',
      statusInput: '新输入',
      statusCache: '缓存',
      statusOutput: '输出',
      statusHit: '缓存命中',
      statusWindow: '近 {days} 天 {total} · {hit}',
      sourcesTitle: '数据来源与口径',
      sourcesWhat: '用量：会话日志里每次模型回复记录的 usage，由服务商返回。新输入是提示里未命中缓存的部分，缓存读写另计；合计把四项相加（含输出）。',
      sourcesWhere: '文件：~/.dsh/sessions 下的各会话日志，通过 Host 的会话查询接口读取（插件不自己解压、不自己解析日志）。页面打开后，新的回复通过会话事件实时进来。',
      sourcesRules: '口径：同一步的流式样本被最终结算值替换，重试单独计一次，分叉会话不重复计继承历史，子智能体会话计入。',
      sourcesCheck: '核对：凡是带服务商 totalTokens 的记录，四项之和与它逐条完全相等。',
      sourcesGaps: '缺口：没有上报 usage 的回复不计入；用量落在回复落地的当天，跨午夜的请求会算到次日；其它进程写入的会话要重启后才出现；缓存字段只在服务商上报时存在。',
      footnote: '数字来自每次模型回复上报的用量；没有上报用量的回复不计入。合计＝新输入＋缓存读取＋缓存写入＋输出，复用了缓存的提示按每次回复各计一次。缓存命中率＝缓存读取 ÷ 提示侧 token（新输入＋缓存读取＋缓存写入），没有上报用量的日子不显示命中率。从其他会话分叉出来的会话不重复计入继承的历史。',
    }

    /** Compact count for cards and bars: 1234 becomes "1.2K". */
    function compact(value) {
      const abs = Math.abs(value)
      if (abs >= 1000000) return `${(value / 1000000).toFixed(abs >= 10000000 ? 0 : 1)}M`
      if (abs >= 1000) return `${(value / 1000).toFixed(abs >= 10000 ? 0 : 1)}K`
      return String(value)
    }

    /** Exact count for table cells and tooltips. */
    function exact(value) {
      return Number(value).toLocaleString()
    }

    /** Share of prompt tokens that came from cache, or null when nothing was prompted. */
    function hitRate(cacheRead, prompt) {
      if (!(prompt > 0)) return null
      return Math.min(1, cacheRead / prompt)
    }

    /** `0.993` reads as `99.3%`; an unknown rate reads as an em dash. */
    function percent(value) {
      if (value === null) return '—'
      const rounded = Math.round(value * 1000) / 10
      return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`
    }

    /** Stand-in for a day the report does not carry, so a card never reads undefined. */
    const EMPTY_DAY = { date: '', input: 0, cacheRead: 0, cacheWrite: 0, prompt: 0, output: 0, total: 0 }

    /** `MM-DD` of a `YYYY-MM-DD` key. */
    function shortDate(key) {
      return key.slice(5)
    }

    /** `HH:mm:ss` of one epoch-millisecond timestamp, in 24-hour local time. */
    function clock(time) {
      const date = new Date(time)
      const pad = (value) => String(value).padStart(2, '0')
      return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    }

    /** Last path segment of a session directory, else the tail of its id. */
    function directoryOf(row) {
      if (typeof row.cwd === 'string' && row.cwd.length > 0) {
        const parts = row.cwd.split(/[\\/]/).filter((part) => part.length > 0)
        return parts.length === 0 ? row.cwd : parts[parts.length - 1]
      }
      return typeof row.session === 'string' ? row.session.slice(-6) : '—'
    }

    /** Days a preset covers; a custom range is sent as its two day keys. */
    function rangeQuery(preset, custom) {
      if (preset === 'custom' && custom.from.length > 0 && custom.to.length > 0) {
        return `from=${encodeURIComponent(custom.from)}&to=${encodeURIComponent(custom.to)}`
      }
      const days = preset === 'today' ? 1 : preset === 'last30' ? 30 : 7
      return `days=${days}`
    }

    /**
     * Follow the Host's snapshot stream until it ends or `signal` aborts.
     *
     * The Host writes one JSON object per line: a `snapshot` per change and a
     * `ping` when nothing is happening. Only snapshots reach the caller, so the
     * page updates when a request settles rather than on a timer.
     */
    async function followReport(query, signal, onReport) {
      const url = new URL(`${STREAM_ROUTE}?${query}&rows=${ROW_LIMIT}`, document.baseURI)
      const carrier = globalThis.__DSH_TRANSPORT__
      const response = carrier !== undefined && typeof carrier.fetch === 'function'
        ? await carrier.fetch(url.href, { method: 'GET', signal })
        : await fetch(url, {
          method: 'GET',
          signal,
          credentials: 'same-origin',
          headers: { accept: 'application/x-ndjson' },
        })
      if (!response.ok) throw new Error(await failureOf(response))
      if (response.body === null) throw new Error('the stream carried no body')
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      // A frame every few seconds when something happens, a ping every 20s when
      // nothing does; a longer silence means the connection is dead, not quiet.
      const readWithDeadline = async () => {
        let timer = null
        try {
          return await Promise.race([
            reader.read(),
            new Promise((_resolve, reject) => {
              timer = setTimeout(() => reject(new Error('the update stream went quiet')), IDLE_MS)
            }),
          ])
        } finally {
          if (timer !== null) clearTimeout(timer)
        }
      }
      let buffer = ''
      try {
        for (;;) {
          const { done, value } = await readWithDeadline()
          if (done) return
          buffer += value
          for (let index = buffer.indexOf('\n'); index >= 0; index = buffer.indexOf('\n')) {
            const line = buffer.slice(0, index).trim()
            buffer = buffer.slice(index + 1)
            if (line.length === 0) continue
            let message
            try {
              message = JSON.parse(line)
            } catch {
              continue
            }
            if (message !== null && typeof message === 'object' && message.type === 'snapshot') {
              onReport(message.report)
            }
          }
        }
      } finally {
        void reader.cancel().catch(() => {})
      }
    }

    /** The Host's stated reason for a failed report, else the status line. */
    async function failureOf(response) {
      try {
        const body = await response.json()
        if (body !== null && typeof body === 'object' && typeof body.error === 'string') return body.error
      } catch {}
      return `HTTP ${response.status}`
    }

    /** Sum one field over a day list. */
    function sum(days, field) {
      let total = 0
      for (const day of days) total += day[field]
      return total
    }

    /** One headline figure. */
    function Card({ label, total, input, cache, output, sub, t }) {
      return h('article', { className: 'tud-card' },
        h('div', { className: 'tud-card-label' }, label),
        h('div', { className: 'tud-card-value', title: exact(total) }, compact(total)),
        h('div', { className: 'tud-card-sub' }, sub ?? t('cardSplit', {
          input: compact(input),
          cache: compact(cache),
          output: compact(output),
        })),
      )
    }

    /** One ratio figure: the window's cache hit rate beside the two counts it divides. */
    function RateCard({ label, rate, cacheRead, prompt, t }) {
      return h('article', { className: 'tud-card' },
        h('div', { className: 'tud-card-label' }, label),
        h('div', { className: 'tud-card-value', title: percent(rate) }, percent(rate)),
        h('div', { className: 'tud-card-sub' }, t('hitSplit', {
          cache: compact(cacheRead),
          prompt: compact(prompt),
        })),
      )
    }

    /**
     * One column of the histogram: new input, cache traffic, and output stacked
     * bottom-up, with the column's height standing for its share of the busiest
     * slot in the window.
     */
    function Column({ slot, label, caption, max, isToday, t, onHover, onLeave }) {
      const total = slot.total
      const height = max === 0 ? 0 : (total / max) * 100
      const share = (value) => (total === 0 ? 0 : (value / total) * 100)
      const rate = percent(hitRate(slot.cacheRead, slot.prompt))
      const title = `${label} · ${exact(total)} · ${t('tableHit')} ${rate}`
      // Rendered top-down, so output sits above cache above new input.
      const segments = [
        ['tud-bar-output', share(slot.output)],
        ['tud-bar-cache', share(slot.cacheRead + slot.cacheWrite)],
        ['tud-bar-input', share(slot.input)],
      ]
      return h('div', {
        className: isToday ? 'tud-col tud-is-today' : 'tud-col',
        role: 'img',
        title,
        'aria-label': `${label}: ${exact(total)} · ${t('tableHit')} ${rate}`,
        onMouseEnter: onHover,
        onMouseLeave: onLeave,
      },
      h('div', { className: 'tud-col-plot' },
        h('div', { className: 'tud-col-stack', style: { height: `${height}%` } },
          segments.map(([className, heightShare]) => heightShare > 0
            ? h('span', { key: className, className, style: { height: `${heightShare}%` } })
            : null)),
      ),
      h('div', { className: 'tud-col-label' }, caption),
      )
    }

    /** The panel page: headline figures, a daily chart, and the day table. */
    function TokenUsagePage(props) {
      const { t, subscribeLocale } = props
      // `preset` picks a shorthand window; `custom` holds the two day keys a
      // custom range was applied with. Either way the Host resolves the range.
      const [preset, setPreset] = React.useState('last7')
      const [custom, setCustom] = React.useState({ from: '', to: '' })
      // `manual` drives the spinner: a background poll must not flash the button.
      const [reload, setReload] = React.useState({ count: 0, manual: false })
      const [state, setState] = React.useState({ status: 'loading', busy: true })
      // The log follows the newest request unless the reader scrolled away; then
      // it offers a way back instead of yanking the viewport.
      const chartRef = React.useRef(null)
      const tipTimer = React.useRef(null)
      // The histogram tooltip: the native title waits too long to be useful.
      const [tip, setTip] = React.useState(null)
      const logRef = React.useRef(null)
      const newestRef = React.useRef('')
      const [pending, setPending] = React.useState(0)
      // The dictionaries live in the locale service, so a language switch has
      // to re-render text that was already painted.
      const [, bumpLocale] = React.useReducer((value) => value + 1, 0)
      React.useEffect(() => subscribeLocale(() => bumpLocale()), [subscribeLocale])
      React.useEffect(() => {
        const controller = new AbortController()
        let live = true
        let reconnect = null
        // A reopen keeps the figures on screen; only the first load is blank.
        setState((previous) => previous.status === 'ready'
          ? { status: 'ready', data: previous.data, busy: reload.manual === true }
          : { status: 'loading', busy: true })
        const connect = () => {
          followReport(rangeQuery(preset, custom), controller.signal, (report) => {
            if (!live) return
            setState((previous) => ({
              status: 'ready',
              data: report,
              busy: false,
              // Everything newer than the newest request already on screen is a
              // row that just arrived and should announce itself. Infinity means
              // nothing was on screen yet, so a first paint marks nothing.
              freshAfter: previous.status === 'ready' && previous.data.requests.length > 0
                ? previous.data.requests[0].time
                : Number.POSITIVE_INFINITY,
            }))
          }).then(
            () => {
              if (live) reconnect = setTimeout(connect, RECONNECT_MS)
            },
            (error) => {
              if (!live || controller.signal.aborted) return
              const message = error instanceof Error ? error.message : String(error)
              setState((previous) => previous.status === 'ready'
                ? { status: 'ready', data: previous.data, busy: false, stale: message }
                : { status: 'error', message, busy: false })
              reconnect = setTimeout(connect, RECONNECT_MS)
            },
          )
        }
        connect()
        return () => {
          live = false
          if (reconnect !== null) clearTimeout(reconnect)
          controller.abort()
        }
      }, [preset, custom, reload])

      // Returning to the tab asks for a fresh snapshot: a backgrounded page may
      // have lost its channel while the browser throttled it.
      React.useEffect(() => {
        const wake = () => {
          if (document.visibilityState === 'visible') {
            setReload((value) => ({ count: value.count + 1, manual: false }))
          }
        }
        document.addEventListener('visibilitychange', wake)
        window.addEventListener('focus', wake)
        return () => {
          document.removeEventListener('visibilitychange', wake)
          window.removeEventListener('focus', wake)
        }
      }, [])

      const closeTip = () => {
        if (tipTimer.current !== null) {
          clearTimeout(tipTimer.current)
          tipTimer.current = null
        }
        setTip(null)
      }

      const openTip = (event, slot, label) => {
        const node = event.currentTarget
        const place = () => {
          const chart = chartRef.current
          if (node === null || chart === null) return
          const rect = node.getBoundingClientRect()
          const base = chart.getBoundingClientRect()
          const top = rect.top - base.top
          setTip({
            key: label,
            label,
            slot,
            left: rect.left - base.left + rect.width / 2,
            top,
            // Above the column normally, below it when there is no room up top.
            below: top < 150,
          })
        }
        // Once a tooltip is up, moving across the chart follows the cursor at once.
        if (tip !== null) {
          if (tipTimer.current !== null) clearTimeout(tipTimer.current)
          tipTimer.current = null
          place()
          return
        }
        if (tipTimer.current !== null) clearTimeout(tipTimer.current)
        tipTimer.current = setTimeout(() => {
          tipTimer.current = null
          place()
        }, TIP_DELAY_MS)
      }

      React.useEffect(() => () => {
        if (tipTimer.current !== null) clearTimeout(tipTimer.current)
      }, [])

      const retry = () => setReload((value) => ({ count: value.count + 1, manual: true }))
      const retryButton = h('button', { type: 'button', className: 'tud-text-button', onClick: retry }, t('retry'))

      function failure(message) {
        return h('div', { className: 'tud-state' },
          h('p', { className: 'tud-state-error' }, message),
          retryButton,
        )
      }

      const data = state.status === 'ready' ? state.data : undefined
      const days = data === undefined ? [] : data.days
      const todayRow = data === undefined || data.todayRow === undefined ? EMPTY_DAY : data.todayRow
      const hourly = data === undefined ? [] : data.hourly ?? []
      const byHour = hourly.length === 24
      const windowTotal = sum(days, 'total')
      const windowInput = sum(days, 'input')
      const windowCacheRead = sum(days, 'cacheRead')
      const windowCacheWrite = sum(days, 'cacheWrite')
      const windowOutput = sum(days, 'output')
      const windowPrompt = sum(days, 'prompt')
      const max = (byHour ? hourly : days).reduce((value, slot) => Math.max(value, slot.total), 0)
      // Newest on the right, like a clock: hours run 00..23, days run oldest..today.
      const plotSlots = byHour
        ? hourly.map((slot) => {
          const label = `${String(slot.hour).padStart(2, '0')}:00`
          return { slot, key: `h${slot.hour}`, label, caption: label }
        })
        : days.map((slot) => ({
          slot,
          key: slot.date,
          label: slot.date,
          caption: slot.date === data.today ? t('dayToday') : shortDate(slot.date),
        }))
      // A caption every few columns keeps 24 hours or 30 days readable; the
      // tooltip and the accessible name always carry the exact slot.
      const stride = Math.max(1, Math.ceil(plotSlots.length / 8))
      for (let index = 0; index < plotSlots.length; index += 1) {
        if (index % stride !== 0 && index !== plotSlots.length - 1) plotSlots[index].caption = ''
      }
      const used = days.filter((day) => day.total > 0).reverse()
      const zone = data === undefined ? '' : data.timeZone
      // A corpus that could not be read must not read as "you used nothing".
      const scanFailed = data !== undefined
        && (data.scanned.failed === true || (data.scanned.sessions === 0 && data.scanned.unreadable > 0))
      // `samples` replaced `events` in the report; a Host generation that still
      // ships the older field keeps the page readable across a plugin update.
      const samples = data === undefined ? 0 : data.scanned.samples ?? data.scanned.events ?? 0
      const meta = data === undefined || scanFailed ? '' : [
        `${data.range.from} → ${data.range.to}`,
        t('updated', { time: clock(data.generatedAt) }),
        t('scope', { sessions: exact(data.scanned.sessions), samples: exact(samples) }),
        data.scanned.unreadable > 0 ? t('unreadable', { unreadable: exact(data.scanned.unreadable) }) : '',
      ].filter((part) => part.length > 0).join(' · ')

      // The bottom bar restates today's split; it reads the same fold, so it
      // is declared after the scan verdict it keys off.
      const statusItems = data === undefined || scanFailed
        ? []
        : [
          [t('statusTotal'), exact(todayRow.total)],
          [t('statusInput'), exact(todayRow.input)],
          [t('statusCache'), exact(todayRow.cacheRead + todayRow.cacheWrite)],
          [t('statusOutput'), exact(todayRow.output)],
          [t('statusHit'), percent(hitRate(todayRow.cacheRead, todayRow.prompt))],
          [t('statusRequests'), exact(todayRow.requests)],
        ]
      const statusWindow = data === undefined || scanFailed
        ? ''
        : t('statusWindow', {
          days: data.windowDays,
          total: exact(windowTotal),
          hit: percent(hitRate(windowCacheRead, windowPrompt)),
        })
      const windowRequests = sum(days, 'requests')
      const firstDay = days.length === 0 ? '' : days[0].date
      const logRows = data === undefined || scanFailed
        ? []
        : (data.requests ?? []).filter((row) => typeof row.day === 'string' && row.day >= firstDay)
      const freshAfter = state.status === 'ready' && typeof state.freshAfter === 'number'
        ? state.freshAfter
        : Number.POSITIVE_INFINITY

      const newestKey = logRows.length === 0 ? '' : `${logRows[0].session}-${logRows[0].time}`
      React.useEffect(() => {
        if (newestKey === '') return
        const previous = newestRef.current
        newestRef.current = newestKey
        if (previous === '' || previous === newestKey) return
        const node = logRef.current
        if (node !== null && node.scrollTop > 4) setPending((value) => value + 1)
      }, [newestKey])

      const body = state.status === 'error'
        ? failure(t('error', { message: state.message }))
        : state.status === 'loading'
          ? h('div', { className: 'tud-state' }, t('loading'))
          : scanFailed
            ? failure(t('scanFailed'))
            : h(React.Fragment, null,
              state.stale === undefined
                ? null
                : h('p', { className: 'tud-notice' }, t('refreshFailed', { message: state.stale })),
              h('div', { className: 'tud-cards' },
                h(Card, {
                  label: t('cardRangeTotal'),
                  total: windowTotal,
                  input: windowInput,
                  cache: windowCacheRead + windowCacheWrite,
                  output: windowOutput,
                  t,
                }),
                h(Card, {
                  label: t('cardRequests'),
                  total: windowRequests,
                  sub: t('cardAverage', {
                    value: windowRequests === 0 ? 0 : Math.round(windowTotal / windowRequests),
                  }),
                  t,
                }),
                h(RateCard, {
                  label: t('cardHitRate'),
                  rate: hitRate(windowCacheRead, windowPrompt),
                  cacheRead: windowCacheRead,
                  prompt: windowPrompt,
                  t,
                }),
              ),

              h('section', { className: 'tud-panel', 'aria-label': byHour ? t('chartHourly') : t('chartTitle') },
                h('div', { className: 'tud-panel-head' },
                  h('h2', { className: 'tud-panel-title' }, byHour ? t('chartHourly') : t('chartTitle')),
                  h('div', { className: 'tud-legend' },
                    h('span', null, h('i', { className: 'tud-legend-input' }), t('legendInput')),
                    h('span', null, h('i', { className: 'tud-legend-cache' }), t('legendCache')),
                    h('span', null, h('i', { className: 'tud-legend-output' }), t('legendOutput')),
                    max === 0 ? null : h('span', { className: 'tud-peak' }, t('chartPeak', { value: compact(max) })),
                  ),
                ),
                max === 0
                  ? h('div', { className: 'tud-state' }, t('empty'))
                  : h('div', { className: 'tud-chart-wrap', ref: chartRef },
                    h('div', { className: 'tud-chart' },
                      plotSlots.map(({ slot, key, label, caption }) => h(Column, {
                        key,
                        slot,
                        label,
                        caption,
                        max,
                        isToday: byHour ? slot.hour === new Date(data.generatedAt).getHours() : slot.date === data.today,
                        t,
                        onHover: (event) => openTip(event, slot, label),
                        onLeave: closeTip,
                      }))),
                    tip === null
                      ? null
                      : h('div', {
                        className: 'tud-tip',
                        style: {
                          left: `${tip.left}px`,
                          top: `${tip.top}px`,
                          transform: tip.below ? 'translate(-50%, 8px)' : 'translate(-50%, calc(-100% - 8px))',
                        },
                      },
                        h('div', { className: 'tud-tip-title' }, tip.label),
                        h('div', null, `${t('tableTotal')} ${exact(tip.slot.total)}`),
                        h('div', null, `${t('tableInput')} ${exact(tip.slot.input)}`),
                        h('div', null, `${t('tableCacheRead')} ${exact(tip.slot.cacheRead + tip.slot.cacheWrite)}`),
                        h('div', null, `${t('tableOutput')} ${exact(tip.slot.output)}`),
                        h('div', null, `${t('tableHit')} ${percent(hitRate(tip.slot.cacheRead, tip.slot.prompt))}`),
                        h('div', null, `${t('statusRequests')} ${exact(tip.slot.requests ?? 0)}`),
                      ),
                  ),
              ),

              h('section', { className: 'tud-panel', 'aria-label': t('logTitle') },
                h('div', { className: 'tud-panel-head' },
                  h('h2', { className: 'tud-panel-title' },
                    t('logTitle'),
                    h('span', { className: 'tud-badge', title: t('statusRequests') }, exact(windowRequests)),
                  ),
                  h('div', { className: 'tud-legend' },
                    h('span', state.stale === undefined ? 'tud-live' : 'tud-live tud-live-stale',
                      h('i', { className: 'tud-live-dot' }),
                      state.stale === undefined
                        ? t('logLive', { time: clock(data.generatedAt) })
                        : t('logStale'),
                    ),
                    h('span', null, t('logNote')),
                  ),
                ),
                logRows.length === 0
                  ? h('div', { className: 'tud-state' }, t('logEmpty'))
                  : h('div', { className: 'tud-log-scroll', ref: logRef, onScroll: (event) => {
                    if (event.currentTarget.scrollTop <= 4 && pending !== 0) setPending(0)
                  } },
                    pending === 0
                      ? null
                      : h('button', {
                        type: 'button',
                        className: 'tud-jump',
                        onClick: () => {
                          setPending(0)
                          logRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
                        },
                      }, t('logJump')),
                    h('table', { className: 'tud-table tud-log' },
                      h('thead', null, h('tr', null,
                        h('th', { scope: 'col' }, t('colTime')),
                        h('th', { scope: 'col' }, t('colDir')),
                        h('th', { scope: 'col' }, t('colProvider')),
                        h('th', { scope: 'col' }, t('colModel')),
                        h('th', { scope: 'col' }, t('tableInput')),
                        h('th', { scope: 'col' }, t('tableCacheRead')),
                        h('th', { scope: 'col' }, t('tableOutput')),
                        h('th', { scope: 'col' }, t('colSpeed')),
                        h('th', { scope: 'col' }, t('colTtft')),
                      )),
                      h('tbody', null, logRows.map((row) => h('tr', {
                        key: `${row.session}-${row.time}`,
                        className: row.time > freshAfter ? 'tud-row-new' : undefined,
                      },
                      h('td', null, h('div', { className: 'tud-cell' }, clock(row.time))),
                      h('td', { className: 'tud-log-dir', title: row.cwd ?? row.session },
                        h('div', { className: 'tud-cell' }, directoryOf(row))),
                      h('td', null, h('div', { className: 'tud-cell' }, row.provider ?? '—')),
                      h('td', { className: 'tud-log-model', title: row.model ?? '' },
                        h('div', { className: 'tud-cell' }, row.model ?? '—')),
                      h('td', null, h('div', { className: 'tud-cell' }, exact(row.input))),
                      h('td', null, h('div', { className: 'tud-cell' }, exact(row.cacheRead))),
                      h('td', null, h('div', { className: 'tud-cell' }, exact(row.output))),
                      h('td', null, h('div', { className: 'tud-cell' }, row.tps === null ? '—' : `${Math.round(row.tps)} tok/s`)),
                      h('td', null, h('div', { className: 'tud-cell' }, row.ttftMs === null ? '—' : `${(row.ttftMs / 1000).toFixed(1)}s`)),
                      ))),
                    ),
                  ),
              ),

              used.length === 0
                ? null
                : h('section', { className: 'tud-panel', 'aria-label': t('tableDate') },
                  h('div', { className: 'tud-table-scroll' },
                    h('table', { className: 'tud-table' },
                      h('thead', null, h('tr', null,
                        h('th', { scope: 'col' }, t('tableDate')),
                        h('th', { scope: 'col' }, t('tableInput')),
                        h('th', { scope: 'col' }, t('tableCacheRead')),
                        h('th', { className: 'tud-col-narrow', scope: 'col' }, t('tableCacheWrite')),
                        h('th', { scope: 'col' }, t('tableOutput')),
                        h('th', { scope: 'col' }, t('tableTotal')),
                        h('th', { scope: 'col' }, t('tableHit')),
                        h('th', { scope: 'col' }, t('tableSessions')),
                      )),
                      h('tbody', null, used.map((day) => h('tr', {
                        key: day.date,
                        className: day.date === data.today ? 'tud-is-today' : undefined,
                      },
                      h('th', { scope: 'row' }, day.date === data.today ? t('dayToday') : day.date),
                      h('td', null, exact(day.input)),
                      h('td', null, exact(day.cacheRead)),
                      h('td', { className: 'tud-col-narrow' }, exact(day.cacheWrite)),
                      h('td', null, exact(day.output)),
                      h('td', { className: 'tud-total' }, exact(day.total)),
                      h('td', null, percent(hitRate(day.cacheRead, day.prompt))),
                      h('td', null, exact(day.sessions)),
                      ))),
                    ),
                  ),
                ),

              h('footer', { className: 'tud-footnote' }, h('p', null, t('footnote'))),
              h('details', { className: 'tud-sources' },
                h('summary', null, t('sourcesTitle')),
                h('ul', null,
                  h('li', null, t('sourcesWhat')),
                  h('li', null, t('sourcesWhere')),
                  h('li', null, t('sourcesRules')),
                  h('li', null, t('sourcesCheck')),
                  h('li', null, t('sourcesGaps')),
                ),
              ),
            )

      return h('section', { className: 'tud-page', 'aria-label': t('title') },
        h('style', null, CSS),
        h('div', { className: 'tud-scroll' },
          h('div', { className: 'tud-content' },
            h('header', { className: 'tud-heading' },
              h('div', { className: 'tud-heading-text' },
                h('h1', null, t('title')),
                h('p', { className: 'tud-sub' }, zone === '' ? t('subtitlePlain') : t('subtitle', { zone })),
                meta === '' ? null : h('p', { className: 'tud-meta' }, meta),
              ),
              h('div', { className: 'tud-actions' },
                h('div', { className: 'tud-seg', role: 'group', 'aria-label': t('rangeLabel') },
                  [['today', t('rangeToday')], ['last7', t('range7')], ['last30', t('range30')], ['custom', t('rangeCustom')]]
                    .map(([kind, label]) => h('button', {
                      key: kind,
                      type: 'button',
                      'aria-pressed': preset === kind,
                      onClick: () => {
                        setPreset(kind)
                        // Opening the custom mode seeds the fields with the range
                        // already on screen, so applying it changes nothing.
                        if (kind === 'custom' && (custom.from === '' || custom.to === '') && data !== undefined) {
                          setCustom({ from: data.range.from, to: data.range.to })
                        }
                      },
                    }, label)),
                ),
                preset === 'custom'
                  ? h('div', { className: 'tud-range' },
                    h('label', { className: 'tud-range-field' },
                      h('span', null, t('rangeFrom')),
                      h('input', {
                        type: 'date',
                        className: 'tud-date',
                        value: custom.from,
                        max: custom.to === '' ? undefined : custom.to,
                        onChange: (event) => setCustom({ ...custom, from: event.target.value }),
                      }),
                    ),
                    h('label', { className: 'tud-range-field' },
                      h('span', null, t('rangeTo')),
                      h('input', {
                        type: 'date',
                        className: 'tud-date',
                        value: custom.to,
                        min: custom.from === '' ? undefined : custom.from,
                        onChange: (event) => setCustom({ ...custom, to: event.target.value }),
                      }),
                    ),
                    custom.from !== '' && custom.to !== '' && custom.from > custom.to
                      ? h('span', { className: 'tud-range-error' }, t('rangeInvalid'))
                      : null,
                  )
                  : null,
                h('button', {
                  type: 'button',
                  className: state.busy === true ? 'tud-icon-button tud-busy' : 'tud-icon-button',
                  'aria-label': t('refresh'),
                  'aria-busy': state.busy === true ? 'true' : undefined,
                  title: t('refresh'),
                  disabled: state.busy === true,
                  onClick: retry,
                }, h(RefreshGlyph)),
              ),
            ),
            body,
          ),
        ),
        h('footer', { className: 'tud-statusbar', 'aria-label': t('statusLabel') },
          h('div', { className: 'tud-status-main' },
            h('span', { className: 'tud-status-tag' }, t('dayToday')),
            statusItems.length === 0
              ? h('span', { className: 'tud-status-muted' }, data === undefined ? t('loading') : '—')
              : statusItems.map(([label, value]) => h('span', { key: label, className: 'tud-status-item' },
                h('span', { className: 'tud-status-label' }, label),
                h('b', null, value),
              )),
          ),
          h('div', { className: 'tud-status-side' },
            statusWindow === '' ? null : h('span', null, statusWindow),
            data === undefined ? null : h('span', null, t('updated', { time: clock(data.generatedAt) })),
          ),
        ),
      )
    }

    /**
     * Keep one bad render from blanking the slot with nothing to read: the
     * fallback names the failure in the theme's error ink.
     */
    class PageBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      render() {
        if (this.state.error === null) return this.props.children
        const { error } = this.state
        return h('div', {
          style: {
            padding: '36px',
            fontSize: '13px',
            lineHeight: '1.7',
            color: 'var(--dsw-alias-state-error-primary)',
          },
        }, `Usage statistics failed to render: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    /** The page wrapped in its own error boundary. */
    function TokenUsagePageBoundary(props) {
      return h(PageBoundary, null, h(TokenUsagePage, props))
    }

    /** Rail icon: three ascending bars, in the row's own text color. */
    function PanelIcon({ size }) {
      const bars = [
        { x: 3.8, y: 12, height: 4.5, opacity: 0.65 },
        { x: 8.4, y: 9, height: 7.5, opacity: 0.82 },
        { x: 13, y: 6, height: 10.5, opacity: 1 },
      ]
      return h('svg', {
        viewBox: '0 0 20 20',
        width: size,
        height: size,
        'aria-hidden': true,
        focusable: 'false',
        style: { display: 'block' },
      }, bars.map((bar) => h('rect', {
        key: bar.x,
        x: bar.x,
        y: bar.y,
        width: 3.2,
        height: bar.height,
        rx: 1.6,
        fill: 'currentColor',
        opacity: bar.opacity,
      })))
    }

    /** Refresh glyph. */
    function RefreshGlyph() {
      return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true, focusable: 'false' },
        h('path', {
          d: 'M13 8a5 5 0 1 1-1.6-3.7M13 2.6V5.4h-2.8',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }))
    }

    /** Page styles; every color is a theme token so both themes follow the shell. */
    const CSS = `
.tud-page { display: flex; flex-direction: column; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 1.6; }
.tud-scroll { flex: 1; min-height: 0; overflow: auto; scrollbar-gutter: stable; }
.tud-content { max-width: 960px; margin: 0 auto; padding: 0 clamp(24px, 4vw, 48px) 48px; }
.tud-heading { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 16px; padding-top: 28px; margin-bottom: 20px; }
[data-platform='darwin'] .tud-heading { padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px)); }
.tud-heading h1 { margin: 0; font-size: 20px; line-height: 28px; font-weight: 500; }
.tud-sub { margin: 2px 0 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }
.tud-meta { margin: 2px 0 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.tud-actions { display: flex; flex: none; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
.tud-range { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.tud-range-field { display: inline-flex; align-items: center; gap: 4px; }
.tud-date { padding: 3px 6px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 18px; }
.tud-date:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.tud-range-error { color: var(--dsw-alias-state-error-primary); }
.tud-seg { display: inline-flex; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; overflow: hidden; }
.tud-seg button { padding: 4px 10px; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 20px; cursor: pointer; }
.tud-seg button[aria-pressed='true'] { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); }
.tud-seg button:focus-visible, .tud-icon-button:focus-visible, .tud-text-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.tud-icon-button { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.tud-icon-button:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }
.tud-icon-button[disabled] { cursor: default; opacity: 0.7; }
.tud-busy svg { animation: tud-spin 0.9s linear infinite; }
@keyframes tud-spin { to { transform: rotate(360deg); } }
.tud-notice { margin: 0 0 12px; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); font-size: 12px; color: var(--dsw-alias-state-warn-primary); }
.tud-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px; }
.tud-card { padding: 14px 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.tud-card-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.tud-card-value { margin-top: 4px; font-size: 20px; line-height: 28px; font-weight: 500; font-variant-numeric: tabular-nums; }
.tud-card-sub { min-height: 18px; font-size: 12px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.tud-panel { padding: 16px; margin-bottom: 20px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.tud-panel-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
.tud-panel-title { margin: 0; font-size: 13px; font-weight: 500; }
.tud-legend { display: flex; gap: 12px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.tud-legend i { display: inline-block; width: 8px; height: 8px; margin-right: 6px; border-radius: 2px; vertical-align: middle; }
.tud-legend-input { background: var(--dsw-alias-chart-system); }
.tud-legend-cache { background: var(--dsw-alias-state-success-primary); }
.tud-legend-output { background: var(--dsw-alias-state-warn-primary); }
.tud-chart-wrap { position: relative; }
.tud-tip { position: absolute; z-index: 3; min-width: 150px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 18px; white-space: nowrap; pointer-events: none; font-variant-numeric: tabular-nums; }
.tud-tip-title { margin-bottom: 3px; font-weight: 600; }
.tud-chart { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 3px; padding-top: 8px; }
.tud-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.tud-col-plot { display: flex; align-items: flex-end; height: 168px; border-radius: 4px 4px 2px 2px; background: linear-gradient(to top, var(--dsw-alias-interactive-bg-hover) 1px, transparent 1px); background-size: 100% 42px; }
.tud-col:hover .tud-col-plot { background-color: var(--dsw-alias-interactive-bg-hover); }
.tud-col-stack { display: flex; flex-direction: column; width: 100%; min-height: 1px; border-radius: 3px; overflow: hidden; }
.tud-col-stack span { display: block; width: 100%; }
.tud-col-label { overflow: hidden; height: 14px; font-size: 10px; line-height: 14px; color: var(--dsw-alias-label-tertiary); text-align: center; white-space: nowrap; font-variant-numeric: tabular-nums; }
.tud-col.tud-is-today .tud-col-label { color: var(--dsw-alias-label-primary); font-weight: 600; }
.tud-peak { color: var(--dsw-alias-label-tertiary); }
.tud-bar-input { background: var(--dsw-alias-chart-system); }
.tud-bar-cache { background: var(--dsw-alias-state-success-primary); }
.tud-bar-output { background: var(--dsw-alias-state-warn-primary); }
.tud-is-today { font-weight: 600; }
.tud-table-scroll { overflow-x: auto; }
.tud-table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
.tud-table th, .tud-table td { padding: 7px 8px; text-align: center; white-space: nowrap; }
.tud-table thead th { font-size: 12px; font-weight: 400; color: var(--dsw-alias-label-secondary); }
.tud-table th:first-child, .tud-table td:first-child { text-align: center; }
.tud-table tbody tr { border-top: 1px solid var(--dsw-alias-border-l1); }
.tud-table tbody th { font-weight: 400; }
.tud-total { font-weight: 600; }
.tud-state { padding: 36px 0; text-align: center; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.tud-state-error { color: var(--dsw-alias-state-error-primary); }
.tud-text-button { margin-top: 8px; padding: 4px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer; }
.tud-footnote { margin: 0; font-size: 12px; line-height: 1.7; color: var(--dsw-alias-label-secondary); }
.tud-footnote p { margin: 0; }
.tud-sources { margin: 16px 0 0; font-size: 12px; line-height: 1.7; color: var(--dsw-alias-label-secondary); }
.tud-sources summary { cursor: pointer; color: var(--dsw-alias-label-primary); }
.tud-sources ul { margin: 8px 0 0; padding-left: 18px; }
.tud-sources li { margin-bottom: 4px; }
.tud-statusbar { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 16px; min-height: 34px; padding: 6px clamp(24px, 4vw, 48px); border-top: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); font-size: 12px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; overflow-x: auto; white-space: nowrap; }
.tud-status-main, .tud-status-side { display: flex; align-items: center; gap: 14px; }
.tud-status-tag { padding: 0 6px; border-radius: 4px; background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); font-weight: 500; }
.tud-status-item { display: inline-flex; gap: 4px; }
.tud-status-label { color: var(--dsw-alias-label-tertiary); }
.tud-status-item b { color: var(--dsw-alias-label-primary); font-weight: 500; }
.tud-status-muted { color: var(--dsw-alias-label-tertiary); }
.tud-badge { margin-left: 8px; padding: 0 6px; border-radius: 4px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 400; font-variant-numeric: tabular-nums; }
.tud-live { display: inline-flex; align-items: center; }
.tud-live-dot { width: 6px; height: 6px; margin-right: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); animation: tud-pulse 2s ease-in-out infinite; }
.tud-live-stale .tud-live-dot { background: var(--dsw-alias-state-warn-primary); animation: none; }
@keyframes tud-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.tud-log-scroll { position: relative; max-height: 360px; overflow: auto; scroll-behavior: smooth; }
.tud-jump { position: sticky; top: 4px; z-index: 2; display: block; margin: 4px auto; padding: 2px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 20px; cursor: pointer; }
.tud-log tbody td { padding: 0 8px; }
.tud-log .tud-cell { display: block; padding: 7px 0; }
/* A row that just arrived opens from zero height, so every row below it slides
   down to make room instead of jumping there. */
/* A row that just arrived pops in and flashes its border twice, then settles. */
.tud-log tr.tud-row-new { outline: 2px solid transparent; outline-offset: -2px; animation: tud-row-flash 1400ms ease-out; }
@keyframes tud-row-flash {
  0% { outline-color: transparent; background-color: transparent; }
  15% { outline-color: var(--dsw-alias-brand-primary); background-color: var(--dsw-alias-interactive-bg-active); }
  45% { outline-color: transparent; background-color: transparent; }
  65% { outline-color: var(--dsw-alias-brand-primary); background-color: var(--dsw-alias-interactive-bg-active); }
  100% { outline-color: transparent; background-color: transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .tud-log tr.tud-row-new { animation: none; outline-color: var(--dsw-alias-brand-primary); background-color: var(--dsw-alias-interactive-bg-active); }
}
.tud-log thead th { position: sticky; top: 0; z-index: 1; background: var(--dsw-alias-bg-layer-1); }
.tud-log td { border-top: 1px solid var(--dsw-alias-border-l1); font-size: 12px; }
.tud-log tbody tr:first-child td { border-top: 0; }
.tud-log-dir { max-width: 150px; }
.tud-log-model { max-width: 200px; }
.tud-log-dir .tud-cell, .tud-log-model .tud-cell { overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 767px) { .tud-content { padding-inline: 20px; } }
@media (max-width: 480px) { .tud-col-narrow { display: none; } }
`

    return {
      /** Both entries render into shell-declared slots: the rail and the main column. */
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'token-usage-daily: dictionaries')
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          inject: () => ({ t, subscribeLocale: (listener) => ctx.locale.subscribe(listener) }),
        }, TokenUsagePageBoundary))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          label: () => t('panel'),
        }, PanelIcon))
      },
    }
  },
})
