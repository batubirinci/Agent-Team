import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { isInside, parseFolders, parseStatus, summary } from '../hooks/status'
import { CLAY, MUTED, STUCK, TRACK, dotSvg, meterSvg, stagesSvg } from '../hooks/svg'

const fills = (svg: string) => [...svg.matchAll(/<rect [^>]*fill="([^"]+)"/g)].map(m => m[1])
const widths = (svg: string) => [...svg.matchAll(/<rect [^>]*width="([\d.]+)"/g)].map(m => Number(m[1]))

const STATUS = JSON.stringify({
  v: 1,
  updatedAt: '2026-11-12T14:32:00+03:00',
  lead: 'Opus 5.5',
  decisions: [
    { id: 'd1', kind: 'Ürün kararı', text: 'Hangisi sayılsın?', options: ['Durumları gör', 'Sonra'] },
    { text: '' },
  ],
  tasks: [
    {
      id: 't1',
      title: 'Seçim kutusu taşması',
      stage: 'review',
      round: 2,
      candidate: '3f9a1c2d4e5f60718293a4b5c6d7e8f901234567',
      blocking: 1,
      followup: 2,
      roles: [
        { name: 'QA · GPT-6 Astra', state: 'inceliyor', status: 'running' },
        { name: 'Helper', state: 'BLOCKED', status: 'nope' },
      ],
    },
    { stage: 'build' },
  ],
})

const PANE = {
  plugin: 'agent-team',
  component: 'Pane',
  requestId: 'agent-team',
  props: {
    title: 'Agent Team',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const FOOTER = {
  plugin: 'agent-team',
  component: 'SessionMode',
  props: { modes: ['İzinleri atla'] },
} as const

const BAND = {
  plugin: 'agent-team',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  },
} as const

test('the status file is read as untrusted data', async () => {
  const s = parseStatus(STATUS)
  expect(s.decisions.length).toBe(1)
  expect(s.tasks.length).toBe(1)
  expect(s.tasks[0]?.stage).toBe(2)
  expect(s.tasks[0]?.roles[1]?.status).toBe('idle')
  expect(summary(s)).toBe('1 karar bekliyor · QA inceliyor · 1 görev')
  expect(() => parseStatus('{"v":2}')).toThrow()
  expect(() => parseStatus('not json')).toThrow()
})

test('the usage bar fills to its percent, clamped, and turns clay from 80', async () => {
  // Expected values from the approved design: 4 px track, muted fill, clay at 80 % and above.
  expect(fills(meterSvg(42))).toEqual([TRACK, MUTED])
  expect(widths(meterSvg(42))).toEqual([160, 67.2])
  expect(fills(meterSvg(80))).toEqual([TRACK, CLAY])
  expect(widths(meterSvg(150))).toEqual([160, 160])
  expect(fills(meterSvg(-5))).toEqual([TRACK])
})

test('the stage line has five parts: done muted, current clay, rest track', async () => {
  expect(fills(stagesSvg(2))).toEqual([MUTED, MUTED, CLAY, TRACK, TRACK])
  expect(fills(stagesSvg(0))).toEqual([CLAY, TRACK, TRACK, TRACK, TRACK])
  expect(fills(stagesSvg(4))).toEqual([MUTED, MUTED, MUTED, MUTED, CLAY])
})

test('a dot is one 8 px circle in the given color', async () => {
  const dot = dotSvg(CLAY)
  expect(dot).toContain('width="8" height="8"')
  expect([...dot.matchAll(/<circle [^>]*fill="([^"]+)"/g)].map(m => m[1])).toEqual([CLAY])
})

test('team folders match the folder and what is under it, nothing beside it', async () => {
  const folders = parseFolders('~/Projeler/shop, /srv/app/ ,', '/Users/x')
  expect(folders).toEqual(['/Users/x/Projeler/shop', '/srv/app'])
  expect(isInside('/Users/x/Projeler/shop', folders)).toBe(true)
  expect(isInside('/Users/x/Projeler/shop/web', folders)).toBe(true)
  expect(isInside('/Users/x/Projeler/shop-old', folders)).toBe(false)
  // "/" is every session (owner's choice 2026-11-12: Agent Team on everywhere).
  expect(isInside('/Users/x/anything', parseFolders('/', '/Users/x'))).toBe(true)
  expect(isInside('/', parseFolders('/', '/Users/x'))).toBe(true)
})

test('the pane draws the status file and a decision button speaks for the owner', async ($, on) => {
  const sent: string[] = []
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/Users/x' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 1, isLink: false } }))
  on('fs.read', () => ({ value: STATUS }))
  on('clock.every', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/Users/x/Projeler/shop', surface: 'desktop', isInteractive: true })

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    // Terminal design (see "Terminal design" below): the title is the plain Button's label, "Tur <n> · aday <sha7>" is its own line.
    if (surface === 'terminal') {
      expect((await ui.find({ key: 'detail-t1' }))?.text).toBe('Seçim kutusu taşması')
      expect(await ui.find({ type: 'Text', text: /^Tur 2 · aday 3f9a1c2$/ })).toBeDefined()
    } else {
      expect(await ui.find({ type: 'Text', text: /Seçim kutusu taşması/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /aday 3f9a1c2$/ })).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: /Hangisi sayılsın\?/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'd-d1-0' })
  await ui.unmount()
  expect(sent).toEqual(['Karar (d1): Durumları gör'])
})

test('desktop draws the bars as SVG with alt text, the terminal keeps the text form', async ($, on) => {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/Users/x' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 1, isLink: false } }))
  on('fs.read', () => ({ value: STATUS.replace('"lead"', '"limits":{"fiveHourPct":42,"weeklyPct":18},"lead"') }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/Users/x/Projeler/shop', surface: 'desktop', isInteractive: true })

  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svgs = await desk.findAll({ type: 'Svg' })
  expect(svgs.filter(s => /kullanım|aşamanın/.test(String(s.props.alt))).map(s => s.props.alt)).toEqual([
    '5 saatlik kullanım %42',
    'Haftalık kullanım %18',
    'Review, 5 aşamanın 3.',
  ])
  expect(await desk.find({ type: 'Text', text: /━━━/ })).toBeUndefined()

  // Second polish round (approved design "İkinci cila turu"): filled cards with a soft edge,
  // findings as chips, small status dots. Colors are theme-agnostic, as for the SVG bars.
  const card = await desk.find({ key: 't-t1' })
  expect(card?.props.backgroundColor).toBe('rgba(128,128,128,0.10)')
  expect(card?.props.borderColor).toBe('rgba(128,128,128,0.28)')
  expect((await desk.find({ key: 'd-d1' }))?.props.backgroundColor).toBe('rgba(128,128,128,0.10)')
  const blocking = await desk.find({ key: 'chip-blocking-t1' })
  expect(blocking?.props.backgroundColor).toBe('rgba(224,108,108,0.18)')
  expect(blocking?.text).toBe('1 blocking')
  expect((await desk.find({ key: 'chip-followup-t1' }))?.text).toBe('2 follow-up')
  // A ● in text keeps the text's size on desktop (seen live): dots are 8 px Svg circles there.
  expect(await desk.find({ type: 'Text', text: /●/ })).toBeUndefined()
  const dots = svgs.filter(s => s.props.width === 8)
  expect(dots.map(s => s.props.alt)).toEqual(['karar bekliyor', 'çalışıyor', 'boşta'])
  expect(dots.every(s => s.props.height === 8)).toBe(true)
  await desk.unmount()

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  // Terminal design: text usage bars with eighth blocks and role glyphs instead of ●; the stage is the five-segment ━━━ line again
  // (terminal-boxes design) and the word line is gone; the full strings are asserted in the terminal tests below.
  expect(await term.find({ type: 'Text', text: /^5 sa  ████▏░░░░░ 42%   hafta █▊░░░░░░░░ 18%$/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /●/ })).toBeUndefined()
  expect(await term.find({ type: 'Text', text: /^Review · 3\/5$/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /spec/ })).toBeUndefined()
  await term.unmount()
})

test('the footer chip turns team mode on and off, keeps the engine labels, and nothing sits above the prompt', async ($, on) => {
  // Approved design "Öneri B · Alt satırda": a chip left of the footer labels; the band above the prompt is gone.
  const appended: string[] = []
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('session.append', (_, e, next) => {
    const block = e.message.content[0]
    appended.push(block && 'text' in block ? String(block.text) : '')
    return next(e)
  })

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Button' })).toBeUndefined()
  await band.unmount()

  const foot = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  expect(await foot.find({ type: 'Text', text: /İzinleri atla/ })).toBeDefined()
  expect((await foot.find({ key: 'team-mode' }))?.props.variant).toBe('secondary')
  await foot.press({ key: 'team-mode' })
  await foot.unmount()
  expect(appended[0]).toMatch(/^\[Agent Team modu açıldı\]/)

  const onFoot = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  expect((await onFoot.find({ key: 'team-mode' }))?.props.variant).toBe('primary')
  await onFoot.press({ key: 'team-mode' })
  await onFoot.unmount()
  expect(appended[1]).toMatch(/^\[Agent Team modu kapandı\]/)
})

test('the footer Pane button opens the pane next to the chip, with team mode off or on, and never flips the mode', async ($, on) => {
  // Source: owner's request 2026-11-12 "alt satırdaki tek tıkla açılsın"; criteria 1-2 of the pane-button task.
  const opened: unknown[] = []
  const appended: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('session.append', (_, e, next) => {
    appended.push('x')
    return next(e)
  })

  // Drawn order of the footer row, left to right: a Button is its key, the engine labels are their text.
  const row = async (foot: Awaited<ReturnType<typeof $.ui.mount<'desktop', 'SessionMode'>>>) => {
    const drawn = (await foot.drawn()) as { children: { props: { key?: string }; children?: string[] }[] }
    return drawn.children.map(c => c.props.key ?? c.children?.join(''))
  }
  // Press Pane with the mode as it is; the chip must read the same on a fresh mount afterwards.
  const pressPane = async (label: string) => {
    opened.length = 0
    appended.length = 0
    const foot = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
    expect(await row(foot)).toEqual(['team-mode', 'team-pane-open', 'İzinleri atla'])
    expect((await foot.find({ key: 'team-pane-open' }))?.text).toBe('Pane')
    await foot.press({ key: 'team-pane-open' })
    await foot.unmount()
    expect(opened).toMatchObject([{ id: 'agent-team' }])
    expect(appended).toEqual([])
    const after = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
    expect((await after.find({ key: 'team-mode' }))?.text).toBe(label)
    await after.unmount()
  }

  await pressPane('○ Agent Team')

  const toggle = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  await toggle.press({ key: 'team-mode' })
  await toggle.unmount()

  await pressPane('● Agent Team')
})

test('in team mode an owner prompt carries the Lead role, outside it nothing is added', async ($, on) => {
  const seen: (readonly string[] | undefined)[] = []
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.append', (_, e, next) => next(e))
  on('prompt.submit', (_, e) => {
    seen.push(e.context)
    return { text: e.text }
  })

  const typed = { wait: false, origin: { kind: 'composer' } } as const
  await $.prompt.submit({ ...typed, text: 'merhaba' })
  const foot = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  await foot.press({ key: 'team-mode' })
  await foot.unmount()
  await $.prompt.submit({ ...typed, text: 'tarih hatasını düzelt' })

  expect(seen[0] ?? []).toEqual([])
  expect(seen[1]?.some(c => c.includes("Sen Lead'sin"))).toBe(true)
})

test('an empty pane says the team is ready, lists the roles, and an example fills the prompt', async ($, on) => {
  // Approved design "Boş pane": hero, example tasks that fill the composer, how it works, 7 roles.
  const filled: string[] = []
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.append', (_, e, next) => next(e))
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })

  const off = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await off.find({ type: 'Text', text: /^Agent Team kapalı$/ })).toBeDefined()
  expect(await off.find({ key: 'pane-team-on' })).toBeDefined()
  expect(await off.find({ key: 'ex-0' })).toBeUndefined()
  await off.press({ key: 'pane-team-on' })
  await off.unmount()

  const ready = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ready.find({ type: 'Text', text: /^Takım hazır$/ })).toBeDefined()
  expect(await ready.find({ type: 'Text', text: /^Nasıl işler$/ })).toBeDefined()
  expect((await ready.findAll({ type: 'Text', text: /^(Analyst|Analyst 2|Developer|Developer \(zor iş\)|QA|QA 2 · canlı|Helper)$/ })).length).toBe(7)
  await ready.press({ key: 'ex-0' })
  await ready.unmount()
  expect(filled).toEqual(['Bir hatayı düzelt: '])
})

