import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// Evidence view (design B), through the pane. Expected values come from <evidence root>/tasks/evidence-view: "A" = analyst-report.md,
// "F" = spec-fixes.md; the criterion number is named at each test. Fixture root `/e`, home `/h` (invariant 7: no personal paths).
const OPTS = { options: { teamFolders: '/', evidenceRoot: '/e' } }
const NOW = 1_000_000
const PANE = {
  plugin: 'agent-team',
  component: 'Pane',
  requestId: 'agent-team',
  props: { title: 'Agent Team', isFocused: false, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

type Node = { type: string; props?: Record<string, unknown>; children?: (Node | string)[] }
const nodesOf = (n: Node | string): Node[] => (typeof n === 'string' ? [] : [n, ...(n.children ?? []).flatMap(nodesOf)])
const textOf = (n: Node | string): string => (typeof n === 'string' ? n : (n.children ?? []).map(textOf).join(''))
const keyed = (root: Node, key: string) => nodesOf(root).find(n => n.props?.key === key)
const texts = (root: Node) => nodesOf(root).filter(n => n.type === 'Text').map(textOf)
// Every string a tree draws: text children and string props (a label, a text, an alt, a source).
const strings = (root: Node) => nodesOf(root).flatMap(n => [...(n.children ?? []).filter((c): c is string => typeof c === 'string'), ...Object.values(n.props ?? {}).filter((v): v is string => typeof v === 'string')])
const drawnOf = async (ui: { drawn: () => Promise<unknown> }) => (await ui.drawn()) as Node

type F = {
  text?: string
  size?: number
  // Overrides of the stat answer, or 'reject'; a function gets the 1-based number of this file's stat call (a file that changes under the read).
  stat?: Record<string, unknown> | 'reject' | ((call: number) => Record<string, unknown> | 'reject')
  // A read that waits for the test.
  hold?: Promise<void>
  // Reads before this number of them go through; the next ones wait for `hold`.
  holdAfter?: number
  readFails?: boolean
}
type Boot = {
  evidence: ([string, string] | { label: string; path: string })[]
  files?: Record<string, F>
  surface?: 'desktop' | 'terminal'
  home?: string
  root?: 'reject' | 'norealpath' | Record<string, unknown>
  status?: (evidence: unknown[]) => string
  task?: Record<string, unknown>
  // The evidence root as the option names it ('/e' unless the boot's test says another) and where its status file therefore lives.
  statusFile?: string
}
const statusOf = (evidence: unknown[], task: Record<string, unknown> = {}) =>
  JSON.stringify({ v: 1, tasks: [{ id: 't1', title: 'Seçim kutusu taşması', stage: 'review', roles: [], evidence: evidence.map(e => (Array.isArray(e) ? { label: e[0], path: e[1] } : e)), ...task }] })

// A session over a fake disk. A manual clock: `now` is NOW and every clock.every period is held until `poll()` releases it. `calls` records every stat and read
// of an evidence path (the status file and the root's stat are named apart), every state write, and every line that left the pane.
const evBoot = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], o: Boot) => {
  const STATUS_FILE = o.statusFile ?? '/e/status/shop.json'
  const disk = { status: o.status ? o.status(o.evidence) : statusOf(o.evidence, o.task), mtime: 1, files: o.files ?? {}, calls: {} as Record<string, number>, root: o.root }
  const log = {
    stat: [] as string[],
    rootStat: 0,
    read: [] as { path: string; offset?: number; length?: number }[],
    sets: [] as { key: string; value: unknown }[],
    submits: [] as string[],
    fills: [] as string[],
    out: [] as string[],
    nowCalls: 0,
  }
  const held: { ms: number; fire: () => void }[] = []
  on('clock.now', () => (log.nowCalls++, { value: NOW }))
  on('clock.every', (_, e) => new Promise(go => held.push({ ms: e.ms, fire: () => go({ value: undefined }) })) as never)
  on('clock.after', () => new Promise(() => undefined) as never)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [{ id: 'agent-team', title: 'Agent Team', isShown: true, isFocused: false, isPlaced: true }] }))
  on('env.get', () => ({ value: o.home ?? '/h' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', (_, e) => {
    if (e.path === STATUS_FILE) return { value: { kind: 'file', size: 10, mtimeMs: disk.mtime, isLink: false } }
    if (e.path === STATUS_FILE.replace('/status/shop.json', '')) {
      log.rootStat++
      if (disk.root === 'reject') throw new Error('ENOENT')
      return { value: { kind: 'dir', size: 0, mtimeMs: 1, isLink: false, ...(disk.root === 'norealpath' ? {} : { realPath: e.path }), ...(typeof disk.root === 'object' ? disk.root : {}) } }
    }
    log.stat.push(e.path)
    const f = disk.files[e.path]
    if (!f) throw new Error('ENOENT')
    const n = (disk.calls[e.path] = (disk.calls[e.path] ?? 0) + 1)
    const s = typeof f.stat === 'function' ? f.stat(n) : f.stat
    if (s === 'reject') throw new Error('ENOENT')
    return { value: { kind: 'file', size: f.size ?? (f.text ?? '').length, mtimeMs: 1, isLink: false, realPath: e.path, ...s } }
  })
  on('fs.read', async (_, e) => {
    if (e.path === STATUS_FILE) return { value: disk.status }
    log.read.push({ path: e.path, offset: e.offset, length: e.length })
    const f = disk.files[e.path]
    if (!f || f.readFails) throw new Error('EIO')
    if (f.hold && log.read.filter(r => r.path === e.path).length > (f.holdAfter ?? 0)) await f.hold
    return { value: f.text ?? '' }
  })
  on('state.set', (_, e, next) => {
    log.sets.push({ key: e.key, value: e.value })
    return next(e)
  })
  on('store.get', () => ({ value: undefined }))
  on('store.set', (_, e) => {
    log.out.push(`store:${JSON.stringify(e.value)}`)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [] }))
  on('store.delete', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.append', (_, e, next) => next(e))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    log.fills.push(e.text)
    log.out.push(`fill:${e.text}`)
    return { isFilled: true }
  })
  on('prompt.submit', (_, e) => {
    log.submits.push(e.text)
    log.out.push(`submit:${e.text}`)
    return { text: e.text }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }) as never)
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/Users/x/Projeler/shop', surface: o.surface ?? 'desktop', isInteractive: true })
  const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise(r => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(() => r(undefined), 0))
  }
  const fire = async (ms: number) => {
    for (const x of held.filter(y => y.ms === ms)) {
      held.splice(held.indexOf(x), 1)
      x.fire()
    }
    await settle()
  }
  const poll = async (n = 1) => {
    for (let i = 0; i < n; i++) await fire(500)
  }
  const pane = (surface: 'desktop' | 'terminal' = o.surface ?? 'desktop') => $.ui.mount({ ...PANE, surface })
  // The detail of t1, open on a fresh mount.
  const detail = async (surface: 'desktop' | 'terminal' = o.surface ?? 'desktop') => {
    const ui = await pane(surface)
    await ui.press({ key: 'detail-t1' })
    await settle()
    return ui
  }
  const press = async (ui: Awaited<ReturnType<typeof pane>>, key: string) => {
    await ui.press({ key })
    await settle()
  }
  const change = async (text: string) => {
    disk.status = text
    disk.mtime++
    await poll()
  }
  const evStats = () => log.stat.length
  return { disk, log, held, settle, poll, pane, detail, press, change, evStats }
}

