import { expect, test } from 'claude-code/testing'

import { termDetail, termReader } from '../hooks/terminal'
import type { ReaderHandlers } from '../hooks/terminal'
import type { Task, TermEvRow, TermReaderView } from '../types'

// The terminal views of the evidence view (design B). Expected values come from <evidence root>/tasks/evidence-view:
// "A" = analyst-report.md, "F" = spec-fixes.md; the section or criterion number is named at each group.
// The views are drawn here directly with a plain UI whose Box, Button and Text are their own names, so a drawn node is `{ type, props, children, onPress }`
// (the shape tests/agent-team.test.tsx reads from a mounted Pane). Nothing here is taken from the implementation's own output.
type Node = { type: string; props?: Record<string, unknown>; children?: (Node | string)[]; onPress?: () => void }
const nodesOf = (n: Node | string): Node[] => (typeof n === 'string' ? [] : [n, ...(n.children ?? []).flatMap(nodesOf)])
const textOf = (n: Node | string): string => (typeof n === 'string' ? n : (n.children ?? []).map(textOf).join(''))
const byKey = (root: Node, key: string) => nodesOf(root).find(n => n.props?.key === key) as Node
const buttons = (root: Node) => nodesOf(root).filter(n => n.type === 'Button')
const hotkeys = (root: Node) => Object.fromEntries(buttons(root).map(b => [String(b.props?.key), b.props?.hotkey]))
const UI = { Box: 'Box', Button: 'Button', Text: 'Text' } as never

const calls: string[] = []
const on: ReaderHandlers = {
  onBack: () => void calls.push('back'),
  onAsk: () => void calls.push('ask'),
  onPage: p => void calls.push(`page ${p}`),
  onNext: () => void calls.push('next'),
  onPrev: () => void calls.push('prev'),
}
const draw = (v: Partial<TermReaderView> = {}) => {
  calls.length = 0
  return termReader(UI, { label: 'QA raporu', path: '/e/qa.md', meta: 'md · 1,0 KB · 3 satır', rows: [], page: 0, nav: false, ...v }, on) as unknown as Node
}
const rowsOf = (n: number, f = (i: number) => `satır ${i + 1}`) => Array.from({ length: n }, (_, i) => ({ t: f(i) }))
const pageOf = (root: Node) => (byKey(root, 'reader-page').children ?? []) as Node[]
const press = (root: Node, key: string) => byKey(root, key).onPress?.()

const TASK: Task = { id: 't1', title: 'Seçim kutusu', state: 'running', stage: 2, roles: [], evidence: [{ label: 'QA raporu', path: '/e/qa report.md' }, { label: 'Plan', path: '/e/plan.md' }, { label: 'Log', path: '/e/log.txt' }] } as unknown as Task
const drawDetail = (evidence: TermEvRow[], evOpen: (i: number) => void = () => undefined) =>
  termDetail(UI, TASK, () => undefined, () => undefined, 0, [], {}, evidence, evOpen) as unknown as Node
const EV: TermEvRow[] = [
  { label: 'QA raporu', pressable: true, chip: 'NO-GO', text: '2 blocking bulgu', dim: false },
  { label: 'Plan', pressable: true, chip: 'GO', text: '', dim: false },
  { label: 'Log', pressable: true, text: 'ilk satır', dim: false },
]

test('criterion 29 (A 5.3 "Detail rows", F 5.3): each KANIT entry is exactly one row, Button key ev-open-<i> with the digit i+1, then one truncate-end Text', async () => {
  const root = drawDetail(EV)
  const rows = nodesOf(root).filter(n => /^ev-\d+$/.test(String(n.props?.key)))
  expect(rows.map(r => r.props?.key)).toEqual(['ev-0', 'ev-1', 'ev-2'])
  for (const r of rows) expect(r.props).toMatchObject({ flexDirection: 'row', gap: 1 })
  for (const r of rows) expect((r.children as Node[]).map(c => c.type)).toEqual(['Button', 'Text'])
  expect(rows.map(r => (r.children as Node[])[0]?.props)).toEqual([
    expect.objectContaining({ key: 'ev-open-0', label: 'QA raporu', hotkey: '1', plain: true }),
    expect.objectContaining({ key: 'ev-open-1', label: 'Plan', hotkey: '2', plain: true }),
    expect.objectContaining({ key: 'ev-open-2', label: 'Log', hotkey: '3', plain: true }),
  ])
  for (const r of rows) expect(((r.children as Node[])[1] as Node).props?.wrap).toBe('truncate-end')
  // the heading stays, the path of the entry is not drawn
  expect(nodesOf(root).some(n => n.type === 'Text' && textOf(n) === 'KANIT')).toBe(true)
  expect(nodesOf(root).some(n => textOf(n).includes('/e/qa report.md'))).toBe(false)
})

