/**
 * Browser-half checks that need no DOM: the module registers its entries, the two
 * dictionaries agree on every key the component asks for, the page styles stay
 * on theme tokens, and both render states build a tree without throwing.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')

/** Hook state the stub hands back for the next render. */
const hooks = { queue: [], cursor: 0 }

/** Minimal React surface: elements are plain nodes, hooks read the queue. */
const React = {
  Fragment: Symbol('react.fragment'),
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState(initial) {
    const value = hooks.cursor < hooks.queue.length ? hooks.queue[hooks.cursor] : initial
    hooks.cursor += 1
    return [value, () => {}]
  },
  useReducer(_reducer, initial) {
    return [initial, () => {}]
  },
  useEffect() {},
  useRef: (initial) => ({ current: initial }),
  Component: class Component {
    constructor(props) {
      this.props = props
    }
  },
}

const requires = []
let definition
globalThis.window = {
  __ModuleLoader__: {
    load(candidate) {
      definition = candidate
    },
  },
}

await import('../client.js')
assert.ok(definition !== undefined, 'the module registers itself with the loader')
assert.equal(definition.id, 'dsh-usage-statistics', 'the module id equals the package name')

const bundle = definition.factory((name) => {
  requires.push(name)
  if (name === 'react') return React
  throw new Error(`unexpected harness package requested: ${name}`)
})
assert.deepEqual(requires, ['react'], 'only react is requested from the module table')
assert.deepEqual(bundle.inject, ['slots', 'locale'])

const registrations = []
const dictionaries = new Map()
const ctx = {
  effect(callback) {
    return callback()
  },
  locale: {
    bind: (namespace) => (key) => `${namespace}:${key}`,
    register(namespace, dicts) {
      dictionaries.set(namespace, dicts)
      return () => {}
    },
    subscribe: () => () => {},
  },
  slots: {
    inject(key, callback) {
      callback()
      return () => {}
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  },
}

bundle.apply(ctx)

assert.equal(registrations.length, 2, 'one rail entry and one main panel')
const rail = registrations.find(({ options }) => options.name === 'sidebar.panellist')
const page = registrations.find(({ options }) => options.name === 'main')
assert.ok(rail !== undefined && page !== undefined, 'both slots are addressed')
assert.equal(rail.options.id, page.options.key, 'the rail id is the main panel dispatch key')
assert.equal(rail.options.order, 20, 'the entry sorts after Plugins (0) and Automation tasks (10)')
assert.equal(typeof rail.component, 'function', 'the rail entry renders an icon component')
assert.equal(typeof page.component, 'function', 'the main panel renders a page component')
assert.equal(rail.options.label(), 'usage-statistics:panel', 'the rail label comes from the bound namespace')

const dicts = dictionaries.get('usage-statistics')
assert.ok(dicts !== undefined, 'the plugin owns one locale namespace')
assert.deepEqual(Object.keys(dicts).sort(), ['en', 'zh'])
assert.deepEqual(Object.keys(dicts.en).sort(), Object.keys(dicts.zh).sort(), 'both dictionaries carry the same keys')

// Every key the component asks for must exist in both dictionaries.
const asked = new Set([...source.matchAll(/\bt\('([A-Za-z][A-Za-z0-9]*)'/g)].map((match) => match[1]))
assert.ok(asked.size > 10)
const missing = [...asked].filter((key) => !(key in dicts.en) || !(key in dicts.zh))
assert.deepEqual(missing, [], 'no copy key is missing from a dictionary')

// Placeholders must match across languages, or one locale silently drops a number.
for (const key of Object.keys(dicts.en)) {
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
  assert.deepEqual(placeholders(dicts.zh[key]), placeholders(dicts.en[key]), `placeholders agree for "${key}"`)
}

// Theme tokens only: no literal colors in the page styles.
const literals = [...source.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)].map((match) => match[0])
assert.deepEqual(literals, [], 'every color is a theme token')

const tokens = new Set([...source.matchAll(/var\((--dsw-[a-z0-9-]+)/g)].map((match) => match[1]))
for (const token of ['--dsw-alias-bg-base', '--dsw-alias-label-primary', '--dsw-alias-border-l1', '--dsw-alias-chart-system', '--dsw-alias-state-success-primary', '--dsw-alias-state-warn-primary', '--dsw-alias-interactive-bg-active']) {
  assert.ok(tokens.has(token), `the page uses ${token}`)
}

// --- render smoke ---------------------------------------------------------------
// The page is one function returning a node tree with real React. Running it with a
// hook stub executes every statement the browser would, which is what catches a
// temporal-dead-zone mistake or a leaked undefined in computed copy.

/** `t` that echoes its key and shows the parameters it received. */
function translate(key, params) {
  return params === undefined ? `t:${key}` : `t:${key}${JSON.stringify(params)}`
}

function render(states, extra = {}) {
  hooks.queue = states ?? []
  hooks.cursor = 0
  const props = { t: translate, subscribeLocale: () => () => {}, ...extra }
  // The registered component is the error boundary around the page; the page
  // itself is the one element it wraps, and that is what runs here.
  const wrapper = page.component(props)
  const inner = (wrapper.children ?? [])[0]
  assert.equal(typeof inner?.type, 'function', 'the registered component wraps the page in a boundary')
  return expandTree(inner.type(inner.props))
}

/**
 * Replace every function component in a tree with what it returns, so the
 * assertions see the same markup React would build. Class components (the error
 * boundary) are left alone: this stub does not run their lifecycles.
 */
function expandTree(node) {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.flat(Infinity).map(expandTree).flat(Infinity)
  if (typeof node.type === 'function' && typeof node.type.prototype?.render !== 'function') {
    return expandTree(node.type(node.props))
  }
  // React flattens nested child arrays; this stub does the same so an array of
  // elements reads as siblings, not as one opaque child.
  const children = (node.children ?? []).flat(Infinity).map(expandTree).flat(Infinity)
  return { type: node.type, props: node.props, children }
}

/** Collect every string in a node tree. */
function textOf(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) textOf(child, out)
    return out
  }
  if (typeof node === 'object') {
    if (node.type === 'style') return out
    for (const child of node.children ?? []) textOf(child, out)
  }
  return out
}