const REFUSED = {
  outside: 'kanıt kökünün dışında: gösterilmiyor',
  bad: 'geçersiz yol: gösterilmiyor',
  root: 'kanıt kökü okunamadı',
  link: 'sembolik bağ ya da farklı yazım: gösterilmiyor',
  notFile: 'dosya değil: gösterilmiyor',
  changed: 'okunurken değişti: gösterilmiyor',
  notText: 'metin değil: gösterilmiyor',
}
const ev = (root: Node, i: number) => keyed(root, `ev-${i}`) as Node

test('criteria 1, 2 (A R1-R2, F R0): a path outside the root or malformed shows its line, has no open Button, and no fs call names it', OPTS, async ($, on) => {
  // Source: A criteria 1, 2: the lines are the spec's exact Turkish strings; "no fs call" counts every stat and read of an evidence path.
  const bad: [string, string, string][] = [
    ['A', '/etc/hosts', REFUSED.outside],
    ['B', '/e2/a.md', REFUSED.outside],
    ['C', '/e/../etc/x.md', REFUSED.bad],
    ['D', '/e/a//b.md', REFUSED.bad],
    ['E', '/e/a\\b.md', REFUSED.bad],
    ['F', 'relative/a.md', REFUSED.bad],
  ]
  const k = await evBoot($, on, { evidence: bad.map(([l, p]) => [l, p]) })
  const ui = await k.detail()
  const root = await drawnOf(ui)
  bad.forEach(([, , line], i) => {
    expect(texts(ev(root, i))).toContain(line)
    expect(keyed(root, `ev-open-${i}`)).toBeUndefined()
  })
  expect(k.log.stat).toEqual([])
  expect(k.log.read).toEqual([])
  expect(k.log.rootStat).toBe(0)
  await ui.unmount()
})