test('criterion 29 (F 5.3 detail rows): a chip is the verdict word in success / error, then " · <summary>" only when the summary is not empty', async () => {
  // Source: F section "Terminal row with an empty summary: the verdict alone (`NO-GO`), no ` · `"; TermEvRow doc in types/index.d.ts.
  const root = drawDetail(EV)
  const status = (i: number) => (byKey(root, `ev-${i}`).children as Node[])[1] as Node
  expect(textOf(status(0))).toBe('NO-GO · 2 blocking bulgu')
  expect(textOf(status(1))).toBe('GO')
  expect(textOf(status(2))).toBe('ilk satır')
  expect(nodesOf(status(0)).find(n => textOf(n) === 'NO-GO' && n !== status(0))?.props?.color).toBe('error')
  expect(nodesOf(status(1)).find(n => textOf(n) === 'GO' && n !== status(1))?.props?.color).toBe('success')
  expect(status(2).props?.dimColor).toBeUndefined()
})

test('criterion 29 (A 5.3, F 5.3): a refused, empty or loading entry is a label Text and a dim status Text, both truncate-end; the other digits do not shift', async () => {
  const rows: TermEvRow[] = [
    { label: 'Birinci', pressable: true, text: 'a', dim: false },
    { label: 'Dışarıda', pressable: false, text: 'kanıt kökünün dışında: gösterilmiyor', dim: true },
    { label: 'Üçüncü', pressable: true, text: 'c', dim: false },
    { label: 'Boş', pressable: false, text: 'boş dosya', dim: true },
    { label: 'Okunan', pressable: false, text: 'okunuyor…', dim: true },
  ]
  const root = drawDetail(rows)
  expect(hotkeys(root)).toMatchObject({ 'ev-open-0': '1', 'ev-open-2': '3' })
  expect(Object.keys(hotkeys(root)).filter(k => k.startsWith('ev-open'))).toEqual(['ev-open-0', 'ev-open-2'])
  for (const i of [1, 3, 4]) {
    const kids = byKey(root, `ev-${i}`).children as Node[]
    expect(kids.map(k => k.type)).toEqual(['Text', 'Text'])
    expect(kids.map(k => k.props?.wrap)).toEqual(['truncate-end', 'truncate-end'])
    expect(kids.map(textOf)).toEqual([rows[i]?.label, rows[i]?.text])
    expect(kids[0]?.props?.dimColor).toBeUndefined()
    expect(kids[1]?.props?.dimColor).toBe(true)
  }
})

test('criterion 29 (A 5.3, F 5.3): a status Text is dim whenever its entry has no Button; a pressable entry with no chip and no text still draws a one-space Text, not an empty one', async () => {
  const root = drawDetail([
    { label: 'Dışarıda', pressable: false, text: 'dosya değil: gösterilmiyor', dim: false },
    { label: 'Boş özet', pressable: true, text: '', dim: false },
  ])
  const status = (i: number) => (byKey(root, `ev-${i}`).children as Node[])[1] as Node
  expect(status(0).props?.dimColor).toBe(true)
  expect(textOf(status(1))).toBe(' ')
})

test('criterion 29 (A 5.3): pressing an entry calls evOpen with its index; every detail Button is plain; the detail keeps b s and one digit per pressable entry', async () => {
  const opened: number[] = []
  const root = drawDetail(EV, i => void opened.push(i))
  byKey(root, 'ev-open-2').onPress?.()
  byKey(root, 'ev-open-0').onPress?.()
  expect(opened).toEqual([2, 0])
  for (const b of buttons(root)) expect(b.props?.plain).toBe(true)
  expect(hotkeys(root)).toEqual({ 'detail-back': 'b', 'detail-ask': 's', 'ev-open-0': '1', 'ev-open-1': '2', 'ev-open-2': '3' })
})