/** Depth-first search for the first node whose props satisfy `test`. */
function find(node, test) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, test)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  if (node.props !== undefined && test(node.props)) return node
  for (const child of node.children ?? []) {
    const hit = find(child, test)
    if (hit !== undefined) return hit
  }
  return undefined
}

const day = (date, input, cacheRead, output) => ({
  date,
  input,
  cacheRead,
  cacheWrite: 0,
  prompt: input + cacheRead,
  output,
  total: input + cacheRead + output,
  requests: 1,
  sessions: 1,
})

const today = day('2026-11-17', 1000, 99000, 500)

const requestRow = (time, overrides = {}) => ({
  time,
  day: '2026-11-17',
  session: 'session-abcdef12',
  cwd: '/Users/x/code/sglang',
  provider: 'maas',
  model: 'DeepSeek-V4.1-Flash-1017-a',
  input: 1200,
  cacheRead: 475000,
  cacheWrite: 0,
  output: 640,
  ttftMs: 1250,
  decodeMs: 2400,
  tps: 266.7,
  ...overrides,
})
const report = {
  generatedAt: new Date(2026, 10, 17, 14, 0, 0).getTime(),
  timeZone: 'Asia/Shanghai',
  today: today.date,
  windowDays: 7,
  days: [
    day('2026-11-11', 0, 0, 0),
    day('2026-11-12', 20, 400, 30),
    day('2026-11-13', 0, 0, 0),
    day('2026-11-14', 0, 0, 0),
    day('2026-11-15', 0, 0, 0),
    day('2026-11-16', 0, 0, 0),
    today,
  ],
  scanned: { sessions: 22, samples: 1741, unreadable: 0, failed: false },
  range: { from: '2026-11-11', to: '2026-11-17' },
  todayRow: { ...today, date: '2026-11-17' },
  hourly: [],
  requests: [
    requestRow(new Date(2026, 10, 17, 14, 49, 12).getTime()),
    requestRow(new Date(2026, 10, 17, 14, 49, 10).getTime(), { input: 201, output: 489, ttftMs: 800, tps: 165.4 }),
    requestRow(new Date(2026, 10, 17, 14, 49, 7).getTime(), { cwd: '/Users/x/code/sglang_grafana', tps: null, ttftMs: null }),
    // Outside the 7-day window: the log must not show it.
    requestRow(new Date(2026, 9, 1, 9, 0, 0).getTime(), { day: '2026-10-01' }),
  ],
}