test('criterion 3 (A, owner Q2): any text file under the root is shown, hidden folders and no extension included; ~ expands', { options: { teamFolders: '/', evidenceRoot: '~/e' } }, async ($, on) => {
  // Source: A criterion 3 and owner-decisions Q2 (hidden files and folders are allowed; only the segments . and .. are refused).
  const paths = ['/h/e/x.json', '/h/e/noext', '/h/e/wt/.git/config', '/h/e/wt/.env', '/h/e/a.diff', '~/e/b.md']
  const files = Object.fromEntries(['/h/e/x.json', '/h/e/noext', '/h/e/wt/.git/config', '/h/e/wt/.env', '/h/e/a.diff', '/h/e/b.md'].map(p => [p, { text: 'ilk satır\nikinci satır' }]))
  const k = await evBoot($, on, { evidence: paths.map((p, i) => [`L${i}`, p]), files, statusFile: '/h/e/status/shop.json' })
  const ui = await k.detail()
  const root = await drawnOf(ui)
  paths.forEach((_, i) => {
    expect(keyed(root, `ev-open-${i}`)).toBeDefined()
    expect(texts(ev(root, i))).toContain('ilk satır')
  })
  expect(k.log.read.map(r => r.path)).toContain('/h/e/b.md')
  await ui.unmount()
})

test('criteria 4-10 (A R3-R6, F R5-R6): a link, a link directory, a missing realPath, a folder, a big file and a missing file are refused before any read', OPTS, async ($, on) => {
  const files = {
    '/e/link.md': { text: 'x', stat: { isLink: true } },
    '/e/dirlink/secret.md': { text: 'x', stat: { realPath: '/e/outside/secret.md' } },
    '/e/norp.md': { text: 'x', stat: { realPath: undefined } },
    '/e/folder': { text: 'x', stat: { kind: 'dir' } },
    '/e/big.md': { text: 'x', size: 1_048_577 },
    '/e/gone.md': { text: 'x', stat: 'reject' as const },
  }
  const want = [REFUSED.link, REFUSED.link, REFUSED.link, REFUSED.notFile, 'çok büyük (1,0 MB): gösterilmiyor', 'dosya bulunamadı']
  const k = await evBoot($, on, { evidence: Object.keys(files).map((p, i) => [`L${i}`, p]), files })
  const ui = await k.detail()
  const root = await drawnOf(ui)
  want.forEach((line, i) => {
    expect(texts(ev(root, i))).toContain(line)
    expect(keyed(root, `ev-open-${i}`)).toBeUndefined()
  })
  expect(k.log.read).toEqual([])
  await ui.unmount()
})