test('criterion 29 (A 5.3): a label arrives cut to 20 code points and is drawn whole: no extra row, no re-cut', async () => {
  const label = 'On dokuz karakterli…' // the 20 code points the helper hands over (19 + …)
  const root = drawDetail([{ label, pressable: true, text: 'x'.repeat(300), dim: false }])
  expect(byKey(root, 'ev-open-0').props?.label).toBe(label)
  expect([...label].length).toBe(20)
  const kids = byKey(root, 'ev-0').children as Node[]
  expect(kids).toHaveLength(2)
  expect(textOf(kids[1] as Node)).toBe('x'.repeat(300)) // the view lays out; truncate-end cuts it at draw time
})

test('criterion 29 (F 5.3): with no t.evidence there is no KANIT section', async () => {
  const bare = termDetail(UI, { ...TASK, evidence: undefined } as unknown as Task, () => undefined, () => undefined, 0, [], {}, [], () => undefined) as unknown as Node
  expect(nodesOf(bare).some(n => textOf(n) === 'KANIT')).toBe(false)
  expect(nodesOf(bare).some(n => /^ev-/.test(String(n.props?.key)))).toBe(false)
})

test('criterion 29 (A 5.3 "Reader screen"): the reader is back/ask row, a three-row round header, a 14-row page, the page Buttons', async () => {
  const root = draw({ rows: rowsOf(3) })
  expect(root.props).toMatchObject({ flexDirection: 'column', gap: 1 })
  const kids = (root.children as Node[]).map(c => c.props?.key ?? c.type)
  expect(kids).toEqual([expect.anything(), 'reader-head', 'reader-page', expect.anything()])
  const top = (root.children as Node[])[0] as Node
  expect(top.props).toMatchObject({ flexDirection: 'row', justifyContent: 'space-between', gap: 2 })
  expect((top.children as Node[]).map(c => [c.props?.key, c.props?.label, c.props?.hotkey])).toEqual([
    ['reader-back', '‹ Görev', 'b'],
    ['reader-ask', "Lead'e sor", 's'],
  ])
  const head = byKey(root, 'reader-head')
  expect(head.props).toMatchObject({ borderStyle: 'round', borderColor: 'subtle' })
  const h = head.children as Node[]
  expect(h.map(textOf)).toEqual(['QA raporu', '/e/qa.md', 'md · 1,0 KB · 3 satır · sayfa 1/1'])
  expect(h.map(c => c.props?.wrap)).toEqual(['truncate-end', 'truncate-middle', 'truncate-end'])
  expect(h[0]?.props?.weight).toBe('bold')
  expect(h[1]?.props?.dimColor).toBe(true)
  const page = byKey(root, 'reader-page')
  expect(page.props?.flexDirection).toBe('column')
  expect(page.props).not.toHaveProperty('gap')
  const pg = (root.children as Node[])[3] as Node
  expect((pg.children as Node[]).map(c => [c.props?.key, c.props?.label, c.props?.hotkey])).toEqual([
    ['reader-next-page', 'sonraki', 'n'],
    ['reader-prev-page', 'önceki', 'p'],
  ])
  press(root, 'reader-back')
  press(root, 'reader-ask')
  expect(calls).toEqual(['back', 'ask'])
})

test('criterion 29 (A 5.3 item 3, F 5.3 "Page"): the page is exactly 14 truncate-end Texts, padded with one space, never an empty string', async () => {
  for (const n of [0, 1, 3, 13, 14, 15, 40]) {
    const page = pageOf(draw({ rows: rowsOf(n) }))
    expect(page).toHaveLength(14)
    for (const t of page) {
      expect(t.type).toBe('Text')
      expect(t.props?.wrap).toBe('truncate-end')
      expect(textOf(t)).not.toBe('')
    }
    expect(page.slice(0, Math.min(14, n)).map(textOf)).toEqual(rowsOf(Math.min(14, n)).map(r => r.t))
    expect(page.slice(Math.min(14, n)).map(textOf)).toEqual(Array(14 - Math.min(14, n)).fill(' '))
  }
  // an empty source line is one space, too
  expect(pageOf(draw({ rows: [{ t: 'a' }, { t: '' }, { t: 'b' }] })).slice(0, 3).map(textOf)).toEqual(['a', ' ', 'b'])
})

test('criterion 29 (A 5.3): bold maps to weight bold and dim to dimColor; a plain row sets neither', async () => {
  const page = pageOf(draw({ rows: [{ t: 'Başlık', bold: true }, { t: 'okunuyor…', dim: true }, { t: 'düz' }] }))
  expect(page[0]?.props).toMatchObject({ weight: 'bold' })
  expect(page[0]?.props?.dimColor).toBeUndefined()
  expect(page[1]?.props).toMatchObject({ dimColor: true })
  expect(page[1]?.props?.weight).toBeUndefined()
  expect(page[2]?.props?.weight).toBeUndefined()
  expect(page[2]?.props?.dimColor).toBeUndefined()
})