// Task detail (owner request 2026-11-12 + approved design "Görev ayrıntısı"; criteria 1-6 of the task-detail task).
const SHA_A = 'aaaaaaa1111111111111111111111111111111aa'
const SHA_B = 'bbbbbbb2222222222222222222222222222222bb'
const detailStatus = (task: Record<string, unknown>) =>
  JSON.stringify({ v: 1, tasks: [{ id: 't1', title: 'Seçim kutusu taşması', branch: 'feat/sel', stage: 'review', candidate: SHA_B, roles: [], ...task }] })
const DETAIL = detailStatus({
  rounds: [
    {
      n: 1,
      verdict: 'NO-GO',
      candidate: SHA_A,
      note: 'Aynı aile ikinci kez: mekanizma değişsin',
      findings: [{ severity: 'BLOCKING', origin: 'introduced', what: 'Kutu iki nesneye taşıyor', where: 'src/sel.ts:42' }],
    },
    { n: 2, verdict: 'GO', candidate: SHA_B, findings: [{ severity: 'LOW', origin: 'pre-existing', what: 'Eski ad kalmış', where: 'src/old.ts:7' }] },
  ],
  evidence: [{ label: 'QA raporu', path: '/Users/x/agent-team-evidence/qa report.md' }],
})

test('rounds and evidence are parsed with caps, malformed entries dropped, a file without them parses as before', async () => {
  // Criterion 1: caps 10 rounds, 10 findings per round, 6 evidence items; long strings trimmed.
  const many = (n: number, make: (i: number) => unknown) => Array.from({ length: n }, (_, i) => make(i))
  const t = parseStatus(
    detailStatus({
      rounds: [
        ...many(12, i => ({ n: i + 1, verdict: 'GO', findings: many(12, j => ({ what: `f${j}` })) })),
      ],
      evidence: many(8, i => ({ label: `e${i}`, path: `/p/${i}` })),
    }),
  ).tasks[0]
  expect(t?.rounds?.length).toBe(10)
  expect(t?.rounds?.[0]?.findings.length).toBe(10)
  expect(t?.evidence?.length).toBe(6)

  const bad = parseStatus(
    detailStatus({
      rounds: [{ n: 1 }, 'x', { n: 2, verdict: 'GO', note: 'n'.repeat(5000), findings: [{ severity: 'LOW' }, { what: 'w'.repeat(5000) }, 3] }],
      evidence: [{ label: 'yolsuz' }, { path: '/etiketsiz' }, { label: 'ok', path: '/ok' }],
    }),
  ).tasks[0]
  expect(bad?.rounds?.map(r => r.n)).toEqual([2])
  expect(bad?.rounds?.[0]?.findings.length).toBe(1)
  expect((bad?.rounds?.[0]?.findings[0]?.what.length ?? 0) < 1000).toBe(true)
  expect((bad?.rounds?.[0]?.note?.length ?? 0) < 1000).toBe(true)
  expect(bad?.evidence).toEqual([{ label: 'ok', path: '/ok' }])

  const old = parseStatus(STATUS).tasks[0] as Record<string, unknown>
  expect('rounds' in old || 'evidence' in old).toBe(false)
})