// 1. First paint: the page must build while the report is still in flight.
const loading = render(['last7', { from: '', to: '' }, { count: 0, manual: false }])
assert.ok(textOf(loading).includes('t:loading'), 'the loading state names what it is doing')

// 2. Ready: every figure, the table, the sources block, and the bottom bar.
const ready = render(['last7', { from: '', to: '' }, { count: 0, manual: false }, { status: 'ready', data: report, busy: false }])
const readyText = textOf(ready)
const number = (value) => Number(value).toLocaleString()

assert.ok(readyText.includes('10.1万'), 'the range total reads in 万')
assert.ok(
  find(ready, (props) => typeof props['aria-label'] === 'string'
    && props['aria-label'].startsWith(`${today.date}: ${number(today.total)}`)) !== undefined,
  'each bar carries its own label',
)
assert.ok(readyText.includes('99%'), 'today\'s cache hit rate is rendered')
assert.ok(readyText.includes('t:cardHitRate'), 'the cache-hit-rate card is labelled')
assert.ok(readyText.includes('t:cardRangeTotal'), 'the range-total card is labelled')
assert.ok(readyText.includes('t:cardRequests'), 'the request-count card is labelled')
assert.ok(textOf(ready).join(' ').includes('2026-11-11 → 2026-11-17'), 'the heading states the range on screen')
assert.ok(readyText.includes('t:sourcesTitle'), 'the data-source block is present')
assert.ok(readyText.includes('t:sourcesGaps'), 'the block states its own gaps')

for (const key of ['tableInput', 'tableCacheRead', 'tableCacheWrite', 'tableOutput', 'tableTotal', 'tableHit', 'tableSessions']) {
  assert.ok(readyText.includes(`t:${key}`), `the table has a ${key} column`)
}

const statusBar = find(ready, (props) => props['aria-label'] === 't:statusLabel')
assert.ok(statusBar !== undefined, 'the bottom bar is rendered')
const statusItems = (statusBar.children ?? []).flatMap((child) => (child?.children ?? []).filter((item) => item?.props?.className === 'tud-status-item'))
assert.equal(statusItems.length, 6, 'the bottom bar restates the six figures')
const statusBarText = textOf(statusBar).join(' ')
for (const value of ['10.1万', '1000', '9.9万', '500', '99%']) {
  assert.ok(statusBarText.includes(value), `the bottom bar shows ${value}`)
}
assert.ok(statusBarText.includes('t:statusWindow'), 'the bottom bar carries the window summary')
assert.ok(statusBarText.includes('t:updated'), 'the bottom bar carries the refresh time')

// 2b. The request log lists the window's newest requests, with speed and first token.
assert.ok(readyText.includes('t:logTitle'), 'the request log is present')
assert.ok(readyText.some((text) => text.startsWith('t:logLive')), 'the log states that it is live')
assert.ok(readyText.includes('14:49:12'), 'the newest request shows its time')
assert.ok(readyText.includes('sglang'), 'a request row shows its directory')
assert.ok(readyText.includes('DeepSeek-V4.1-Flash-1017-a'), 'a request row shows its model')
assert.ok(readyText.includes('267 tok/s'), 'a request row shows its speed, rounded')
assert.ok(readyText.includes('1.3s'), 'a request row shows its first-token latency')
assert.ok(!readyText.includes('t:logEmpty'), 'the log is not empty when rows exist')
assert.ok(!readyText.includes('2026-10-01'), 'a row outside the window is not listed')

const emptyLog = render(['last7', { from: '', to: '' }, { count: 0, manual: false }, { status: 'ready', data: { ...report, requests: [] }, busy: false }])
assert.ok(textOf(emptyLog).includes('t:logEmpty'), 'an empty log says so')