test('criteria 29, 38 (F 5.3 "Paging"): page y = max(1, ceil(rows / 14)); a stored page is clamped at draw; the page shows rows [14p, 14p + 14)', async () => {
  // Source: 14-row pages, y = max(1, ceil(N / 14)): 0 -> 1, 14 -> 1, 15 -> 2, 30 -> 3, 585 -> 42.
  const meta = (v: Partial<TermReaderView>) => textOf((byKey(draw(v), 'reader-head').children as Node[])[2] as Node)
  expect(meta({ rows: rowsOf(0) })).toBe('md · 1,0 KB · 3 satır · sayfa 1/1')
  expect(meta({ rows: rowsOf(14) })).toMatch(/sayfa 1\/1$/)
  expect(meta({ rows: rowsOf(15) })).toMatch(/sayfa 1\/2$/)
  expect(meta({ rows: rowsOf(30), page: 1 })).toMatch(/sayfa 2\/3$/)
  expect(meta({ rows: rowsOf(30), page: 99 })).toMatch(/sayfa 3\/3$/)
  expect(meta({ rows: rowsOf(585) })).toMatch(/sayfa 1\/42$/)
  expect(pageOf(draw({ rows: rowsOf(30), page: 1 })).map(textOf)).toEqual(rowsOf(14).map((_, i) => `satır ${15 + i}`))
  // page 99 of 30 rows clamps to the last page: rows 29 and 30, then padding
  expect(pageOf(draw({ rows: rowsOf(30), page: 99 })).map(textOf)).toEqual(['satır 29', 'satır 30', ...Array(12).fill(' ')])
  // a stored page below 0 (an old or damaged value) draws the first page
  expect(meta({ rows: rowsOf(30), page: -3 })).toMatch(/sayfa 1\/3$/)
  expect(pageOf(draw({ rows: rowsOf(30), page: -3 })).map(textOf)).toEqual(rowsOf(14).map((_, i) => `satır ${1 + i}`))
  expect(meta({ rows: rowsOf(30), page: Number.NaN })).toMatch(/sayfa 1\/3$/)
  // a refused file: meta without counts, still three header rows
  const refused = draw({ meta: 'md', rows: [{ t: 'sembolik bağ ya da farklı yazım: gösterilmiyor', dim: true }] })
  expect((byKey(refused, 'reader-head').children as Node[]).map(textOf)[2]).toBe('md · sayfa 1/1')
  expect(byKey(refused, 'reader-head').children).toHaveLength(3)
})

test('criteria 29, 38 (F 5.3 "Paging"): n and p call onPage only when the page really changes, from the clamped page', async () => {
  // Source: F 5.3 "n writes page + 1 only if min(page, y-1) < y-1. p writes min(page, y-1) - 1 only if that is >= 0".
  const three = (page: number) => draw({ rows: rowsOf(30), page })
  press(three(0), 'reader-next-page'); expect(calls).toEqual(['page 1'])
  press(three(1), 'reader-next-page'); expect(calls).toEqual(['page 2'])
  press(three(2), 'reader-next-page'); expect(calls).toEqual([]) // last page: no write
  press(three(0), 'reader-prev-page'); expect(calls).toEqual([]) // first page: no write
  press(three(1), 'reader-prev-page'); expect(calls).toEqual(['page 0'])
  press(three(2), 'reader-prev-page'); expect(calls).toEqual(['page 1'])
  // a stored page past the end acts as the last page
  press(three(99), 'reader-next-page'); expect(calls).toEqual([])
  press(three(99), 'reader-prev-page'); expect(calls).toEqual(['page 1'])
  // a stored page below 0 acts as the first page
  press(three(-1), 'reader-next-page'); expect(calls).toEqual(['page 1'])
  press(three(-1), 'reader-prev-page'); expect(calls).toEqual([])
  // one page only: neither moves
  press(draw({ rows: rowsOf(14) }), 'reader-next-page'); expect(calls).toEqual([])
  press(draw({ rows: rowsOf(14) }), 'reader-prev-page'); expect(calls).toEqual([])
  press(draw({ rows: [] }), 'reader-next-page'); expect(calls).toEqual([])
})