test('criteria 7, 9, 10, 12, 13 (A R7-R9, F): a size at the cap is shown, a failing read, NUL text and a file that changes under the read are refused', OPTS, async ($, on) => {
  let n = 100
  const files = {
    '/e/cap.md': { text: 'tam sınır', size: 1_048_576 },
    '/e/eio.md': { text: 'x', readFails: true },
    '/e/nul.md': { text: 'a\u0000b' },
    '/e/flip.md': { text: 'SECRET', stat: (call: number) => (call === 1 ? {} : { mtimeMs: ++n }) },
    '/e/ok.md': { text: 'tamam' },
  }
  const k = await evBoot($, on, { evidence: Object.keys(files).map((p, i) => [`L${i}`, p]), files })
  const ui = await k.detail()
  const root = await drawnOf(ui)
  expect(keyed(root, 'ev-open-0')).toBeDefined()
  expect(texts(ev(root, 1))).toContain('okunamadı')
  expect(texts(ev(root, 2))).toContain(REFUSED.notText)
  expect(texts(ev(root, 3))).toContain(REFUSED.changed)
  expect(JSON.stringify(root)).not.toContain('SECRET')
  expect(keyed(root, 'ev-open-4')).toBeDefined()
  await ui.unmount()
})

test('criterion 11 (A R7): every read of an evidence file is a range, 4 096 bytes for a row and 81 920 for the reader', OPTS, async ($, on) => {
  const k = await evBoot($, on, { evidence: [['a', '/e/a.md']], files: { '/e/a.md': { text: 'merhaba' } } })
  const ui = await k.detail()
  expect(k.log.read).toEqual([{ path: '/e/a.md', offset: 0, length: 4096 }])
  await k.press(ui, 'ev-open-0')
  expect(k.log.read.at(-1)).toEqual({ path: '/e/a.md', offset: 0, length: 81_920 })
  expect(k.log.read.every(r => r.offset === 0 && (r.length === 4096 || r.length === 81_920))).toBe(true)
  await ui.unmount()
})

for (const surface of ['desktop', 'terminal'] as const)
  test(`criteria 14, 15 (A R10, ${surface}): control characters in a file, a label and a task title never reach a drawn string, and the pane still draws`, OPTS, async ($, on) => {
    // Source: A criteria 14, 15 (measured: one ESC, NUL, BEL, DEL or C1 character blanks the whole tree).
    const nasty = '# Başlık\u001b[31m kırmızı\u0007 \u007f \u009b\r\nikinci\u202e satır\u2066 \u200b \ufeff \u2028 son'
    const k = await evBoot($, on, { evidence: [{ label: 'Etiket\u202e x\u200b', path: '/e/n.md' }], files: { '/e/n.md': { text: nasty } }, task: { title: 'Başlık\u202e' }, surface })
    const ui = await k.detail()
    const forbid = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u2028\u2029]/
    const detail = await drawnOf(ui)
    expect(keyed(detail, 'ev-open-0')).toBeDefined()
    expect(strings(ev(detail, 0) as Node).filter(x => forbid.test(x))).toEqual([]) // the task title in the old heading is not this feature's
    await k.press(ui, 'ev-open-0')
    const reader = await drawnOf(ui)
    expect(keyed(reader, 'reader-back')).toBeDefined()
    expect(strings(reader).filter(x => forbid.test(x))).toEqual([])
    await ui.unmount()
  })

const HOSTILE = [
  '![i](https://example.com/i.png)', '[l](https://example.com/a)', '<img src=x>', '<https://example.com>', '<1@example.com>', 'https://example.com/b', 'www.example.com', 'WWW.example.com',
  '[r]: https://example.com', '> [r]: https&#58;//example.com', '- [r]: https&colon;//example.com', '[a', 'b]: file:/etc/passwd',
].join('\n')
const ZW = '\u200b'
const markdownOf = (root: Node) => nodesOf(root).find(n => n.type === 'Markdown')