test('a task card opens its detail view with rounds and evidence, back returns, ask fills the prompt', async ($, on) => {
  // Criteria 2, 3, 5 and the approved design: every round with findings and note, evidence, same on desktop and terminal.
  const filled: string[] = []
  const modes: unknown[] = []
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/Users/x' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 1, isLink: false } }))
  on('fs.read', () => ({ value: DETAIL }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    modes.push(e.mode)
    return { isFilled: true }
  })
  await $.session.start({ cwd: '/Users/x/Projeler/shop', surface: 'desktop', isInteractive: true })

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'detail-t1' }))?.text).toBe(surface === 'terminal' ? 'Seçim kutusu taşması' : 'Ayrıntı ›')
    expect(await ui.find({ key: 'detail-back' })).toBeUndefined()
    await ui.press({ key: 'detail-t1' })

    expect(await ui.find({ key: 't-t1' })).toBeUndefined()
    expect((await ui.find({ key: 'detail-back' }))?.text).toBe('‹ Görevler')
    // Terminal strings are the terminal-boxes design's (own tests below); here only what both surfaces share.
    for (const re of surface === 'terminal'
      ? [/^Seçim kutusu taşması$/, /^feat\/sel · aday bbbbbbb$/, /^TURLAR$/, /^Tur 1 · NO-GO · aaaaaaa$/, /^Tur 2 · GO · bbbbbbb$/, /^BLOCKING · introduced$/, /^Kutu iki nesneye taşıyor$/, /^src\/sel\.ts:42$/, /^LOW · pre-existing$/, /^Not: Aynı aile ikinci kez: mekanizma değişsin$/, /^KANIT$/, /^QA raporu$/]
      : [/^Seçim kutusu taşması$/, /^feat\/sel$/, /bbbbbbb$/, /^GO · 2 tur$/, /^Turlar$/, /^Tur 1 · NO-GO$/, /^Tur 2 · GO$/, /^BLOCKING · introduced$/, /^Kutu iki nesneye taşıyor$/, /^src\/sel\.ts:42$/, /^LOW · pre-existing$/, /^Aynı aile ikinci kez: mekanizma değişsin$/, /^Kanıt$/, /^QA raporu$/]) {
      expect(await ui.find({ type: 'Text', text: re })).toBeDefined()
    }
    expect((await ui.findAll({ type: 'Text', text: /aaaaaaa$/ })).length).toBe(1)
    // Evidence is mono text, not a Link: the engine draws a file:// href as plain text on desktop (seen in this test's first run).
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^\/Users\/x\/agent-team-evidence\/qa report\.md$/ })).toBeDefined()
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()

    await ui.press({ key: 'detail-ask' })
    await ui.press({ key: 'detail-back' })
    expect(await ui.find({ key: 't-t1' })).toBeDefined()
    expect(await ui.find({ key: 'detail-back' })).toBeUndefined()
    await ui.unmount()
  }
  expect(filled).toEqual(['Seçim kutusu taşması hakkında: ', 'Seçim kutusu taşması hakkında: '])
  // Review revision 1: the ask replaces what is in the prompt box, as the empty-pane examples do.
  expect(modes).toEqual(['replace', 'replace'])
})

test('a task without rounds opens a detail view with no Turlar section, and a vanished task returns to the list', async ($, on) => {
  // Criterion 4.
  let text = detailStatus({})
  let mtime = 1
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/Users/x' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: mtime, isLink: false } }))
  on('fs.read', () => ({ value: text }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/Users/x/Projeler/shop', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'detail-t1' })
  expect(await ui.find({ key: 'detail-back' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Seçim kutusu taşması$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Turlar$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Kanıt$/ })).toBeUndefined()
  await ui.unmount()

  text = JSON.stringify({ v: 1, tasks: [{ id: 't9', title: 'Başka görev' }] })
  mtime = 2
  await $.session.start({ cwd: '/Users/x/Projeler/shop', surface: 'desktop', isInteractive: true })
  const after = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await after.find({ key: 'detail-back' })).toBeUndefined()
  expect(await after.find({ key: 't-t9' })).toBeDefined()
  await after.unmount()

  // Review revision 3: the open id is forgotten, so the same id coming back does not reopen the view by itself.
  text = detailStatus({})
  mtime = 3
  await $.session.start({ cwd: '/Users/x/Projeler/shop', surface: 'desktop', isInteractive: true })
  const back = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await back.find({ key: 'detail-back' })).toBeUndefined()
  expect(await back.find({ key: 't-t1' })).toBeDefined()
  await back.unmount()
})

test('with more than 10 rounds the last 10 are kept and the header reads the true round number', async ($, on) => {
  // Review revision 1 (QA r1 BLOCKING): 12 rounds, the last one NO-GO; the owner must see the newest verdict and "12 tur".
  const rounds = Array.from({ length: 12 }, (_, i) => ({ n: i + 1, verdict: i === 11 ? 'NO-GO' : 'GO', findings: [] }))
  const text = detailStatus({ rounds })
  expect(parseStatus(text).tasks[0]?.rounds?.map(r => r.n)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/Users/x' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 1, isLink: false } }))
  on('fs.read', () => ({ value: text }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/Users/x/Projeler/shop', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'detail-t1' })
  expect(await ui.find({ type: 'Text', text: /^NO-GO · 12 tur$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Tur 12 · NO-GO$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Tur 2 · GO$/ })).toBeUndefined()
  await ui.unmount()
})

test('the status file is per session: <project>--<first 8 of the session id>.json, the same path goes to the Lead, no id falls back to <project>.json', async ($, on) => {
  // Source: criteria 1-2 of the status-per-session task (owner request 2026-11-13).
  let id: string | Error = 'abcdef12-3456-7890-abcd-ef1234567890'
  const checked: string[] = []
  const sent: (readonly string[] | undefined)[] = []
  const appended: string[] = []
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/Users/x' }))
  on('session.id', () => {
    if (id instanceof Error) throw id
    return { value: id }
  })
  on('fs.exists', (_, e) => {
    checked.push(e.path)
    return { value: false }
  })
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.append', (_, e, next) => {
    const block = e.message.content[0]
    appended.push(block && 'text' in block ? String(block.text) : '')
    return next(e)
  })
  on('prompt.submit', (_, e) => {
    sent.push(e.context)
    return { text: e.text }
  })
  const start = () => $.session.start({ cwd: '/Users/x/Projeler/shop', surface: 'desktop', isInteractive: true })
  const ROOT = '/Users/x/agent-team-evidence/status'

  await start()
  expect(checked.at(-1)).toBe(`${ROOT}/shop--abcdef12.json`)
  // Two sessions in one folder read two files; the same session again (a reload) reads the same one.
  id = '99999999-0000-4000-8000-000000000000'
  await start()
  expect(checked.at(-1)).toBe(`${ROOT}/shop--99999999.json`)
  id = 'abcdef12-3456-7890-abcd-ef1234567890'
  await start()
  expect(checked.at(-1)).toBe(`${ROOT}/shop--abcdef12.json`)

  // The Lead is given the path the pane reads: in the mode-on row and in every prompt's context.
  const foot = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  await foot.press({ key: 'team-mode' })
  await foot.unmount()
  await $.prompt.submit({ wait: false, origin: { kind: 'composer' }, text: 'merhaba' })
  expect(appended[0]).toContain(`${ROOT}/shop--abcdef12.json `)
  expect(sent[0]?.some(c => c.includes(`${ROOT}/shop--abcdef12.json `))).toBe(true)

  // No usable id (the call fails, or answers empty): today's <project>.json.
  id = new Error('no id')
  await start()
  expect(checked.at(-1)).toBe(`${ROOT}/shop.json`)
  id = ''
  await start()
  expect(checked.at(-1)).toBe(`${ROOT}/shop.json`)
})

test('deleting the status file closes the open detail, and the same task id coming back shows the list', async ($, on) => {
  // Source: criterion 4a of the status-per-session task (QA follow-up task-detail r2): one check clears the open detail.
  let exists = true
  let mtime = 1
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/Users/x' }))
  on('session.id', () => ({ value: 'abcdef12-3456' }))
  on('fs.exists', () => ({ value: exists }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: mtime, isLink: false } }))
  on('fs.read', () => ({ value: detailStatus({}) }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const start = () => $.session.start({ cwd: '/Users/x/Projeler/shop', surface: 'desktop', isInteractive: true })
  await start()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'detail-t1' })
  expect(await ui.find({ key: 'detail-back' })).toBeDefined()
  await ui.unmount()

  exists = false
  await start()
  const gone = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await gone.find({ key: 'detail-back' })).toBeUndefined()
  await gone.unmount()

  exists = true
  mtime = 2
  await start()
  const back = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await back.find({ key: 'detail-back' })).toBeUndefined()
  expect(await back.find({ key: 't-t1' })).toBeDefined()
  await back.unmount()
})

// Terminal design (owner request 2026-11-13 + the approved Claude Design board "Terminal arayüzü · şimdi ve öneri",
// as written in the Lead's brief for the terminal-ui task; criteria 1-5 there). Every expected string below is
// spelled out by hand from that design, never read back from the implementation.
type Node = { type: string; props?: Record<string, unknown>; children?: (Node | string)[] }
const nodesOf = (n: Node | string): Node[] => (typeof n === 'string' ? [] : [n, ...(n.children ?? []).flatMap(nodesOf)])
const textOf = (n: Node | string): string => (typeof n === 'string' ? n : (n.children ?? []).map(textOf).join(''))
const drawnOf = async (ui: { drawn: () => Promise<unknown> }) => (await ui.drawn()) as Node
const textNode = (root: Node, re: RegExp) => nodesOf(root).find(n => n.type === 'Text' && re.test(textOf(n)))
const buttons = (root: Node) => nodesOf(root).filter(n => n.type === 'Button')
const hotkeys = (root: Node) => Object.fromEntries(buttons(root).map(b => [String(b.props?.key), b.props?.hotkey]))