test('criteria 29, 33 (A 5.3): the k and o Buttons exist only with nav and call onNext and onPrev', async () => {
  const solo = draw({ rows: rowsOf(2) })
  expect(buttons(solo).map(b => b.props?.key)).toEqual(['reader-back', 'reader-ask', 'reader-next-page', 'reader-prev-page'])
  const nav = draw({ rows: rowsOf(2), nav: true })
  expect(buttons(nav).map(b => b.props?.key)).toEqual(['reader-back', 'reader-ask', 'reader-next-page', 'reader-prev-page', 'reader-next', 'reader-prev'])
  expect(byKey(nav, 'reader-next').props).toMatchObject({ label: 'sonraki kanıt', hotkey: 'k' })
  expect(byKey(nav, 'reader-prev').props).toMatchObject({ label: 'önceki kanıt', hotkey: 'o' })
  press(nav, 'reader-next'); expect(calls).toEqual(['next'])
  calls.length = 0
  press(nav, 'reader-prev'); expect(calls).toEqual(['prev'])
})

test('criterion 29 (A 5.3 "Keys"): the reader draws exactly b s n p k o, once each, all plain, no other node kind', async () => {
  const nav = draw({ rows: rowsOf(20), nav: true })
  expect(hotkeys(nav)).toEqual({ 'reader-back': 'b', 'reader-ask': 's', 'reader-next-page': 'n', 'reader-prev-page': 'p', 'reader-next': 'k', 'reader-prev': 'o' })
  expect(Object.values(hotkeys(nav)).sort()).toEqual(['b', 'k', 'n', 'o', 'p', 's'])
  for (const b of buttons(nav)) expect(b.props?.plain).toBe(true)
  expect(hotkeys(draw())).toEqual({ 'reader-back': 'b', 'reader-ask': 's', 'reader-next-page': 'n', 'reader-prev-page': 'p' })
  // types:1391 "one digit or one lowercase letter": anything else is refused and blanks the pane
  for (const k of Object.values(hotkeys(nav))) expect(String(k)).toMatch(/^[a-z0-9]$/)
  expect(new Set(nodesOf(nav).map(n => n.type))).toEqual(new Set(['Box', 'Button', 'Text']))
})

test('criterion 29 (A 5.3): the reader tree has the same row count on every page, for every entry, with or without nav-less rows, and a long row never adds a row', async () => {
  // Source: A 5.3 "The reader's row count is the same on every page and for every entry of a task" (nav is per task, not per entry).
  const count = (v: Partial<TermReaderView>) => {
    const root = draw(v)
    const page = byKey(root, 'reader-page')
    return { page: page.children?.length, head: byKey(root, 'reader-head').children?.length, top: root.children?.length, texts: nodesOf(root).filter(n => n.type === 'Text').length }
  }
  const base = count({ rows: rowsOf(30), nav: true })
  for (const v of [
    { rows: rowsOf(30), page: 1, nav: true },
    { rows: rowsOf(30), page: 2, nav: true },
    { rows: rowsOf(30), page: 99, nav: true },
    { rows: rowsOf(3), nav: true },
    { rows: [], nav: true },
    { rows: [{ t: 'x'.repeat(500), bold: true }], nav: true },
    { rows: [{ t: 'okunuyor…', dim: true }], meta: 'md', nav: true },
    { rows: rowsOf(100), page: 3, nav: true, label: 'L'.repeat(300), path: `/e/${'p'.repeat(300)}.md` },
  ] as Partial<TermReaderView>[])
    expect(count(v)).toEqual(base)
  expect(base).toEqual({ page: 14, head: 3, top: 5, texts: 17 })
  // a 500-character row is one Text holding the whole row: truncate-end cuts it at draw time, the view does not wrap it
  const long = pageOf(draw({ rows: [{ t: 'x'.repeat(500) }] }))[0] as Node
  expect(textOf(long)).toBe('x'.repeat(500))
  expect(long.props?.wrap).toBe('truncate-end')
})

test('criterion 29 (A 5.3): every drawn caption in the reader is one row: truncate-end, the path truncate-middle', async () => {
  const root = draw({ rows: rowsOf(20), nav: true })
  for (const t of nodesOf(root).filter(n => n.type === 'Text')) expect(['truncate-end', 'truncate-middle']).toContain(t.props?.wrap)
  expect(nodesOf(root).filter(n => n.props?.wrap === 'truncate-middle')).toHaveLength(1)
})