test('criteria 16, 17 (F R11): the desktop Markdown text holds no link, image, HTML or bare URL, and a press on a link changes nothing', OPTS, async ($, on) => {
  // Source: F criterion 16 (the regex list and the hand-derived outputs) and 17 (a link press leaves the tree, the prompt box and prompt.submit unchanged).
  const k = await evBoot($, on, { evidence: [['r', '/e/r.md']], files: { '/e/r.md': { text: HOSTILE } } })
  const ui = await k.detail()
  await k.press(ui, 'ev-open-0')
  const root = await drawnOf(ui)
  const md = markdownOf(root)
  expect(md?.props?.key).toBe('reader-md')
  const text = String(md?.props?.text)
  for (const re of [/!\[/, /\]\(/, /\]:/, /<[A-Za-z0-9/!?]/, /:\//, /www\./i, /&[#A-Za-z]/]) expect(text).not.toMatch(re)
  expect(text).toContain(`> [r]${ZW}: https&${ZW}#58;//example.com`)
  expect(text).toContain(`[a\nb]${ZW}: file:${ZW}/etc/passwd`)
  expect(text).toContain(`WWW${ZW}.example.com`)
  expect(text).toContain(`<${ZW}1@example.com>`)
  const before = JSON.stringify(root)
  await ui.press({ key: 'reader-md', link: { href: 'https://example.com/a' } })
  await k.settle()
  expect(JSON.stringify(await drawnOf(ui))).toBe(before)
  expect(k.log.submits).toEqual([])
  expect(k.log.fills).toEqual([])
  await ui.unmount()
})

test('criterion 18 (owner Q2): only .md and .markdown files are Markdown; every other file is one mono Text', OPTS, async ($, on) => {
  const files = { '/e/x.json': { text: '{"a": 1}' }, '/e/a.log': { text: 'satir **kalin**' }, '/e/noext': { text: '# baslik' }, '/e/A.MD': { text: '# Baslik' }, '/e/b.markdown': { text: '# Baslik' } }
  const k = await evBoot($, on, { evidence: Object.keys(files).map((p, i) => [`L${i}`, p]), files })
  const ui = await k.detail()
  const want = [false, false, false, true, true]
  for (const [i, isMd] of want.entries()) {
    await k.press(ui, `ev-open-${i}`)
    const root = await drawnOf(ui)
    expect(!!markdownOf(root)).toBe(isMd)
    if (!isMd) expect(nodesOf(root).some(n => n.type === 'Text' && n.props?.mono === true && textOf(n) === Object.values(files)[i]?.text)).toBe(true)
    await k.press(ui, 'reader-back')
  }
  await ui.unmount()
})

test('criterion 19 (F): a 90 000-byte file and a Markdown that md() cuts keep the reader\'s buttons and say what is shown', OPTS, async ($, on) => {
  // Source: F criterion 19: 90 000 / 1024 = 87,89 -> 87,9 KB; 81 920 / 2 x 3 = 122 880 characters, cut to 96 000; 81 920 / 1024 = 80.
  const k = await evBoot($, on, {
    evidence: [['a', '/e/a.md'], ['b', '/e/b.md']],
    files: { '/e/a.md': { text: 'a'.repeat(90_000), size: 90_000 }, '/e/b.md': { text: '<a'.repeat(40_960) } },
  })
  const ui = await k.detail()
  await k.press(ui, 'ev-open-0')
  const a = await drawnOf(ui)
  expect(keyed(a, 'reader-ask')).toBeDefined()
  expect(texts(a)).toContain('ilk 80 KB gösteriliyor · toplam 87,9 KB')
  expect(String(markdownOf(a)?.props?.text).length).toBeLessThanOrEqual(96_000)
  await k.press(ui, 'reader-next')
  const b = await drawnOf(ui)
  expect(String(markdownOf(b)?.props?.text).length).toBe(96_000)
  for (const key of ['reader-ask', 'reader-prev', 'reader-next']) expect(keyed(b, key)).toBeDefined()
  expect(texts(b)).toContain('dosyanın başı gösteriliyor · toplam 80,0 KB')
  await ui.unmount()
})

test('criterion 21 (A T2): while no detail is open nothing is stat\'ed or read, however many polls run', OPTS, async ($, on) => {
  const k = await evBoot($, on, { evidence: [['a', '/e/a.md']], files: { '/e/a.md': { text: 'x' } } })
  const ui = await k.pane()
  await k.poll(10)
  expect(k.log.stat).toEqual([])
  expect(k.log.read).toEqual([])
  expect(k.log.rootStat).toBe(0)
  await ui.unmount()
})

test('criteria 23, 35 (F §3): a quiet poll is one stat per path that passed the spelling rules, no read, no atom write; open costs the root once and each file twice', OPTS, async ($, on) => {
  // Source: F §3 and criteria 23, 35 by count: open = 1 root stat + 2 stats and 1 read per loadable file; a quiet poll = 1 stat per path.
  const k = await evBoot($, on, { evidence: [['a', '/e/a.md'], ['b', '/e/b.md'], ['c', '/etc/hosts']], files: { '/e/a.md': { text: 'x' }, '/e/b.md': { text: 'y' } } })
  const ui = await k.detail()
  expect([k.log.rootStat, k.log.stat.length, k.log.read.length]).toEqual([1, 4, 2])
  const sets = k.log.sets.length
  await k.poll(10)
  expect([k.log.rootStat, k.log.stat.length, k.log.read.length]).toEqual([1, 4 + 20, 2])
  expect(k.log.sets.length).toBe(sets)
  await ui.unmount()
})

test('criterion 35 (F §3): a folder costs one stat on open and one per poll; no realPath on the root costs the root only, until it answers', OPTS, async ($, on) => {
  const dir = await evBoot($, on, { evidence: [['a', '/e/a.md'], ['b', '/e/b']], files: { '/e/a.md': { text: 'x' }, '/e/b': { text: 'y', stat: { kind: 'dir' } } } })
  const ui = await dir.detail()
  expect([dir.log.rootStat + dir.log.stat.length, dir.log.read.length]).toEqual([4, 1])
  await dir.poll()
  expect(dir.log.stat.length).toBe(3 + 2)
  expect(dir.log.read.length).toBe(1)
  await ui.unmount()
})

test('criterion 35 (F §3): a root that answers with no realPath shows the root line, stats only the root each poll, and shows the files once it answers', OPTS, async ($, on) => {
  const k = await evBoot($, on, { evidence: [['a', '/e/a.md'], ['b', '/e/b.md']], files: { '/e/a.md': { text: 'x' }, '/e/b.md': { text: 'y' } }, root: 'norealpath' })
  const ui = await k.detail()
  expect([k.log.rootStat, k.log.stat.length]).toEqual([1, 0])
  expect(texts(await drawnOf(ui))).toContain(REFUSED.root)
  await k.poll()
  expect([k.log.rootStat, k.log.stat.length]).toEqual([2, 0])
  k.disk.root = undefined
  await k.poll()
  expect(keyed(await drawnOf(ui), 'ev-open-0')).toBeDefined()
  expect(keyed(await drawnOf(ui), 'ev-open-1')).toBeDefined()
  await ui.unmount()
})

test('criterion 24 (F §3): a changed file shows within one poll, a refused one that becomes valid too, and a late read of an earlier open is thrown away', OPTS, async ($, on) => {
  const k = await evBoot($, on, { evidence: [['a', '/e/a.md'], ['b', '/e/b.md']], files: { '/e/a.md': { text: 'eski satır' }, '/e/b.md': { text: 'b', stat: 'reject' } } })
  const ui = await k.detail()
  expect(texts(await drawnOf(ui))).toContain('eski satır')
  expect(texts(ev(await drawnOf(ui), 1))).toContain('dosya bulunamadı')
  k.disk.files['/e/a.md'] = { text: 'yeni satır', stat: { mtimeMs: 2 } }
  k.disk.files['/e/b.md'] = { text: 'artık var' }
  await k.poll()
  const root = await drawnOf(ui)
  expect(texts(root)).toContain('yeni satır')
  expect(texts(root)).not.toContain('eski satır')
  expect(texts(ev(root, 1))).toContain('artık var')
  // Back to the list and open again: read again. A read that lands after the back draws nothing.
  const reads = k.log.read.length
  await k.press(ui, 'detail-back')
  await k.press(ui, 'detail-t1')
  expect(k.log.read.length).toBe(reads + 2)
  let release = () => undefined as void
  k.disk.files['/e/a.md'] = { text: 'OLD', stat: { mtimeMs: 3 }, hold: new Promise<void>(go => (release = go)) }
  await k.press(ui, 'detail-back')
  await k.press(ui, 'detail-t1')
  await k.press(ui, 'detail-back')
  k.disk.files['/e/a.md'] = { text: 'NEW', stat: { mtimeMs: 4 } }
  await k.press(ui, 'detail-t1')
  release()
  await k.settle()
  expect(JSON.stringify(await drawnOf(ui))).not.toContain('OLD')
  expect(texts(await drawnOf(ui))).toContain('NEW')
  await ui.unmount()
})

test('criterion 37 (F T2): the bind view, team mode off and a finished session stop every evidence call', OPTS, async ($, on) => {
  const k = await evBoot($, on, { evidence: [['a', '/e/a.md']], files: { '/e/a.md': { text: 'ilk' } }, task: { session: { name: 't1' } } })
  const ui = await k.detail()
  expect(k.log.read.length).toBe(1)
  await k.press(ui, 'detail-bind')
  expect(keyed(await drawnOf(ui), 'bind-back')).toBeDefined()
  const calls = () => [k.log.rootStat, k.log.stat.length, k.log.read.length]
  const was = calls()
  await k.poll(10)
  expect(calls()).toEqual(was)
  await k.press(ui, 'bind-back')
  expect(texts(await drawnOf(ui))).toContain('ilk')
  expect(k.log.read.length).toBe(1) // the cache was kept: no read, one stat per poll again
  const foot = await $.ui.mount({ plugin: 'agent-team', component: 'SessionMode', surface: 'desktop', props: { modes: [] } })
  await foot.press({ key: 'team-mode' })
  await foot.unmount()
  const off = calls()
  await k.poll(10)
  expect(calls()).toEqual(off)
  await ui.unmount()
})

test('criterion 37 (F T2): after the session ended no poll reads an evidence file', OPTS, async ($, on) => {
  const k = await evBoot($, on, { evidence: [['a', '/e/a.md']], files: { '/e/a.md': { text: 'ilk' } } })
  const ui = await k.detail()
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'x', resume: { id: 'x' } })
  const was = [k.log.rootStat, k.log.stat.length, k.log.read.length]
  await k.poll(10)
  expect([k.log.rootStat, k.log.stat.length, k.log.read.length]).toEqual(was)
  await ui.unmount()
})