// 2c. A single-day range draws hours, not one bar.
const hourlyReport = {
  ...report,
  range: { from: '2026-11-17', to: '2026-11-17' },
  days: [today],
  hourly: Array.from({ length: 24 }, (_, hour) => ({
    hour,
    input: hour === 14 ? 1000 : 0,
    cacheRead: hour === 14 ? 99000 : 0,
    cacheWrite: 0,
    output: hour === 14 ? 500 : 0,
    prompt: hour === 14 ? 100000 : 0,
    total: hour === 14 ? 100500 : 0,
    requests: hour === 14 ? 1 : 0,
  })),
}
const hourlyTree = render(['custom', { from: '2026-11-17', to: '2026-11-17' }, { count: 0, manual: false }, { status: 'ready', data: hourlyReport, busy: false }])
const hourly = textOf(hourlyTree).join(' ')
assert.ok(hourly.includes('00:00'), 'the hourly axis starts at midnight')
assert.ok(hourly.includes('23:00'), 'the hourly axis ends at the last hour')
assert.ok(
  find(hourlyTree, (props) => typeof props['aria-label'] === 'string'
    && props['aria-label'].startsWith('14:00: 100,500')) !== undefined,
  'the populated hour carries its own total',
)
assert.ok(!hourly.includes('2026-11-17: 100,500'), 'an hourly chart does not draw day bars')

// The histogram draws one column per slot, each with its two stacked colours.
const columns = []
const collect = (node) => {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) collect(child)
    return
  }
  const classes = node.props?.className
  if (typeof classes === 'string' && classes.split(' ').includes('tud-col')) columns.push(node)
  for (const child of node.children ?? []) collect(child)
}
collect(hourlyTree)
assert.equal(columns.length, 24, 'one column per hour')
assert.equal(columns.filter((column) => column.children?.[1]?.props?.className === 'tud-col-label').length, 24, 'every column has an axis slot')
const stack = columns.find((column) => column.props['aria-label'].startsWith('14:00'))
assert.ok(stack !== undefined, 'the populated hour is drawn')
assert.equal(stack.children[0].children[0].props.className, 'tud-col-stack', 'the column holds one stack')
assert.equal(stack.children[0].children[0].children.length, 3, 'the stack carries input, cache and output')

// 2d. The custom range mode exposes two date fields and rejects a reversed pair.
const customReady = render(['custom', { from: '2026-11-14', to: '2026-11-16' }, { count: 0, manual: false }, { status: 'ready', data: report, busy: false }])
const dateFields = []
for (const node of [customReady]) {
  const walk = (child) => {
    if (child === null || child === undefined || typeof child !== 'object') return
    if (Array.isArray(child)) {
      for (const item of child) walk(item)
      return
    }
    if (child.props?.type === 'date') dateFields.push(child.props)
    for (const grandchild of child.children ?? []) walk(grandchild)
  }
  walk(node)
}
assert.equal(dateFields.length, 2, 'the custom range exposes a start and an end field')
assert.deepEqual(dateFields.map((props) => props.value).sort(), ['2026-11-14', '2026-11-16'], 'the fields show the applied range')
assert.ok(!textOf(customReady).join(' ').includes('t:rangeInvalid'), 'a valid pair shows no error')

const reversedRange = render(['custom', { from: '2026-11-16', to: '2026-11-14' }, { count: 0, manual: false }, { status: 'ready', data: report, busy: false }])
assert.ok(textOf(reversedRange).includes('t:rangeInvalid'), 'a reversed pair is reported')

// 2e. A row that arrived after the last paint is marked, and only that one.
const rowsIn = (tree) => {
  const tables = []
  const findTables = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) findTables(child)
      return
    }
    if (typeof node.props?.className === 'string' && node.props.className.split(' ').includes('tud-log')) tables.push(node)
    for (const child of node.children ?? []) findTables(child)
  }
  findTables(tree)
  const rows = []
  const findRows = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) findRows(child)
      return
    }
    if (node.type === 'tr') rows.push(node)
    for (const child of node.children ?? []) findRows(child)
  }
  for (const table of tables) findRows(table)
  return rows
}