const TERM = JSON.stringify({
  v: 1,
  updatedAt: '2026-11-12T14:32:00+03:00',
  lead: 'Opus 5.5',
  limits: { fiveHourPct: 42, weeklyPct: 18 },
  decisions: [
    { id: 'd1', kind: 'Ürün kararı', text: 'Hangisi sayılsın?', options: ['Durumları gör', 'Sonra'] },
    { id: 'd2', text: 'Birleşsin mi?', options: ['Evet'] },
  ],
  tasks: [
    {
      id: 't1',
      title: 'Seçim kutusu taşması',
      stage: 'review',
      round: 2,
      candidate: '3f9a1c2d4e5f60718293a4b5c6d7e8f901234567',
      blocking: 1,
      followup: 2,
      roles: [
        { name: 'QA · GPT-6 Astra', state: 'inceliyor', status: 'running' },
        { name: 'Developer', state: 'teslim etti', status: 'done' },
        { name: 'Analyst', state: 'sırada', status: 'waiting' },
        { name: 'QA 2', state: 'takıldı', status: 'blocked' },
        { name: 'Helper', state: 'boşta', status: 'idle' },
      ],
    },
    { id: 't2', title: 'İkinci görev', stage: 'build' },
  ],
})

// A mounted terminal session with the status text served from a fake file; mocks every call a pane or footer makes.
const boot = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], text: string, log: { say?: string[]; fill?: string[]; exists?: boolean } = {}) => {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/Users/x' }))
  on('fs.exists', () => ({ value: log.exists ?? true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 1, isLink: false } }))
  on('fs.read', () => ({ value: text }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.append', (_, e, next) => next(e))
  on('prompt.submit', (_, e) => {
    log.say?.push(e.text)
    return { text: e.text }
  })
  on('prompt.fill', (_, e) => {
    log.fill?.push(e.text)
    return { isFilled: true }
  })
  await $.session.start({ cwd: '/Users/x/Projeler/shop', surface: 'terminal', isInteractive: true })
}
const RAW_COLOR = /rgba?\(|#[0-9a-f]{3,8}\b/i

test('terminal pane: header, bars, decisions, tasks, roles, candidate and hint line follow the approved design', async ($, on) => {
  await boot($, on, TERM)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const root = await drawnOf(ui)

  // Header: AGENT TEAM claude + bold, dim "Lead · <lead> · <hh:mm>" (design header line).
  expect(textNode(root, /^AGENT TEAM$/)?.props).toMatchObject({ color: 'claude', weight: 'bold' })
  expect(textNode(root, /^Lead · Opus 5\.5 · 14:32 · mod kapalı$/)?.props?.dimColor).toBe(true)

  // Usage bars: 10 cells, 8 eighths per cell, filled eighths = floor(pct * 80 / 100). Eighth blocks ▏▎▍▌▋▊▉ = 1..7 eighths.
  //   42 % -> 33.6 -> 33 eighths = 4 full cells + 1 eighth (▏) + 5 empty  -> ████▏░░░░░
  //   18 % -> 14.4 -> 14 eighths = 1 full cell  + 6 eighths (▊) + 8 empty -> █▊░░░░░░░░
  // Source: the design's own example line "5 sa  ████▏░░░░░ 42%   hafta █▊░░░░░░░░ 18%".
  const usage = textNode(root, /^5 sa/)
  expect(usage && textOf(usage)).toBe('5 sa  ████▏░░░░░ 42%   hafta █▊░░░░░░░░ 18%')
  const fill42 = textNode(usage as Node, /^████▏$/)
  expect(fill42?.props?.color).toBe('text')
  expect(textNode(usage as Node, /^░░░░░$/)?.props?.color).toBe('subtle')
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()

  // Decisions: "◆ SENİN SIRAN · <n> karar" in claude; Box with a single border in theme color; kind in claude.
  expect(textNode(root, /^◆ SENİN SIRAN · 2 karar$/)?.props?.color).toBe('claude')
  const card = nodesOf(root).find(n => n.props?.key === 'd-d1')
  expect(card?.props).toMatchObject({ borderStyle: 'single', borderColor: 'subtle' })
  expect(textNode(card as Node, /^Ürün kararı$/)?.props?.color).toBe('claude')
  expect(buttons(card as Node).map(b => b.props?.label)).toEqual(['Durumları gör', 'Sonra'])

  // Tasks (terminal-boxes design, Lead's brief; source for every string below): "GÖREVLER · <n> çalışıyor" left and a dim "<n> görev" right
  // on one row; each task is its own round Box in subtle (key t-<id>); the title row holds only the plain Button, bold, cut at the end.
  const head = nodesOf(root).find(n => n.type === 'Box' && textOf(n) === 'GÖREVLER · 0 çalışıyor · 1 takıldı · 1 bekliyor2 görev')
  expect(head?.props).toMatchObject({ flexDirection: 'row', justifyContent: 'space-between' })
  expect(textNode(head as Node, /^GÖREVLER · 0 çalışıyor · 1 takıldı · 1 bekliyor$/)?.props?.weight).toBe('bold')
  expect(textNode(head as Node, /^2 görev$/)?.props?.dimColor).toBe(true)
  const box = nodesOf(root).find(n => n.props?.key === 't-t1') as Node
  // t1 has a blocked role, so its box is the blocked one (task-state design: border in error).
  expect(box.props).toMatchObject({ borderStyle: 'round', borderColor: 'error' })
  expect(nodesOf(root).find(n => n.props?.key === 't-t2')?.props).toMatchObject({ borderStyle: 'round', borderColor: 'subtle' })
  // Criterion 3 (the vertical "Tur 1" of the live screenshot came from a Text squeezed beside the Button in one row): no row of the
  // task Box holds the title Button together with another element.
  const btn = nodesOf(box).find(n => n.props?.key === 'detail-t1') as Node
  expect(btn.props).toMatchObject({ plain: true, hotkey: 'a' })
  expect(textOf(btn)).toBe('Seçim kutusu taşması')
  expect(btn.children?.some(c => typeof c !== 'string' && c.props?.weight === 'bold' && c.props?.wrap === 'truncate-end')).toBe(true)
  expect(nodesOf(box).some(n => n.props?.flexDirection === 'row' && (n.children ?? []).includes(btn))).toBe(false)
  expect(box.children?.[0]).toBe(btn)
  const tur = textNode(box, /^Tur 2 · aday 3f9a1c2$/)
  expect(tur?.props?.dimColor).toBe(true)
  // The state line (task-state design) sits right after the title row, so the Tur line is third.
  expect(box.children?.[2]).toBe(tur)
  // Only a round, only a candidate, neither (t2 has neither: no such line at all).
  expect(textNode(nodesOf(root).find(n => n.props?.key === 't-t2') as Node, /^Tur |aday/)).toBeUndefined()

  // Stage line (stage review = 3rd of 5): five "━━━ " segments, done text, current claude bold, future inactive; then dim "Review · 3/5".
  const stages = textNode(box, /^━━━ /)
  expect(stages && textOf(stages)).toBe('━━━ ━━━ ━━━ ━━━ ━━━ ')
  const parts = (stages?.children ?? []).filter((c): c is Node => typeof c !== 'string')
  expect(parts.map(p => [textOf(p), p.props?.color, p.props?.weight])).toEqual([
    ['━━━ ', 'text', undefined],
    ['━━━ ', 'text', undefined],
    ['━━━ ', 'claude', 'bold'],
    ['━━━ ', 'inactive', undefined],
    ['━━━ ', 'inactive', undefined],
  ])
  expect(textNode(box, /^Review · 3\/5$/)?.props?.dimColor).toBe(true)
  expect(textNode(root, /✓ spec|○ rapor/)).toBeUndefined()

  // Roles (criterion 5): row 1 "<glyph> <name>" (running ◐ claude, done ✓ success, waiting · inactive, blocked ✗ error, idle ○ inactive),
  // row 2 the state on its own line, indented 4, dim; a blocked state is drawn in the error color.
  const roleRows = [
    ['◐', 'QA · GPT-6 Astra', 'claude', 'inceliyor'],
    ['✓', 'Developer', 'success', 'teslim etti'],
    ['·', 'Analyst', 'inactive', 'sırada'],
    ['✗', 'QA 2', 'error', 'takıldı'],
    ['○', 'Helper', 'inactive', 'boşta'],
  ] as const
  roleRows.forEach(([g, name, color, state], i) => {
    const role = nodesOf(box).find(n => n.props?.key === `t-t1-r-${i}`) as Node
    expect(role?.props?.flexDirection).toBe('column')
    const [nameRow, stateRow] = role.children as Node[]
    expect(textOf(nameRow as Node)).toBe(`${g}${name}`)
    expect(textNode(nameRow as Node, new RegExp(`^${g}$`))?.props?.color).toBe(color)
    expect(textNode(nameRow as Node, /^[^◐✓·✗○]/)?.props?.wrap).not.toBe('truncate-end')
    expect(textOf(stateRow as Node)).toBe(state)
    expect(stateRow?.props?.marginLeft).toBe(4)
    expect(textNode(stateRow as Node, new RegExp(`^${state}$`))?.props).toMatchObject(color === 'error' ? { color: 'error' } : { dimColor: true })
  })

  // Counts line: "<n> blocking" error bold, " · <m> follow-up" dim; last line of the Box.
  const cand = box.children?.at(-1) as Node
  expect(textOf(cand)).toBe('1 blocking · 2 follow-up')
  expect(textNode(cand, /^1 blocking$/)?.props).toMatchObject({ color: 'error', weight: 'bold' })
  expect(textNode(cand, /^ · 2 follow-up$/)?.props?.dimColor).toBe(true)

  // Hint line: dim, keys in claude.
  const hint = textNode(root, /^a-o ayrıntı/)
  expect(hint && textOf(hint)).toBe('a-o ayrıntı  1-9 karar  p pause  esc çık')
  expect(hint?.props?.dimColor).toBe(true)
  expect(textNode(hint as Node, /^a-o$/)?.props?.color).toBe('claude')
  await ui.unmount()
})

test('terminal usage bar: 80 % and above fills in claude, below stays text color, clamped to 10 cells', async ($, on) => {
  // Same eighths rule: 85 % -> 68 eighths = 8 full + 4 eighths (▌) + 1 empty; 79 % -> 63.2 -> 63 = 7 full + 7 eighths (▉) + 2 empty;
  // 100 % -> 80 = 10 full, nothing empty; 150 % clamps to 100 %.
  await boot($, on, TERM.replace('"fiveHourPct":42,"weeklyPct":18', '"fiveHourPct":85,"weeklyPct":79'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const usage = textNode(await drawnOf(ui), /^5 sa/) as Node
  expect(textOf(usage)).toBe('5 sa  ████████▌░ 85%   hafta ███████▉░░ 79%')
  expect(textNode(usage, /^████████▌$/)?.props?.color).toBe('claude')
  expect(textNode(usage, /^███████▉$/)?.props?.color).toBe('text')
  await ui.unmount()
})

test('terminal usage bar: above 100 % clamps to full 10 cells, 80 % exactly is claude with no partial cell', async ($, on) => {
  // 150 % clamps to 100 % -> 80 eighths = 10 full cells; the label keeps the number as given. 80 % -> 64 eighths = 8 full + 2 empty.
  await boot($, on, TERM.replace('"fiveHourPct":42,"weeklyPct":18', '"fiveHourPct":150,"weeklyPct":80'))
  const hi = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const usage = textNode(await drawnOf(hi), /^5 sa/) as Node
  expect(textOf(usage)).toBe('5 sa  ██████████ 150%   hafta ████████░░ 80%')
  expect(textNode(usage, /^████████$/)?.props?.color).toBe('claude')
  await hi.unmount()
})

test('terminal hotkeys: decisions 1-9 across all decisions, tasks a c d e f g h i j k m n o, reserved keys never reused, none duplicated', async ($, on) => {
  // Source: the brief's design: digits numbered across all decisions in order (none past 9); task letters in
  // the list "a c d e f g h i j k m n o" (b l p s t reserved); pause p.
  const decisions = [1, 2, 3].map(i => ({ id: `x${i}`, text: `K${i}`, options: ['a', 'b', 'c', 'd'] }))
  const tasks = Array.from({ length: 15 }, (_, i) => ({ id: `k${i}`, title: `G${i}`, stage: 'build' }))
  await boot($, on, JSON.stringify({ v: 1, lead: 'L', decisions, tasks }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const keys = hotkeys(await drawnOf(ui))
  const opt = Object.entries(keys).filter(([k]) => k.startsWith('d-x')).map(([, v]) => v)
  expect(opt).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', undefined, undefined, undefined])
  const task = Object.entries(keys).filter(([k]) => k.startsWith('detail-k')).map(([, v]) => v as string | undefined)
  // Mode is off here, so pane-team-on (o) is drawn and the 13th task gives its letter up: the list stops at n.
  expect(task).toEqual([...'acdefghijkmn', undefined, undefined, undefined])
  expect(keys.pause).toBe('p')
  expect(keys['pane-team-on']).toBe('o')
  const used = Object.values(keys).filter(Boolean)
  expect(new Set(used).size).toBe(used.length)
  expect(task.some(k => k && 'blpst'.includes(k))).toBe(false)
  expect(buttons(await drawnOf(ui)).every(b => b.props?.plain === true)).toBe(true)
  await ui.unmount()
})

test('terminal: pressing by key does what it did, with the hotkeys beside it', async ($, on) => {
  // Same actions as the desktop test above: a decision button speaks for the owner, Pause says Pause, a task opens its detail.
  const say: string[] = []
  await boot($, on, TERM, { say })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(hotkeys(await drawnOf(ui))).toMatchObject({ pause: 'p', 'd-d1-0': '1', 'd-d1-1': '2', 'd-d2-0': '3', 'detail-t1': 'a', 'detail-t2': 'c' })
  await ui.press({ key: 'd-d2-0' })
  await ui.press({ key: 'pause' })
  expect(say).toEqual(['Karar (d2): Evet', 'Pause'])
  await ui.press({ key: 'detail-t1' })
  expect(await ui.find({ key: 'detail-back' })).toBeDefined()
  await ui.unmount()
})

test('terminal: no raw color in the list; the detail keeps plain Buttons b and s and a round box in subtle', async ($, on) => {
  // Criterion 2 walks the drawn tree; criterion 3 for the detail (back b, ask s); no Svg on the terminal.
  const rawIn = (root: Node) => nodesOf(root).filter(n => RAW_COLOR.test(JSON.stringify(n.props ?? {})) || n.type === 'Svg').length
  await boot($, on, DETAIL)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(rawIn(await drawnOf(ui))).toBe(0)
  await ui.press({ key: 'detail-t1' })
  const root = await drawnOf(ui)
  expect(rawIn(root)).toBe(0)
  expect(hotkeys(root)).toEqual({ 'detail-back': 'b', 'detail-ask': 's' })
  expect(buttons(root).every(b => b.props?.plain === true)).toBe(true)
  expect(nodesOf(root).find(n => n.props?.key === 'round-0')?.props).toMatchObject({ borderStyle: 'round', borderColor: 'subtle' })
  await ui.unmount()
})

test('terminal empty pane: no raw color, mode off offers pane-team-on on o, mode on offers the examples on 1-3', async ($, on) => {
  // Criterion 2 + 3 for the empty pane (hotkeys from the brief: examples 1-3, pane-team-on o).
  const rawIn = (root: Node) => nodesOf(root).filter(n => RAW_COLOR.test(JSON.stringify(n.props ?? {})) || n.type === 'Svg').length
  const fill: string[] = []
  await boot($, on, '', { fill, exists: false })

  const off = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const offRoot = await drawnOf(off)
  expect(rawIn(offRoot)).toBe(0)
  expect(hotkeys(offRoot)).toEqual({ 'pane-team-on': 'o' })
  expect(buttons(offRoot).every(b => b.props?.plain === true)).toBe(true)
  await off.press({ key: 'pane-team-on' })
  await off.unmount()

  const ready = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const readyRoot = await drawnOf(ready)
  expect(rawIn(readyRoot)).toBe(0)
  expect(hotkeys(readyRoot)).toEqual({ 'ex-0': '1', 'ex-1': '2', 'ex-2': '3' })
  expect(buttons(readyRoot).every(b => b.props?.plain === true)).toBe(true)
  await ready.press({ key: 'ex-1' })
  await ready.unmount()
  expect(fill).toEqual(['Yeni özellik ekle: '])
})

test('terminal footer: plain team-mode label that shows the state in words, pane on t, engine labels dim; desktop footer unchanged', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.append', (_, e, next) => next(e))
  const off = await $.ui.mount({ ...FOOTER, surface: 'terminal' })
  const offRoot = await drawnOf(off)
  expect(buttons(offRoot).map(b => [b.props?.key, b.props?.label, b.props?.hotkey, b.props?.plain])).toEqual([
    ['team-mode', '○ agent team', undefined, true],
    ['team-pane-open', 'pane', 't', true],
  ])
  expect(textNode(offRoot, /^İzinleri atla$/)?.props?.dimColor).toBe(true)
  expect(RAW_COLOR.test(JSON.stringify(nodesOf(offRoot).map(n => n.props)))).toBe(false)
  await off.press({ key: 'team-mode' })
  await off.unmount()

  const onFoot = await $.ui.mount({ ...FOOTER, surface: 'terminal' })
  expect((await onFoot.find({ key: 'team-mode' }))?.text).toBe('◉ agent team')
  await onFoot.press({ key: 'team-mode' })
  await onFoot.unmount()
})

test('terminal hotkeys, mode on: the 13th task takes o, since pane-team-on is not drawn; 14th and 15th have none', async ($, on) => {
  // Source: the brief (criterion 8, QA gap) and the key string "a c d e f g h i j k m n o" in README / design: o is the 13th task key, free once the mode is on.
  const tasks = Array.from({ length: 15 }, (_, i) => ({ id: `k${i}`, title: `G${i}`, stage: 'build' }))
  await boot($, on, JSON.stringify({ v: 1, lead: 'L', tasks }))
  const off = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await off.press({ key: 'pane-team-on' })
  await off.unmount()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const keys = hotkeys(await drawnOf(ui))
  expect(keys['pane-team-on']).toBeUndefined()
  const task = Object.entries(keys).filter(([k]) => k.startsWith('detail-k')).map(([, v]) => v as string | undefined)
  expect(task).toEqual([...'acdefghijkmno', undefined, undefined])
  const used = Object.values(keys).filter(Boolean)
  expect(new Set(used).size).toBe(used.length)
  await ui.unmount()
})

test('terminal: a paused status draws p: Devam (key resume, no pause) and pressing it says "Devam et"', async ($, on) => {
  // Source: the brief (criterion 8, QA gap) and the existing desktop behavior: Devam says "Devam et", hotkey p as Pause.
  const say: string[] = []
  await boot($, on, TERM.replace('"v":1', '"v":1,"paused":true'), { say })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const root = await drawnOf(ui)
  expect(hotkeys(root)).toMatchObject({ resume: 'p' })
  expect(hotkeys(root).pause).toBeUndefined()
  expect(nodesOf(root).find(n => n.props?.key === 'resume')?.props).toMatchObject({ label: 'Devam', plain: true })
  await ui.press({ key: 'resume' })
  expect(say).toEqual(['Devam et'])
  await ui.unmount()
})

test('terminal list: a task with no candidate and no round has no Tur line, with counts only it shows them, with none no counts line', async ($, on) => {
  // Source: the brief's list design: "leave out the part that is missing; no line if both missing"; counts line "when counts exist".
  const tasks = [
    { id: 'a', title: 'Yalnız yuvarlak', stage: 'spec', round: 3 },
    { id: 'b', title: 'Yalnız sha', stage: 'revise', candidate: 'abcdef0123456789', followup: 4 },
    { id: 'c', title: 'Hiçbiri', stage: 'report' },
  ]
  await boot($, on, JSON.stringify({ v: 1, tasks }))
  const root = await drawnOf(await $.ui.mount({ ...PANE, surface: 'terminal' }))
  const inBox = (id: string) => nodesOf(root).find(n => n.props?.key === `t-${id}`) as Node
  expect(textNode(inBox('a'), /Tur|aday/) && textOf(textNode(inBox('a'), /Tur|aday/) as Node)).toBe('Tur 3')
  expect(textOf(textNode(inBox('b'), /Tur|aday/) as Node)).toBe('aday abcdef0')
  expect(textNode(inBox('c'), /Tur|aday/)).toBeUndefined()
  expect(textNode(inBox('a'), /^Spec · 1\/5$/)).toBeDefined()
  expect(textNode(inBox('c'), /^Rapor · 5\/5$/)).toBeDefined()
  expect(textOf(inBox('b').children?.at(-1) as Node)).toBe('4 follow-up')
  expect(textNode(inBox('c'), /blocking|follow-up/)).toBeUndefined()
  expect(textNode(inBox('a'), /blocking|follow-up/)).toBeUndefined()
})

test('terminal detail: back and ask on one row, summary box, ROLLER, TURLAR newest first in round boxes, KANIT with the path dim', async ($, on) => {
  // Source: the terminal-boxes design in the Lead's brief ("Detail view"), strings spelled out by hand from it.
  await boot($, on, detailStatus({
    roles: [{ name: 'Developer', state: 'yazıyor', status: 'running' }],
    blocking: 1,
    followup: 3,
    rounds: [
      { n: 1, verdict: 'NO-GO', candidate: SHA_A, note: 'Aynı aile', findings: [{ severity: 'BLOCKING', origin: 'introduced', what: 'Kutu taşıyor', where: 'src/sel.ts:42' }] },
      { n: 2, verdict: 'GO', candidate: SHA_B, findings: [{ severity: 'LOW', origin: 'pre-existing', what: 'Eski ad', where: 'src/old.ts:7' }] },
    ],
    evidence: [{ label: 'QA raporu', path: '/Users/x/agent-team-evidence/qa report.md' }],
  }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'detail-t1' })
  const root = await drawnOf(ui)

  // First line: b: ‹ Görevler left, s: Lead'e sor right, one row.
  const top = nodesOf(root).find(n => n.props?.flexDirection === 'row' && (n.children ?? []).some(c => typeof c !== 'string' && c.props?.key === 'detail-back')) as Node
  expect(top.props).toMatchObject({ flexDirection: 'row', justifyContent: 'space-between' })
  expect(top.children?.map(c => (typeof c === 'string' ? c : c.props?.key))).toEqual(['detail-back', 'detail-ask'])
  expect(top.children?.map(c => (typeof c === 'string' ? c : [c.props?.label, c.props?.hotkey]))).toEqual([['‹ Görevler', 'b'], ["Lead'e sor", 's']])

  // Summary box: round subtle; title bold; "<branch> · aday <sha7>" dim; stage line + label; counts.
  const sum = nodesOf(root).find(n => n.props?.key === 'detail-summary') as Node
  expect(sum.props).toMatchObject({ borderStyle: 'round', borderColor: 'subtle' })
  expect(textNode(sum, /^Seçim kutusu taşması$/)?.props?.weight).toBe('bold')
  expect(textNode(sum, /^feat\/sel · aday bbbbbbb$/)?.props?.dimColor).toBe(true)
  expect(textNode(sum, /^━━━ ━━━ ━━━ ━━━ ━━━ $/)).toBeDefined()
  expect(textNode(sum, /^Review · 3\/5$/)?.props?.dimColor).toBe(true)
  expect(textOf(sum.children?.at(-1) as Node)).toBe('1 blocking · 3 follow-up')

  // Section order: summary, ROLLER (role in two lines, no box), TURLAR newest first, KANIT.
  const order = ['detail-summary', 'ROLLER', 'TURLAR', 'KANIT'].map(k => nodesOf(root).findIndex(n => n.props?.key === k || (n.type === 'Text' && textOf(n) === k)))
  expect(order.every(i => i >= 0) && [...order].sort((x, y) => x - y)).toEqual(order)
  const role = nodesOf(root).find(n => n.props?.key === 'detail-r-0') as Node
  expect(role.props?.borderStyle).toBeUndefined()
  expect((role.children as Node[]).map(textOf)).toEqual(['◐Developer', 'yazıyor'])
  expect(textNode(root, /^ROLLER$/)?.props?.weight).toBe('bold')

  // Rounds: newest (Tur 2) is drawn before Tur 1, each in a round-0/round-1 Box (key = index in the file).
  const all = nodesOf(root)
  expect(all.findIndex(n => n.props?.key === 'round-1')).toBeLessThan(all.findIndex(n => n.props?.key === 'round-0'))
  const r1 = all.find(n => n.props?.key === 'round-0') as Node
  const r2 = all.find(n => n.props?.key === 'round-1') as Node
  for (const r of [r1, r2]) expect(r.props).toMatchObject({ borderStyle: 'round', borderColor: 'subtle' })
  expect(textNode(r1, /^Tur 1 · NO-GO · aaaaaaa$/)?.props).toMatchObject({ color: 'error', weight: 'bold' })
  expect(textNode(r2, /^Tur 2 · GO · bbbbbbb$/)?.props).toMatchObject({ color: 'success', weight: 'bold' })
  // Finding: three lines; BLOCKING in error, other severities dim; where dim; note in warning.
  expect(textNode(r1, /^BLOCKING · introduced$/)?.props?.color).toBe('error')
  expect(textNode(r2, /^LOW · pre-existing$/)?.props?.dimColor).toBe(true)
  expect(textNode(r1, /^Kutu taşıyor$/)).toBeDefined()
  expect(textNode(r1, /^src\/sel\.ts:42$/)?.props?.dimColor).toBe(true)
  expect(textNode(r1, /^Not: Aynı aile$/)?.props?.color).toBe('warning')
  expect(textNode(r2, /^Not: /)).toBeUndefined()

  // Evidence: label, then the path dim, cut in the middle.
  const ev = nodesOf(root).find(n => n.props?.key === 'ev-0') as Node
  expect((ev.children as Node[]).map(textOf)).toEqual(['QA raporu', '/Users/x/agent-team-evidence/qa report.md'])
  expect(ev.children?.[1] && (ev.children[1] as Node).props).toMatchObject({ dimColor: true, wrap: 'truncate-middle' })
  await ui.unmount()
})

test('terminal detail: no rounds says so in one dim line, no evidence and no roles leave their sections out, a missing branch or candidate is left out', async ($, on) => {
  // Source: the brief's detail design: "No rounds: one dim line Henüz review turu yok."; "No evidence: leave the section out"; "missing parts left out".
  await boot($, on, JSON.stringify({ v: 1, tasks: [{ id: 't1', title: 'Yalın', stage: 'spec' }] }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'detail-t1' })
  const root = await drawnOf(ui)
  expect(textNode(root, /^TURLAR$/)).toBeDefined()
  expect(textNode(root, /^Henüz review turu yok\.$/)?.props?.dimColor).toBe(true)
  expect(textNode(root, /^KANIT$/)).toBeUndefined()
  expect(textNode(root, /^ROLLER$/)).toBeUndefined()
  expect(textNode(root, /aday|·  *$/)).toBeUndefined()
  expect(textNode(root, /^Spec · 1\/5$/)).toBeDefined()
  await ui.unmount()
})

// Task state (owner request 2026-11-13 + the approved Claude Design board "Takıldı / bekliyor durumları", as written in the Lead's
// brief for the task-state task). Every expected value below is spelled out by hand from the brief's data rules and design.
const task = (extra: Record<string, unknown>) => ({ id: 't1', title: 'G', stage: 'build', ...extra })
const stateOf = (tasks: unknown[], decisions: unknown[] = []) => {
  const t = parseStatus(JSON.stringify({ v: 1, tasks, decisions })).tasks[0]
  return [t?.state, t?.reason]
}
const run = { name: 'Developer', state: 'yazıyor', status: 'running' }
const stuck = { name: 'Developer', state: 'başlatılamadı', status: 'blocked' }
const idleRole = { name: 'QA', state: 'sırada', status: 'waiting' }
const ask = (kind: string, taskId = 't1', id = 'd1') => ({ id, kind, text: 'Ne yapalım?', task: taskId })

test('task state: blocked > running > waiting, and the reason line per state', async () => {
  // Source: brief "Data rules". blocked if a role is blocked OR an open decision linked to the task has a kind starting "Takıldı".
  expect(stateOf([task({ roles: [stuck] })])).toEqual(['blocked', 'başlatılamadı'])
  expect(stateOf([task({ roles: [run] })], [ask('Takıldı · Developer')])).toEqual(['blocked', 'senden 1 karar bekliyor'])
  // A linked decision that is not a "Takıldı" one does not block; a decision on another task does not link.
  expect(stateOf([task({ roles: [run] })], [ask('Ürün kararı')])).toEqual(['running', undefined])
  expect(stateOf([task({ roles: [idleRole] })], [ask('Takıldı', 't2')])).toEqual(['waiting', undefined])
  // Reason: "senden <n> karar bekliyor" counts every linked decision (n > 0 wins over the blocked role's state).
  expect(stateOf([task({ roles: [stuck] })], [ask('Takıldı'), ask('Ürün kararı', 't1', 'd2')])).toEqual(['blocked', 'senden 2 karar bekliyor'])
  expect(stateOf([task({ roles: [stuck] })], [ask('Ürün kararı')])).toEqual(['blocked', 'senden 1 karar bekliyor'])
  // First blocked role's state; none written -> no reason.
  expect(stateOf([task({ roles: [run, stuck, { ...stuck, state: 'ikinci' }] })])).toEqual(['blocked', 'başlatılamadı'])
  expect(stateOf([task({ roles: [{ name: 'Developer', status: 'blocked' }] })])).toEqual(['blocked', undefined])
  // Precedence: blocked beats running; running beats waiting; no roles at all is waiting.
  expect(stateOf([task({ roles: [run, stuck] })])[0]).toBe('blocked')
  expect(stateOf([task({ roles: [idleRole, run] })])[0]).toBe('running')
  expect(stateOf([task({ roles: [idleRole] })])[0]).toBe('waiting')
  expect(stateOf([task({})])[0]).toBe('waiting')
  // task.wait: the reason of a waiting task (and of a running one if given); a blocked task never shows it.
  expect(stateOf([task({ roles: [idleRole], wait: 'Koşan görev bitmeden başlamaz' })])).toEqual(['waiting', 'Koşan görev bitmeden başlamaz'])
  expect(stateOf([task({ roles: [run], wait: 'Başka görev' })])).toEqual(['running', 'Başka görev'])
  expect(stateOf([task({ roles: [stuck], wait: 'Başka görev' })])).toEqual(['blocked', 'başlatılamadı'])
  // The file is untrusted: wait is a short string, a non-string wait is dropped, decision.task is read.
  expect(stateOf([task({ wait: 7 })])[1]).toBeUndefined()
  expect(stateOf([task({ wait: 'x'.repeat(500) })])[1]?.length).toBe(120)
  expect(parseStatus(JSON.stringify({ v: 1, decisions: [ask('Takıldı')] })).decisions[0]?.task).toBe('t1')
  // Old files (no wait, no task link) parse as before apart from the state.
  const old = parseStatus(STATUS).tasks[0]
  expect([old?.state, old?.reason, old?.wait]).toEqual(['running', undefined, undefined])
})

test('the stage line of a blocked task has its current part red, the rest as before', async () => {
  // Source: brief "Task, desktop": current stage segment #E06C6C instead of clay on a blocked task.
  expect(STUCK).toBe('#E06C6C')
  expect(fills(stagesSvg(2, 5, true))).toEqual([MUTED, MUTED, STUCK, TRACK, TRACK])
  expect(fills(stagesSvg(0, 5, true))).toEqual([STUCK, TRACK, TRACK, TRACK, TRACK])
  expect(fills(stagesSvg(2))).toEqual([MUTED, MUTED, CLAY, TRACK, TRACK])
})

// tb: blocked (a "Takıldı" decision is linked, one role waits); tr: running (a non-blocking decision is linked); tw: waiting with a wait.
const STATES = JSON.stringify({
  v: 1,
  decisions: [
    { id: 'd1', kind: 'Takıldı · Developer', text: 'Developer başlatılamıyor, ne yapalım?', options: ['Yeniden dene', 'Bırak'], task: 'tb' },
    { id: 'd2', kind: 'Ürün kararı', text: 'Hangisi sayılsın?', options: ['Sonra'], task: 'tr' },
    { id: 'd3', text: 'Genel soru', options: ['Tamam'] },
  ],
  tasks: [
    { id: 'tb', title: 'Takılan görev', stage: 'build', roles: [{ name: 'Developer', state: 'başlamadı', status: 'waiting' }] },
    { id: 'tr', title: 'Koşan görev', stage: 'review', roles: [{ name: 'QA', state: 'inceliyor', status: 'running' }] },
    { id: 'tw', title: 'Bekleyen görev', stage: 'spec', wait: 'Koşan görev bitmeden başlamaz', roles: [] },
  ],
})
const keyed = (root: Node, key: string) => nodesOf(root).find(n => n.props?.key === key) as Node
const parts = (n: Node) => (n.children ?? []).filter((c): c is Node => typeof c !== 'string').map(p => [textOf(p), p.props?.color, p.props?.weight, !!p.props?.dimColor])

test('terminal: header counts, a state line per task, blocked box and decision in error, decision kind line with the task title', async ($, on) => {
  // Source: brief "Design — both surfaces": header "<r> çalışıyor · <b> takıldı · <w> bekliyor" (takıldı error bold),
  // state line "◐ çalışıyor" claude bold / "✗ TAKILDI" error bold / "⏸ bekliyor" warning bold then " · <reason>" dim (error when blocked).
  await boot($, on, STATES)
  const root = await drawnOf(await $.ui.mount({ ...PANE, surface: 'terminal' }))
  const head = nodesOf(root).find(n => n.props?.justifyContent === 'space-between' && textOf(n).startsWith('GÖREVLER')) as Node
  expect(textOf(head)).toBe('GÖREVLER · 1 çalışıyor · 1 takıldı · 1 bekliyor3 görev')
  const title = textNode(head, /^GÖREVLER/) as Node
  expect(title.props?.weight).toBe('bold')
  expect(textNode(title, /^ · 1 takıldı$/)?.props).toMatchObject({ color: 'error', weight: 'bold' })

  const tb = keyed(root, 't-tb')
  const tr = keyed(root, 't-tr')
  const tw = keyed(root, 't-tw')
  expect(tb.props).toMatchObject({ borderStyle: 'round', borderColor: 'error' })
  expect(tr.props).toMatchObject({ borderColor: 'subtle' })
  expect(tw.props).toMatchObject({ borderColor: 'subtle' })
  // The line sits right after the title row (the Button).
  expect(textOf(tb.children?.[1] as Node)).toBe('✗ TAKILDI · senden 1 karar bekliyor')
  expect(parts(tb.children?.[1] as Node)).toEqual([
    ['✗ TAKILDI', 'error', 'bold', false],
    [' · senden 1 karar bekliyor', 'error', undefined, false],
  ])
  expect(parts(tr.children?.[1] as Node)).toEqual([['◐ çalışıyor', 'claude', 'bold', false]])
  expect(parts(tw.children?.[1] as Node)).toEqual([
    ['⏸ bekliyor', 'warning', 'bold', false],
    [' · Koşan görev bitmeden başlamaz', undefined, undefined, true],
  ])

  // Decisions: kind line "<kind> · <task title>"; linked to a blocked task: border and kind in error; others as before.
  const d1 = keyed(root, 'd-d1')
  expect(d1.props).toMatchObject({ borderStyle: 'single', borderColor: 'error' })
  expect(textNode(d1, /^Takıldı · Developer · Takılan görev$/)?.props?.color).toBe('error')
  const d2 = keyed(root, 'd-d2')
  expect(d2.props).toMatchObject({ borderColor: 'subtle' })
  expect(textNode(d2, /^Ürün kararı · Koşan görev$/)?.props?.color).toBe('claude')
  const d3 = keyed(root, 'd-d3')
  expect(d3.props).toMatchObject({ borderColor: 'subtle' })
  expect(textNode(d3, /·/)).toBeUndefined()
  // Theme keys only: no raw color anywhere in the drawn tree.
  expect(nodesOf(root).filter(n => RAW_COLOR.test(JSON.stringify(n.props ?? {}))).length).toBe(0)
})

test('terminal: a header leaves out takıldı and bekliyor at zero, and keeps "çalışıyor" even at zero', async ($, on) => {
  // Source: brief: "leaving out zero parts except çalışıyor". An old file with only running tasks reads as in 0.3.0.
  await boot($, on, JSON.stringify({ v: 1, tasks: [task({ roles: [run] }), task({ id: 't2', roles: [run] })] }))
  const root = await drawnOf(await $.ui.mount({ ...PANE, surface: 'terminal' }))
  expect(textOf(nodesOf(root).find(n => n.props?.justifyContent === 'space-between' && textOf(n).startsWith('GÖREVLER')) as Node)).toBe('GÖREVLER · 2 çalışıyor2 görev')
})

test('terminal: a header with only waiting tasks reads "0 çalışıyor · 1 bekliyor"', async ($, on) => {
  await boot($, on, JSON.stringify({ v: 1, tasks: [task({})] }))
  const root = await drawnOf(await $.ui.mount({ ...PANE, surface: 'terminal' }))
  expect(textOf(nodesOf(root).find(n => n.props?.justifyContent === 'space-between' && textOf(n).startsWith('GÖREVLER')) as Node)).toBe('GÖREVLER · 0 çalışıyor · 1 bekliyor1 görev')
})

test('desktop: header counts, a state chip and reason caption per task, blocked card and decision in red, red current stage part', async ($, on) => {
  // Source: brief "Task, desktop" and "Decisions": chip colors, caption, card border rgba(224,108,108,0.45), kind text #F2A3A3.
  await boot($, on, STATES)
  const root = await drawnOf(await $.ui.mount({ ...PANE, surface: 'desktop' }))
  expect(textNode(root, /çalışıyor · /) && textOf(textNode(root, /çalışıyor · /) as Node)).toBe('1 çalışıyor · 1 takıldı · 1 bekliyor · 3 görev')

  const chips = [
    ['tb', '✗ Takıldı', 'rgba(224,108,108,0.22)', '#F2A3A3'],
    ['tr', '◐ Çalışıyor', 'rgba(217,119,87,0.18)', '#F0B9A5'],
    ['tw', '⏸ Bekliyor', 'rgba(229,192,123,0.18)', '#E5CC7A'],
  ] as const
  for (const [id, label, bg, ink] of chips) {
    const chip = keyed(root, `chip-state-${id}`)
    expect(chip.props?.backgroundColor).toBe(bg)
    expect(textOf(chip)).toBe(label)
    expect(textNode(chip, /./)?.props?.color).toBe(ink)
  }
  const cards = ['tb', 'tr', 'tw'].map(id => keyed(root, `t-${id}`))
  expect(cards.map(c => c.props?.borderColor)).toEqual(['rgba(224,108,108,0.45)', 'rgba(128,128,128,0.28)', 'rgba(128,128,128,0.28)'])
  // Reason caption under the title; a running task with no reason has none.
  expect(textNode(cards[0] as Node, /^senden 1 karar bekliyor$/)?.props?.size).toBe('caption')
  expect(textNode(cards[2] as Node, /^Koşan görev bitmeden başlamaz$/)?.props?.size).toBe('caption')
  expect(textNode(cards[1] as Node, /karar|başlamaz/)).toBeUndefined()
  // The stage SVG: current part red on the blocked task only (build = 2nd part; review = 3rd).
  const stage = (c: Node | undefined) => fills(String(nodesOf(c as Node).find(n => n.type === 'Svg' && /aşamanın/.test(String(n.props?.alt)))?.props?.source))
  expect(stage(cards[0])).toEqual([MUTED, STUCK, TRACK, TRACK, TRACK])
  expect(stage(cards[1])).toEqual([MUTED, MUTED, CLAY, TRACK, TRACK])

  const d1 = keyed(root, 'd-d1')
  expect(d1.props?.borderColor).toBe('rgba(224,108,108,0.45)')
  expect(textNode(d1, /^Takıldı · Developer · Takılan görev$/)?.props?.color).toBe('#F2A3A3')
  const d2 = keyed(root, 'd-d2')
  expect(d2.props?.borderColor).toBe('rgba(128,128,128,0.28)')
  expect(textNode(d2, /^Ürün kararı · Koşan görev$/)?.props?.color).toBe('claude')
  expect(keyed(root, 'd-d3').props?.borderColor).toBe('rgba(128,128,128,0.28)')
})

test('detail views show the state: a line in the terminal summary, the chip and reason on desktop', async ($, on) => {
  // Source: brief "Detail views (both surfaces): show the same state line/chip in the summary."
  await boot($, on, STATES)
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await term.press({ key: 'detail-tb' })
  const sum = keyed(await drawnOf(term), 'detail-summary')
  expect(sum.children?.map(c => textOf(c))[1]).toBe('✗ TAKILDI · senden 1 karar bekliyor')
  expect(parts(sum.children?.[1] as Node)[0]).toEqual(['✗ TAKILDI', 'error', 'bold', false])
  await term.press({ key: 'detail-back' })
  await term.unmount()

  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await desk.press({ key: 'detail-tw' })
  const root = await drawnOf(desk)
  expect(keyed(root, 't-tw')).toBeUndefined()
  expect(keyed(root, 'chip-state-tw').props?.backgroundColor).toBe('rgba(229,192,123,0.18)')
  expect(textOf(keyed(root, 'chip-state-tw'))).toBe('⏸ Bekliyor')
  expect(textNode(root, /^Koşan görev bitmeden başlamaz$/)).toBeDefined()
  await desk.unmount()
})