test('criterion 22 (A T1): what a file says is in no atom, no store value, no prompt line and no fill', OPTS, async ($, on) => {
  const k = await evBoot($, on, { evidence: [['a', '/e/a.md'], ['b', '/e/b.json']], files: { '/e/a.md': { text: '# ZZMARK\nZZMARK içerik' }, '/e/b.json': { text: '{"x":"ZZMARK"}' } } })
  const ui = await k.detail()
  await k.press(ui, 'ev-open-0')
  expect(JSON.stringify(await drawnOf(ui))).toContain('ZZMARK') // it is drawn ...
  await k.press(ui, 'reader-ask')
  await k.press(ui, 'reader-next')
  await k.press(ui, 'reader-back')
  await k.press(ui, 'detail-ask')
  await k.poll(3)
  expect(JSON.stringify(k.log.sets)).not.toContain('ZZMARK') // ... and kept nowhere
  expect(k.log.out.filter(l => l.includes('ZZMARK'))).toEqual([])
  expect(k.log.submits).toContain('Seçim kutusu taşması ne durumda?')
  await ui.unmount()
})

test('criteria 26, 28 (A §5.2): the reader draws at once, with the row\'s label, path and meta, and next / previous / back move between the views', OPTS, async ($, on) => {
  // Source: A criterion 26 (meta fixture: size 3 891, 4 lines, the clock 12 min after mtimeMs; 3 891 / 1024 = 3,8) and F 26 change (the meta with the body held).
  let release = () => undefined as void
  const hold = new Promise<void>(go => (release = go))
  const text = 'bir\niki\nüç\ndört'
  const stat = { mtimeMs: NOW - 720_000 }
  const k = await evBoot($, on, {
    evidence: [['a', '/e/a.md'], ['b', '/e/b.md'], ['c', '/e/c.md']],
    files: { '/e/a.md': { text, size: 3891, stat }, '/e/b.md': { text, size: 3891, stat, hold, holdAfter: 1 }, '/e/c.md': { text, size: 3891, stat } },
  })
  const ui = await k.detail()
  await k.press(ui, 'ev-open-1')
  const waiting = await drawnOf(ui)
  expect(keyed(waiting, 'reader-back')).toBeDefined()
  expect(keyed(waiting, 'detail-back')).toBeUndefined()
  expect(texts(waiting)).toContain('okunuyor…')
  expect(texts(waiting)).toContain('md · 3,8 KB · 12 dk önce')
  release()
  await k.settle()
  const root = await drawnOf(ui)
  expect((keyed(root, 'reader-back') as Node).props?.label).toBe('‹ Seçim kutusu taşması')
  expect(texts(root)).toEqual(expect.arrayContaining(['b', '/e/b.md', 'md · 3,8 KB · 4 satır · 12 dk önce']))
  expect(nodesOf(root).find(n => n.type === 'Svg')?.props?.alt).toBe('Kanıt okuyucusu')
  for (const key of ['reader-md', 'reader-prev', 'reader-next', 'reader-ask']) expect(keyed(root, key)).toBeDefined()
  expect(texts(root)).not.toContain('Turlar')
  await k.press(ui, 'reader-next')
  await k.press(ui, 'reader-next')
  expect(texts(await drawnOf(ui))).toContain('/e/a.md') // c -> a: the last wraps to the first
  await k.press(ui, 'reader-prev')
  expect(texts(await drawnOf(ui))).toContain('/e/c.md')
  await k.press(ui, 'reader-back')
  const back = await drawnOf(ui)
  expect(keyed(back, 'detail-back')).toBeDefined()
  expect(keyed(back, 'reader-back')).toBeUndefined()
  await ui.unmount()
})