const olderTime = new Date(2026, 10, 17, 14, 49, 10).getTime()
const arriving = render(['last7', { from: '', to: '' }, { count: 0, manual: false }, { status: 'ready', data: report, busy: false, freshAfter: olderTime }])
const marked = rowsIn(arriving).filter((row) => typeof row.props?.className === 'string' && row.props.className.includes('tud-row-new'))
assert.equal(marked.length, 1, 'exactly the newly arrived row is marked')
assert.equal(marked[0].children.length, 9, 'the marked row still has every column')
assert.ok(marked[0].children.every((cell) => cell.children?.[0]?.props?.className === 'tud-cell'), 'every cell wraps its content so the row can open')

const settled = render(['last7', { from: '', to: '' }, { count: 0, manual: false }, { status: 'ready', data: report, busy: false, freshAfter: Number.POSITIVE_INFINITY }])
assert.equal(rowsIn(settled).filter((row) => typeof row.props?.className === 'string' && row.props.className.includes('tud-row-new')).length, 0, 'a first paint marks nothing')

// 2f. Every display counts in 万/亿, whatever the language.
const bigDay = day('2026-11-17', 2000000, 900000000, 25000000)
const bigReport = { ...report, days: [bigDay], todayRow: bigDay, windowDays: 1 }
const readyStates = ['last7', { from: '', to: '' }, { count: 0, manual: false }, { status: 'ready', data: bigReport, busy: false }]
const inChinese = textOf(render(readyStates, { activeLocale: () => 'zh' })).join(' ')
const inEnglish = textOf(render(readyStates, { activeLocale: () => 'en' })).join(' ')
for (const [name, text] of [['Chinese', inChinese], ['English', inEnglish]]) {
  assert.ok(text.includes('9.27亿'), `${name} copy counts in 亿`)
  assert.ok(text.includes('200万'), `${name} copy counts in 万`)
  assert.ok(!text.includes('927M'), `${name} copy has no M unit`)
}

// 2g. The histogram tooltip reads in the same units as everything else.
const tipSlot = { total: 927000000, input: 2000000, cacheRead: 900000000, cacheWrite: 0, output: 25000000, prompt: 902000000, requests: 155 }
const tipTree = render(
  ['last7', { from: '', to: '' }, { count: 0, manual: false }, { status: 'ready', data: bigReport, busy: false },
    { key: '14:00', label: '14:00', slot: tipSlot, left: 12, top: 40, below: false }, 0],
)
const tipNode = find(tipTree, (props) => typeof props.className === 'string' && props.className.split(' ').includes('tud-tip'))
assert.ok(tipNode !== undefined, 'a hovered column renders the tooltip')
const tipText = textOf(tipNode).join(' ')
assert.ok(tipText.includes('9.27亿'), 'the tooltip total reads in 亿')
assert.ok(tipText.includes('9亿'), 'the tooltip cache figure reads in 亿')
assert.ok(tipText.includes('200万'), 'the tooltip input reads in 万')
assert.ok(!tipText.includes('927,000,000'), 'the tooltip carries no exact integer')
assert.ok(tipText.includes('155'), 'a small count stays exact')

// 3. No copy may leak an internal value into the page.
for (const state of [loading, ready]) {
  const text = textOf(state).join(' ')
  assert.ok(!text.includes('undefined'), 'no render leaks undefined')
  assert.ok(!text.includes('NaN'), 'no render leaks NaN')
}

// 4. A corpus that could not be read is stated, not drawn as zero usage.
const failedReport = { ...report, days: [], scanned: { sessions: 0, samples: 0, unreadable: 0, failed: true } }
const failed = render(['last7', { from: '', to: '' }, { count: 0, manual: false }, { status: 'ready', data: failedReport, busy: false }])
assert.ok(textOf(failed).includes('t:scanFailed'), 'a failed scan reads as a failure')
assert.equal(find(failed, (props) => props.className === 'tud-cards'), undefined, 'a failed scan draws no cards')

// 5. A failed refresh keeps the report on screen and says so.
const stale = render(['last7', { from: '', to: '' }, { count: 0, manual: false }, { status: 'ready', data: report, busy: false, stale: 'HTTP 502' }])
assert.ok(textOf(stale).includes('t:refreshFailed{"message":"HTTP 502"}'), 'a stale report is labelled')
assert.ok(textOf(stale).includes('10.1万'), 'a stale report keeps its figures')

console.log('client tests passed')