test('criterion 26 (A): with one evidence file the reader has no next or previous button', OPTS, async ($, on) => {
  const k = await evBoot($, on, { evidence: [['a', '/e/a.md'], ['a2', '/e/a.md']], files: { '/e/a.md': { text: 'x' } } })
  const ui = await k.detail()
  await k.press(ui, 'ev-open-1')
  const root = await drawnOf(ui)
  expect(keyed(root, 'reader-back')).toBeDefined()
  expect(keyed(root, 'reader-next')).toBeUndefined()
  expect(keyed(root, 'reader-prev')).toBeUndefined()
  await ui.unmount()
})

test('criterion 27 (A §5.2, F 36 b): the bar plays on entry, only the first row of the left path flashes after back, and a duplicate path is one reader target', OPTS, async ($, on) => {
  // Source: F criterion 36 (b): A /e/a.md, B /e/a.md, C /e/c.md: next from A opens c, again opens a, back flashes only ev-0. The clock is fixed, so elapsed is 0.
  const k = await evBoot($, on, { evidence: [['A', '/e/a.md'], ['B', '/e/a.md'], ['C', '/e/c.md']], files: { '/e/a.md': { text: 'x' }, '/e/c.md': { text: 'y' } } })
  const ui = await k.detail()
  expect(nodesOf(await drawnOf(ui)).filter(n => n.type === 'Svg').every(n => !/@keyframes/.test(String(n.props?.source)))).toBe(true)
  await k.press(ui, 'ev-open-0')
  const bar = nodesOf(await drawnOf(ui)).find(n => n.props?.alt === 'Kanıt okuyucusu')
  expect(String(bar?.props?.source)).toContain('@keyframes fill')
  await k.press(ui, 'reader-next')
  expect(texts(await drawnOf(ui))).toContain('/e/c.md')
  await k.press(ui, 'reader-next')
  expect(texts(await drawnOf(ui))).toContain('/e/a.md')
  await k.press(ui, 'reader-back')
  const back = await drawnOf(ui)
  expect([0, 1, 2].map(i => nodesOf(ev(back, i)).some(n => n.type === 'Svg' && /@keyframes flash/.test(String(n.props?.source))))).toEqual([true, false, false])
  await ui.unmount()
})
