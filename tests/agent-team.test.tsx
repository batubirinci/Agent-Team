import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { decisionTask, isInside, kararLine, kararLines, otherFiles, otherSession, parseFolders, parseStatus, pickedAt, summary, withKarar } from '../hooks/status'
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
  mock.clock(on)
  mock.store(on)
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

// Clear continuity (owner decision 2026-11-13: after /clear the session stays a team session on the same file, and a resume brings
// the same mode and file back; the Analyst's measurements on CLI 2.1.323: /clear changes the id, fires no session.start, resets
// every atom; session.messages() never lists a plugin's appended rows. Criteria 1-9 of the clear-continuity task, written by the
// Lead). Expected paths, modes and records are spelled out by hand from those, never read back from the code.
const CONT_ROOT = '/Users/x/agent-team-evidence/status'
const OLD = `${CONT_ROOT}/shop--66b9491d.json`
const NEW = `${CONT_ROOT}/shop--dc57ef03.json`
const ID_OLD = '66b9491d-0000-4000-8000-000000000000'
const ID_NEW = 'dc57ef03-0000-4000-8000-000000000000'
const KEY_OLD = `session:${ID_OLD}`
const KEY_NEW = `session:${ID_NEW}`
const CLEAR_NOW = Date.parse('2026-11-13T12:00:00.000Z')
const CLEAR_DAY = 86_400_000
const SWITCH = { isOn: true, source: 'switch' } as const
const FOLDER = { isOn: true, source: 'folder' } as const
const OFF = { isOn: false, source: 'off' } as const
// A store record as the task defines it: { file, mode, at (ISO time), announced? }.
const rec = (file: string, mode: object, extra: object = {}, ms = CLEAR_NOW) => ({ file, mode, at: new Date(ms).toISOString(), ...extra })
// The sentence leadText gains (criterion 9), spelled out by hand.
const LEAD_RULE = 'Dosyada bu oturumdan kalma görevler ve kararlar olabilir: yazmadan önce oku, bitirmediklerini koru, yalnız değişeni güncelle.'
const POLL = 3000
// teamFolders "/" turns team mode on at session.start: no switch row is ever written.
const FOLDERS = { options: { teamFolders: '/' } }

// One session.start with a fake disk (`present` paths), a fake store and clock; reports what the pane read and what the Lead was told.
const continuity = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], entries: Record<string, unknown> = {}) => {
  const present = new Set<string>()
  const state = { id: ID_OLD, messagesCalls: 0, storeFails: false, fsFails: false }
  const read: string[] = []
  const appended: string[] = []
  const sent: (readonly string[] | undefined)[] = []
  const clock = mock.clock(on, { now: CLEAR_NOW })
  // The test owns the plugin's store and its atoms (the engine's `$` has neither noun): a Map each, so a test reads them and /clear wipes the atoms.
  const store = new Map<string, unknown>(Object.entries(entries))
  on('store.get', (_, e) => {
    if (state.storeFails) throw new Error('store down')
    return { value: store.get(e.key) }
  })
  on('store.set', (_, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  const atoms = new Map<string, { value: unknown; version: number }>()
  const slot = (e: { plugin: string; key: string }) => `${e.plugin}/${e.key}`
  on('state.get', (_, e) => ({ value: { value: atoms.get(slot(e))?.value, version: atoms.get(slot(e))?.version ?? 0 } }))
  on('state.set', (_, e) => {
    const version = atoms.get(slot(e))?.version ?? 0
    if (e.ifVersion !== undefined && e.ifVersion !== version) return { value: { isSet: false, version } }
    atoms.set(slot(e), { value: e.value, version: version + 1 })
    return { value: { isSet: true, version: version + 1 } }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/Users/x' }))
  on('session.id', () => ({ value: state.id }))
  // The row form never lists a plugin's appended rows (measured on 2.1.323): the fake lists nothing, and counts the asks.
  on('session.messages', () => {
    state.messagesCalls++
    return { value: [] }
  })
  on('fs.exists', (_, e) => {
    if (state.fsFails) throw new Error('disk down')
    return { value: present.has(e.path) }
  })
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 1, isLink: false } }))
  on('fs.read', (_, e) => {
    read.push(e.path)
    return { value: STATUS }
  })
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
  // The footer chip is the owner's /team switch.
  const team = async () => {
    const foot = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
    await foot.press({ key: 'team-mode' })
    await foot.unmount()
  }
  const leadSees = async () => {
    await $.prompt.submit({ wait: false, origin: { kind: 'composer' }, text: 'merhaba' })
    return { context: (sent.at(-1) ?? []).join('\n') }
  }
  const paneTitle = async () => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const found = await ui.find({ key: 'detail-t1' })
    await ui.unmount()
    return found
  }
  const modeNow = () => (atoms.get('agent-team/mode')?.value as { value: unknown } | undefined)?.value ?? OFF // never written: the atom's default
  const fileNow = () => (atoms.get('agent-team/status')?.value as { value: { file: string } } | undefined)?.value.file
  // What /clear does, as measured (log:12-13, 33-34): a new id, no session.start, every atom back to nothing (its default here);
  // then one poll of the live module.
  const wipe = (id: string) => {
    state.id = id
    atoms.clear()
  }
  const clear = async (id: string) => {
    wipe(id)
    await clock.advance(POLL)
  }
  const teamCommand = () => $.command.run({ command: 'team', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const recordOf = (id: string) => store.get(`session:${id}`)
  return { store, wipe, teamCommand, present, state, read, appended, start, team, leadSees, paneTitle, modeNow, fileNow, clear, recordOf, clock }
}

test('criterion 1: after /clear a switch-mode session is on again within one poll, on the same file; the store holds the record under the new id', async ($, on) => {
  const c = await continuity($, on)
  c.present.add(OLD)
  await c.start()
  await c.team()
  expect(await c.recordOf(ID_OLD)).toEqual(rec(OLD, SWITCH, { announced: OLD }))
  await c.clear(ID_NEW) // one poll, nothing else
  expect(c.modeNow()).toEqual(SWITCH)
  expect(c.fileNow()).toBe(OLD)
  expect(c.read.at(-1)).toBe(OLD)
  expect(await c.paneTitle()).toBeDefined()
  expect(await c.recordOf(ID_NEW)).toEqual(rec(OLD, SWITCH, { announced: OLD }, CLEAR_NOW + POLL))
  const seen = await c.leadSees()
  expect(seen.context).toContain(`${OLD} `)
  expect(seen.context).not.toContain(NEW)
  // It goes on: a second /clear carries it again.
  await c.clear('99999999-0000-4000-8000-000000000000')
  expect(c.modeNow()).toEqual(SWITCH)
  expect((c.store.get('session:99999999-0000-4000-8000-000000000000') as { file: string }).file).toBe(OLD)
})

test('criterion 1: after /clear a folder-mode session is on again on the same file', FOLDERS, async ($, on) => {
  const c = await continuity($, on)
  await c.start()
  expect(c.modeNow()).toEqual(FOLDER)
  await c.clear(ID_NEW)
  expect(c.modeNow()).toEqual(FOLDER)
  expect(c.fileNow()).toBe(OLD)
  expect(await c.recordOf(ID_NEW)).toEqual(rec(OLD, FOLDER, { announced: OLD }, CLEAR_NOW + POLL))
  expect(c.appended).toHaveLength(1) // /clear writes no second row: every prompt carries the path
  expect((await c.leadSees()).context).toContain(`${OLD} `)
})

test('round 2: after /clear, before any poll, the first prompt already carries leadText with the old file (switch and folder)', async ($, on) => {
  // Source: the Lead's round-2 item 2 (the window of up to one poll after /clear must not show the reset atoms to a prompt).
  const c = await continuity($, on)
  c.present.add(OLD)
  await c.start()
  await c.team()
  c.wipe(ID_NEW) // /clear: new id, atoms reset; the clock does not move, so no poll has run
  const seen = await c.leadSees()
  expect(seen.context).toContain(`${OLD} `)
  expect(seen.context).toContain(LEAD_RULE)
  expect(c.modeNow()).toEqual(SWITCH)
  expect(c.recordOf(ID_NEW)).toEqual(rec(OLD, SWITCH, { announced: OLD }))
})

test('round 2: the same in a team folder: the first prompt after /clear, before any poll, carries leadText', FOLDERS, async ($, on) => {
  const c = await continuity($, on)
  await c.start()
  c.wipe(ID_NEW)
  const seen = await c.leadSees()
  expect(seen.context).toContain(`${OLD} `)
  expect(c.modeNow()).toEqual(FOLDER)
})

test('round 2: /team right after /clear, before any poll, toggles the restored mode (on to off), not the reset one', async ($, on) => {
  const c = await continuity($, on)
  c.present.add(OLD)
  await c.start()
  await c.team()
  c.wipe(ID_NEW)
  expect((await c.teamCommand()).text).toBe('Agent Team kapandı.') // it was on: a reset atom would have answered "açık"
  expect(c.modeNow()).toEqual(OFF)
  expect(c.recordOf(ID_NEW)).toEqual(rec(OLD, OFF, {})) // the file is the old one, not ''
  expect((await c.leadSees()).context).toBe('') // off: nothing added
})

test('round 2: a store that fails cannot stop the prompt; the carry is tried again at the next prompt', async ($, on) => {
  const c = await continuity($, on)
  c.present.add(OLD)
  await c.start()
  await c.team()
  c.wipe(ID_NEW)
  c.state.storeFails = true
  expect((await c.leadSees()).context).toBe('') // the prompt goes through; the atoms are still reset
  expect(c.modeNow()).toEqual(OFF)
  c.state.storeFails = false
  expect((await c.leadSees()).context).toContain(`${OLD} `) // the failed carry was not counted as done
  expect(c.modeNow()).toEqual(SWITCH)
})

test('round 3: a session that never was a team session: /clear, then /team before any poll saves and announces the session\'s own file; a second /clear and a new process keep the mode', async ($, on) => {
  // Source: QA round 1 finding 1 (reproduced live 3/3): the reset status.file was '' and /team saved and announced it.
  const ID_3 = '33333333-0000-4000-8000-000000000000'
  const c = await continuity($, on)
  c.present.add(OLD)
  await c.start() // not a team session: no record
  c.wipe(ID_NEW)
  await c.teamCommand() // no poll has run
  expect(c.appended).toHaveLength(1)
  expect(c.appended[0]).toContain(`dosyası: ${OLD} (biçimi`)
  expect(c.recordOf(ID_NEW)).toEqual(rec(OLD, SWITCH, { announced: OLD }))
  await c.clear(ID_3) // a second /clear
  expect(c.modeNow()).toEqual(SWITCH)
  expect(c.fileNow()).toBe(OLD)
  c.wipe(ID_3) // quit and --continue: a new process, empty atoms, the id it ended with
  await c.start()
  expect(c.modeNow()).toEqual(SWITCH)
  expect(c.fileNow()).toBe(OLD)
  expect(c.appended).toHaveLength(1)
})

test('round 3: the footer chip right after /clear, before any poll, announces the real path, never an empty one', async ($, on) => {
  // Source: QA round 1 finding 2: the chip and the pane buttons call setMode, which read the reset atoms.
  const c = await continuity($, on)
  await c.start()
  c.wipe(ID_NEW)
  await c.team()
  expect(c.appended).toHaveLength(1)
  expect(c.appended[0]).toContain(`dosyası: ${OLD} (biçimi`)
  expect(c.recordOf(ID_NEW)).toEqual(rec(OLD, SWITCH, { announced: OLD }))
})

test('round 3: with a store that fails, /team after /clear still saves and announces the session\'s own file, not an empty one', async ($, on) => {
  const c = await continuity($, on)
  await c.start()
  c.wipe(ID_NEW)
  c.state.storeFails = true
  await c.teamCommand()
  expect(c.appended[0]).toContain(`dosyası: ${OLD} (biçimi`)
  expect(c.recordOf(ID_NEW)).toEqual(rec(OLD, SWITCH, { announced: OLD }))
})

test('round 3: with a disk that fails, /team after /clear still saves and announces the session\'s own file, not an empty one', async ($, on) => {
  const c = await continuity($, on)
  await c.start()
  c.wipe(ID_NEW)
  c.state.fsFails = true // the path cannot be refreshed: the file this module follows stands in
  await c.teamCommand()
  expect(c.appended[0]).toContain(`dosyası: ${OLD} (biçimi`)
  expect(c.recordOf(ID_NEW)).toEqual(rec(OLD, SWITCH, { announced: OLD }))
})

test('round 3: /clear then a quit before the first poll still leaves a record under the new id (session.end carries it a moment later)', async ($, on) => {
  // Source: QA round 1 finding 3. The probe (log:12-13) shows session.end with the old id, the new id a moment after.
  const c = await continuity($, on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  c.present.add(OLD)
  await c.start()
  await c.team()
  await $.session.end({ reason: 'clear', sessionId: ID_OLD, resume: { id: ID_OLD } })
  c.wipe(ID_NEW) // the id changes and the atoms reset after session.end
  await c.clock.advance(600) // less than the 3 s poll
  expect(c.recordOf(ID_NEW)).toEqual(rec(OLD, SWITCH, { announced: OLD }, CLEAR_NOW + 500)) // the timer fires at 500 ms
  expect(c.modeNow()).toEqual(SWITCH)
})

test('round 4: a team session turned off by the footer chip after /clear, before any poll, ends off and stays off after the poll', async ($, on) => {
  // Source: QA round 2 finding 1 (mutant R4, probe I): the chip was drawn as on before /clear, its press is the owner's "off".
  const c = await continuity($, on)
  c.present.add(OLD)
  await c.start()
  await c.team()
  const foot = await $.ui.mount({ ...FOOTER, surface: 'desktop' }) // drawn on
  c.wipe(ID_NEW) // /clear: new id, atoms reset, no poll yet
  await foot.press({ key: 'team-mode' })
  await foot.unmount()
  expect(c.modeNow()).toEqual(OFF)
  expect(c.recordOf(ID_NEW)).toEqual(rec(OLD, OFF, {}))
  await c.clock.advance(POLL)
  expect(c.modeNow()).toEqual(OFF) // the poll must not bring the old mode back
  expect(c.recordOf(ID_NEW)).toEqual(rec(OLD, OFF, {})) // and the record still says off
})

test('round 4: a folder session after /clear, chip pressed before any poll: no second announce row, the source stays folder', FOLDERS, async ($, on) => {
  // Source: QA round 2 finding 1 (probe J) and criterion 7 (one announce per path).
  const c = await continuity($, on)
  await c.start()
  expect(c.appended).toHaveLength(1)
  c.wipe(ID_NEW)
  await c.team() // the chip is drawn from the reset atoms (off): a press asks for "on"
  expect(c.appended).toHaveLength(1)
  expect(c.modeNow()).toEqual(FOLDER)
  expect(c.recordOf(ID_NEW)).toEqual(rec(OLD, FOLDER, { announced: OLD }))
})

test('round 4: never-team session, /clear, /team, then a prompt before any poll: leadText carries the real file, never an empty path', async ($, on) => {
  // Source: QA round 2 finding 2 (mutant R3b, probe H): follow restores the status atom first, whatever the store says.
  const c = await continuity($, on)
  await c.start()
  c.wipe(ID_NEW)
  await c.teamCommand()
  const seen = await c.leadSees()
  expect(seen.context).toContain(`dosyası: ${OLD} (biçimi`)
  expect(seen.context).not.toContain('dosyası:  (')
  expect(c.fileNow()).toBe(OLD)
})

test('criterion 1: a session switched off before /clear stays off; a session that was never a team session leaves no record', async ($, on) => {
  const c = await continuity($, on)
  await c.start()
  await c.clear(ID_NEW) // never a team session
  expect(c.modeNow()).toEqual(OFF)
  expect([...c.store.keys()]).toEqual([])
  await c.team()
  await c.team() // on, then off again
  expect(await c.recordOf(ID_NEW)).toEqual(rec(OLD, OFF, {}, CLEAR_NOW + POLL))
  await c.clear('99999999-0000-4000-8000-000000000000')
  expect(c.modeNow()).toEqual(OFF)
})

test('criterion 2: a new process whose session id has a record with an existing file takes that file and that mode (switch included), and tells the Lead nothing new', async ($, on) => {
  const c = await continuity($, on, { [KEY_NEW]: rec(OLD, SWITCH, { announced: OLD }) })
  c.state.id = ID_NEW
  c.present.add(OLD)
  await c.start()
  expect(c.read.at(-1)).toBe(OLD)
  expect(c.read).not.toContain(NEW)
  expect(c.modeNow()).toEqual(SWITCH)
  expect(await c.paneTitle()).toBeDefined()
  expect(c.appended).toHaveLength(0)
  const seen = await c.leadSees()
  expect(seen.context).toContain(`${OLD} `)
  expect(seen.context).not.toContain(NEW)
  expect(c.state.messagesCalls).toBe(0) // criterion 6
})

test('criterion 3: a record whose file is gone gives today\'s new path; the mode is the record\'s', async ($, on) => {
  const c = await continuity($, on, { [KEY_NEW]: rec(OLD, SWITCH, { announced: OLD }) })
  c.state.id = ID_NEW // OLD is not on disk
  await c.start()
  expect(c.read).toEqual([])
  expect(c.modeNow()).toEqual(SWITCH)
  expect(c.fileNow()).toBe(NEW)
  expect((await c.leadSees()).context).toContain(`${NEW} `)
  expect(await c.recordOf(ID_NEW)).toMatchObject({ file: NEW, mode: SWITCH })
  c.present.add(NEW)
  await c.start()
  expect(c.read.at(-1)).toBe(NEW)
})

test('criterion 3: a record whose file is gone, in a team folder: the new path, folder mode', FOLDERS, async ($, on) => {
  const c = await continuity($, on, { [KEY_NEW]: rec(OLD, OFF) })
  c.state.id = ID_NEW
  await c.start()
  expect(c.fileNow()).toBe(NEW)
  expect(c.modeNow()).toEqual(FOLDER)
})

test('criterion 4: a brand-new session gets today\'s new path and mode off, and leaves no record', async ($, on) => {
  const c = await continuity($, on)
  c.state.id = ID_NEW
  await c.start()
  expect(c.read).toEqual([])
  expect(c.fileNow()).toBe(NEW)
  expect(c.modeNow()).toEqual(OFF)
  expect([...c.store.keys()]).toEqual([])
  expect(c.appended).toHaveLength(0)
  expect(c.state.messagesCalls).toBe(0) // criterion 6
})

test('criterion 5: a reload keeps the path the atom holds, even when the session id changed and a record names another existing file', async ($, on) => {
  const OTHER = `${CONT_ROOT}/shop--11111111.json`
  const c = await continuity($, on, { [KEY_NEW]: rec(OTHER, SWITCH, { announced: OTHER }) })
  await c.start()
  expect(c.read).toEqual([]) // nothing on disk yet: the new path, nothing read
  c.present.add(OLD) // the Lead wrote it
  c.present.add(OTHER)
  c.state.id = ID_NEW // /reload-plugins after the session got another id
  await c.start()
  expect(c.read.at(-1)).toBe(OLD)
  expect(c.read).not.toContain(OTHER)
  expect(c.read).not.toContain(NEW)
  expect(await c.paneTitle()).toBeDefined()
  const seen = await c.leadSees() // the record's mode (switch) is on
  expect(seen.context).toContain(`${OLD} `)
  expect(seen.context).not.toContain(OTHER)
})

test('criterion 6: no start and no poll asks the history for the status path', async ($, on) => {
  const c = await continuity($, on, { [KEY_NEW]: rec(OLD, SWITCH, { announced: OLD }) })
  c.present.add(OLD)
  await c.start()
  await c.team()
  await c.clear(ID_NEW)
  await c.start()
  expect(c.state.messagesCalls).toBe(0)
})

test('criterion 7: team mode by folder tells the Lead the path once per path (stored), not on a reload nor after /clear, and again only for a new path', FOLDERS, async ($, on) => {
  const c = await continuity($, on)
  await c.start()
  expect(c.appended).toHaveLength(1)
  expect(c.appended[0]).toContain(`dosyası: ${OLD} (biçimi`)
  expect(await c.recordOf(ID_OLD)).toMatchObject({ announced: OLD })
  c.present.add(OLD) // the Lead wrote it
  await c.start() // /reload-plugins: same id, same path
  expect(c.appended).toHaveLength(1)
  expect(c.read.at(-1)).toBe(OLD)
  await c.clear(ID_NEW)
  await c.start() // reload after /clear: the carried record says it was told
  expect(c.appended).toHaveLength(1)
  c.present.delete(OLD) // the file is gone: a new path is a new announcement
  await c.start()
  expect(c.appended).toHaveLength(2)
  expect(c.appended[1]).toContain(`dosyası: ${NEW} (biçimi`)
  expect(await c.recordOf(ID_NEW)).toMatchObject({ announced: NEW })
})

test('criterion 7: a resumed folder-mode process with the same path writes no row', FOLDERS, async ($, on) => {
  const c = await continuity($, on, { [KEY_NEW]: rec(OLD, FOLDER, { announced: OLD }) })
  c.state.id = ID_NEW
  c.present.add(OLD)
  await c.start()
  expect(c.read.at(-1)).toBe(OLD)
  expect(c.appended).toHaveLength(0)
})

test('criterion 7: mode off writes no row, start after start', async ($, on) => {
  const c = await continuity($, on)
  await c.start()
  await c.start()
  expect(c.appended).toHaveLength(0)
})

test('criterion 8: at session.start only records older than 30 days go; the session\'s own record is kept and refreshed', async ($, on) => {
  const c = await continuity($, on, {
    'session:stale': rec(OLD, SWITCH, {}, CLEAR_NOW - 31 * CLEAR_DAY),
    'session:fresh': rec(OLD, SWITCH, {}, CLEAR_NOW - 29 * CLEAR_DAY),
    'session:junk': 'not a record',
    other: rec(OLD, SWITCH, {}, CLEAR_NOW - 99 * CLEAR_DAY),
    [KEY_OLD]: rec(OLD, SWITCH, { announced: OLD }, CLEAR_NOW - 40 * CLEAR_DAY),
  })
  c.present.add(OLD)
  await c.start()
  expect([...c.store.keys()].sort()).toEqual(['other', 'session:fresh', 'session:junk', KEY_OLD].sort())
  expect(await c.recordOf(ID_OLD)).toEqual(rec(OLD, SWITCH, { announced: OLD }))
  expect(c.modeNow()).toEqual(SWITCH) // the 40-day-old record of this very session still brings its mode back
})

test('criterion 8: a corrupt record is ignored (not an object, file not a string, path outside <evidence root>/status/ or not .json)', async ($, on) => {
  const GOOD = `${CONT_ROOT}/shop--11111111.json`
  const good = rec(GOOD, SWITCH, { announced: GOOD })
  const bad: [string, unknown][] = [
    ['a string', 'x'],
    ['an array', [good]],
    ['null', null],
    ['file is a number', { ...good, file: 42 }],
    ['no file', { mode: SWITCH, at: good.at }],
    ['outside the root', { ...good, file: '/etc/passwd.json' }],
    ['another folder', { ...good, file: '/Users/x/agent-team-evidence/other/shop--11111111.json' }],
    ['dot dot', { ...good, file: `${CONT_ROOT}/../outside/shop--11111111.json` }],
    ['a subfolder', { ...good, file: `${CONT_ROOT}/sub/shop--11111111.json` }],
    ['not .json', { ...good, file: `${CONT_ROOT}/shop--11111111.txt` }],
    ['a sibling folder with the same prefix', { ...good, file: '/Users/x/agent-team-evidence/statusX/shop--11111111.json' }],
    ['mode is not a mode', { ...good, mode: 'on' }],
  ]
  const c = await continuity($, on)
  c.state.id = ID_NEW
  for (const [name, value] of bad) {
    // Every path exists: only the record's shape can reject it.
    c.present.add(typeof (value as { file?: unknown })?.file === 'string' ? (value as { file: string }).file : GOOD)
    c.store.set(KEY_NEW, value)
    await c.start()
    expect(c.read, name).toEqual([])
    expect(c.fileNow(), name).toBe(NEW)
    expect(c.modeNow(), name).toEqual(OFF)
  }
  // The same shape with a good file is taken.
  c.store.set(KEY_NEW, good)
  c.present.add(GOOD)
  await c.start()
  expect(c.read.at(-1)).toBe(GOOD)
  expect(c.modeNow()).toEqual(SWITCH)
})

test('criterion 9: every prompt in team mode tells the Lead that the file may already hold tasks and decisions: read it first, keep what is unfinished', async ($, on) => {
  const c = await continuity($, on)
  await c.start()
  await c.team()
  expect((await c.leadSees()).context).toContain(LEAD_RULE)
  expect(c.appended.at(-1)).toContain(LEAD_RULE) // the open row carries leadText too
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
  mock.clock(on)
  mock.store(on)
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
  expect(hint && textOf(hint)).toBe('a-o ayrıntı  1-9 karar seç  p pause  esc çık')
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
  // Lead's rule change (revision 1): the kind is trimmed and matched case-insensitively with Turkish rules ("TAKILDI" -> "takıldı").
  for (const kind of ['takıldı', 'TAKILDI', ' Takıldı', 'Takıldı · Developer']) {
    expect(stateOf([task({ roles: [run] })], [ask(kind)])).toEqual(['blocked', 'senden 1 karar bekliyor'])
  }
  expect(stateOf([task({ roles: [run] })], [ask('Bu takıldı mı')])[0]).toBe('running')
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

// Revision 1 (QA findings, LOW): a decision with no kind and no task draws no empty child; a decision naming a task that is not
// in the file shows its kind only and is not red; zero parts are left out of the desktop header; the blocked reason caption is #F2A3A3.
const LOOSE = JSON.stringify({
  v: 1,
  decisions: [
    { id: 'dn', text: 'Kindsiz soru', options: ['Tamam'] },
    { id: 'dx', kind: 'Takıldı · Developer', text: 'Olmayan görev', task: 'yok', options: ['Tamam'] },
  ],
  tasks: [task({ id: 'a', roles: [run] }), task({ id: 'b', roles: [run] })],
})
const emptyChild = (n: Node): boolean => (n.children ?? []).some(c => c === '' || (typeof c !== 'string' && emptyChild(c)))

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: a decision with no kind and no task draws no empty child; an unknown task id shows the kind only, not red`, async ($, on) => {
    await boot($, on, LOOSE)
    const root = await drawnOf(await $.ui.mount({ ...PANE, surface }))
    expect(emptyChild(keyed(root, 'd-dn'))).toBe(false)
    expect(textNode(keyed(root, 'd-dn'), /Kindsiz soru/)).toBeDefined()
    const dx = keyed(root, 'd-dx')
    expect(textNode(dx, /^Takıldı · Developer$/)?.props?.color).toBe('claude')
    expect(dx.props?.borderColor).toBe(surface === 'terminal' ? 'subtle' : 'rgba(128,128,128,0.28)')
  })
}

test('desktop: the header leaves out takıldı and bekliyor at zero', async ($, on) => {
  await boot($, on, LOOSE)
  const root = await drawnOf(await $.ui.mount({ ...PANE, surface: 'desktop' }))
  expect(textOf(textNode(root, /çalışıyor/) as Node)).toBe('2 çalışıyor · 2 görev')
})

test('desktop: the blocked reason caption is #F2A3A3, any other reason is dim', async ($, on) => {
  await boot($, on, STATES)
  const root = await drawnOf(await $.ui.mount({ ...PANE, surface: 'desktop' }))
  expect(textNode(keyed(root, 't-tb'), /^senden 1 karar bekliyor$/)?.props?.color).toBe('#F2A3A3')
  const wait = textNode(keyed(root, 't-tw'), /^Koşan görev bitmeden başlamaz$/)
  expect([wait?.props?.color, wait?.props?.dimColor]).toEqual([undefined, true])
})

// QA follow-ups (task qa-fixes). Sources: the Lead's brief for the qa-fixes task, criteria 1-8 (each group names its number),
// and the owner decision of 2026-11-13 for 7. Every expected value is written by hand from those criteria.

test('criterion 1: an open detail shows the read error line, desktop and terminal, and keeps its content', async ($, on) => {
  let text = DETAIL
  let mtime = 1
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/Users/x' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: mtime, isLink: false } }))
  on('fs.read', () => ({ value: text }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const start = () => $.session.start({ cwd: '/Users/x/Projeler/shop', surface: 'desktop', isInteractive: true })
  await start()
  const ERR = /^Durum dosyası okunamadı: ./
  for (const surface of ['desktop', 'terminal'] as const) {
    text = DETAIL
    mtime += 1
    await start()
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'detail-t1' })
    // Read fine: no error line in the detail.
    expect(textNode(await drawnOf(ui), ERR)).toBeUndefined()
    await ui.unmount()

    text = '{ bozuk'
    mtime += 1
    await start()
    const bad = await $.ui.mount({ ...PANE, surface })
    const root = await drawnOf(bad)
    expect(textNode(root, ERR)?.props?.color).toBe('error')
    // The detail itself is unchanged: still open, with its title and rounds from the last good read.
    expect(keyed(root, 'detail-back')).toBeDefined()
    expect(textNode(root, /^Seçim kutusu taşması$/)).toBeDefined()
    expect(textNode(root, /^Tur 2 · GO/)).toBeDefined()
    await bad.press({ key: 'detail-back' })
    await bad.unmount()
  }
})

test('criterion 2: a round with n 0, missing or invalid gets its position (j+1), "Tur 0" is never drawn', async ($, on) => {
  const rounds = [{ n: 0, verdict: 'GO' }, { verdict: 'GO' }, { n: 5, verdict: 'GO' }, { n: -1, verdict: 'GO' }, { n: 'x', verdict: 'NO-GO' }]
  const text = detailStatus({ rounds })
  expect(parseStatus(text).tasks[0]?.rounds?.map(r => r.n)).toEqual([1, 2, 5, 4, 5])
  await boot($, on, detailStatus({ rounds: [{ n: 0, verdict: 'GO' }] }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'detail-t1' })
    const root = await drawnOf(ui)
    expect(textNode(root, /Tur 0/)).toBeUndefined()
    expect(textNode(root, /^Tur 1 · GO$/)).toBeDefined()
    if (surface === 'desktop') expect(textNode(root, /^GO · 1 tur$/)).toBeDefined()
    await ui.press({ key: 'detail-back' })
    await ui.unmount()
  }
})

test('criterion 3: above 10 findings keep 10, BLOCKING (any case) first; at most 10 stay in file order', async () => {
  const whats = (findings: unknown[]) => parseStatus(detailStatus({ rounds: [{ n: 1, verdict: 'GO', findings }] })).tasks[0]?.rounds?.[0]?.findings.map(f => f.what)
  const f = (i: number, severity?: string) => ({ what: `f${i}`, severity })
  // 12 findings: BLOCKING at positions 10 (upper case) and 11 (lower case) are kept, the last two non-blocking (f8, f9) drop.
  const mixed = [...Array.from({ length: 10 }, (_, i) => f(i, 'LOW')), f(10, 'BLOCKING'), f(11, 'blocking')]
  expect(whats(mixed)).toEqual(['f10', 'f11', 'f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'])
  // Interleaved: blocking first, then the rest in file order.
  const inter = [f(0, 'LOW'), f(1, 'BLOCKING'), f(2), f(3, 'LOW'), f(4, 'Blocking'), ...Array.from({ length: 7 }, (_, i) => f(i + 5, 'LOW'))]
  expect(whats(inter)).toEqual(['f1', 'f4', 'f0', 'f2', 'f3', 'f5', 'f6', 'f7', 'f8', 'f9'])
  // 11 non-blocking: the first 10 in file order; 12 blocking: the first 10 in file order.
  expect(whats(Array.from({ length: 11 }, (_, i) => f(i, 'LOW')))).toEqual(Array.from({ length: 10 }, (_, i) => `f${i}`))
  expect(whats(Array.from({ length: 12 }, (_, i) => f(i, 'BLOCKING')))).toEqual(Array.from({ length: 10 }, (_, i) => `f${i}`))
  // 10 or fewer: nothing is dropped, file order kept.
  expect(whats([f(0, 'LOW'), f(1, 'BLOCKING')])).toEqual(['f0', 'f1'])
})

test('criterion 4: a finding without severity and origin draws the "what" line first, desktop and terminal', async ($, on) => {
  await boot($, on, detailStatus({ rounds: [{ n: 1, verdict: 'GO', findings: [{ what: 'Yalnız ne', where: 'a.ts:1' }, { severity: 'LOW', what: 'Etiketli' }, { origin: 'introduced', what: 'Kökenli' }] }] }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'detail-t1' })
    const root = await drawnOf(ui)
    expect((keyed(root, 'round-0-f-0').children as Node[]).map(textOf)).toEqual(['Yalnız ne', 'a.ts:1'])
    expect((keyed(root, 'round-0-f-1').children as Node[]).map(textOf)).toEqual(['LOW', 'Etiketli'])
    expect((keyed(root, 'round-0-f-2').children as Node[]).map(textOf)).toEqual(['introduced', 'Kökenli'])
    await ui.press({ key: 'detail-back' })
    await ui.unmount()
  }
})

test('criterion 5: summary() names a running role only from running tasks, not from a blocked one', async () => {
  const sum = (tasks: unknown[], decisions: unknown[] = []) => summary(parseStatus(JSON.stringify({ v: 1, tasks, decisions })))
  const qa = { name: 'QA · GPT-6 Astra', state: 'inceliyor', status: 'running' }
  // Blocked by a role: its running role is not shown.
  expect(sum([task({ roles: [run, stuck] })])).toBe('1 görev')
  // Blocked by a "Takıldı" decision: the decision count shows, the running role does not.
  expect(sum([task({ roles: [run] })], [ask('Takıldı')])).toBe('1 karar bekliyor · 1 görev')
  // The running role of the next, running task is the one named.
  expect(sum([task({ roles: [run, stuck] }), task({ id: 't2', roles: [qa] })])).toBe('QA inceliyor · 2 görev')
  // Unchanged for a running task.
  expect(sum([task({ roles: [run] })])).toBe('Developer yazıyor · 1 görev')
})

test('criterion 6: a task without an id gets a generated id, but no decision links to it', async () => {
  const text = JSON.stringify({
    v: 1,
    decisions: [ask('Takıldı · Developer', 't1')],
    tasks: [{ title: 'Kimliksiz', stage: 'build', roles: [run] }],
  })
  const s = parseStatus(text)
  expect(s.tasks[0]?.id).toBe('t1')
  expect([s.tasks[0]?.state, s.tasks[0]?.reason]).toEqual(['running', undefined])
  expect(decisionTask(s.decisions[0]!, s.tasks)).toEqual({ kind: 'Takıldı · Developer', blocked: false })
  // A written id links as before.
  const w = parseStatus(JSON.stringify({ v: 1, decisions: [ask('Takıldı · Developer', 't1')], tasks: [{ id: 't1', title: 'Kimlikli', stage: 'build', roles: [run] }] }))
  expect([w.tasks[0]?.state, w.tasks[0]?.reason]).toEqual(['blocked', 'senden 1 karar bekliyor'])
  expect(decisionTask(w.decisions[0]!, w.tasks)).toEqual({ kind: 'Takıldı · Developer · Kimlikli', blocked: true })
})

test('criterion 7: a decision kind starting with takıldı or takildi in any letter case blocks the task', async () => {
  for (const kind of ['Takildi', 'TAKILDI', 'TAKİLDİ', 'takildi · Developer', ' TAKİLDİ', 'Takıldı', 'takıldı']) {
    expect(stateOf([task({ roles: [run] })], [ask(kind)])).toEqual(['blocked', 'senden 1 karar bekliyor'])
  }
  for (const kind of ['Bu takildi mı', 'Takilmis', 'Ürün kararı']) expect(stateOf([task({ roles: [run] })], [ask(kind)])[0]).toBe('running')
})

test('criterion 8: "Henüz review turu yok." is not drawn for a task that has rounds (terminal; the desktop has no such line)', async ($, on) => {
  await boot($, on, DETAIL)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'detail-t1' })
    const root = await drawnOf(ui)
    expect(textNode(root, /Tur 1/)).toBeDefined()
    expect(textNode(root, /Henüz review turu yok/)).toBeUndefined()
    await ui.press({ key: 'detail-back' })
    await ui.unmount()
  }
})

// Other sessions' decisions (owner report 2026-11-13: a decision waited in another team session's pane; the approved design
// "Diğer oturumların kararları", four frames; criteria 1-7 of the other-decisions task). Expected strings are spelled out from
// that design and the brief, never read back from the implementation. A fixed clock and fixed mtimes; no real disk.
const DIR = '/Users/x/agent-team-evidence/status'
const OWN_PATH = `${DIR}/shop.json`
const DAY = 86_400_000 // 24 h in ms, by hand: 24 * 60 * 60 * 1000
const KIB256 = 262_144 // 256 KiB in bytes, by hand: 256 * 1024
const NOW = new Date(2026, 10, 13, 15, 0).getTime() // local 15:00, the same clock as the mtimes below
const at = (h: number, m: number) => new Date(2026, 10, 13, h, m).getTime()
type Entry = { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number; isLink: boolean }
const entry = (name: string, over: Partial<Entry> = {}): Entry => ({ name, kind: 'file', size: 1000, mtimeMs: NOW - 60_000, isLink: false, ...over })
const decisionsOnly = (n: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ v: 1, ...extra, decisions: Array.from({ length: n }, (_, i) => ({ id: `d${i}`, text: `Soru ${i}`, options: ['Evet', 'Hayır'] })) })
const OWN = JSON.stringify({ v: 1, lead: 'Opus 5.5', tasks: [{ id: 't1', title: 'Kendi görevim', stage: 'build' }] })

// The design's own two sessions: bbirinci (3 decisions, the first takıldı) and NorthScore (1), the second with no updatedAt (time from mtime).
const BBIRINCI = JSON.stringify({
  v: 1,
  updatedAt: '2026-11-13T14:20:00+03:00',
  decisions: [
    { id: 'd1', kind: 'Takıldı', task: 't1', text: "Developer başlatılamadı: ajan başlatma hook'u reddetti. Ne yapayım?", options: ['Başlatmayı ben onaylarım', "Plugin'i kapat"] },
    { id: 'd2', kind: 'Ürün kararı', task: 't2', text: "Katalog kodunu Faz A'yı beklemeden ayrı dalda başlatayım mı?", options: ['Başlat', "Faz A'yı bekle"] },
    { id: 'd3', kind: 'Onay', task: 't3', text: "Aday 3b36da7 GO aldı. main'e birleştireyim mi?", options: ['Birleştir', 'Bekle'] },
  ],
  tasks: [
    { id: 't1', title: 'C1 ai-deploy kapı çekirdeği', stage: 'build' },
    { id: 't2', title: 'Faz M modül kataloğu', stage: 'build' },
    { id: 't3', title: 'Faz A ön-uçuş', stage: 'review' },
  ],
})
const NORTH = JSON.stringify({
  v: 1,
  decisions: [{ id: 'd1', kind: 'Soru', task: 't1', text: 'Grafik haftalık mı aylık mı gösterilsin?', options: ['Haftalık', 'Aylık'] }],
  tasks: [{ id: 't1', title: 'Rapor sayfası', stage: 'build' }],
})
const BB = 'bbirinci--350e44d7.json'
const NS = 'NorthScore--1a2b3c4d.json'
const DESIGN_LISTING = [entry(BB, { mtimeMs: at(14, 25) }), entry(NS, { mtimeMs: at(13, 5) })]
const DESIGN_FILES = { [BB]: BBIRINCI, [NS]: NORTH }

type OtherLog = { read?: string[]; say?: string[]; fill?: string[]; appended?: string[]; opened?: string[]; ticks?: string[]; refused?: string[]; refusing?: { on: boolean }; own?: string | null }
const bootOthers = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], surface: 'desktop' | 'terminal', listing: Entry[], files: Record<string, string>, log: OtherLog = {}) => {
  const own = log.own === undefined ? OWN : log.own
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => {
    log.opened?.push('open')
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/Users/x' }))
  on('fs.exists', (_, e) => ({ value: own !== null && e.path === OWN_PATH }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 1, isLink: false } }))
  on('fs.list', (_, e) => {
    expect(e.path).toBe(DIR)
    return { value: listing }
  })
  on('fs.read', (_, e) => {
    if (e.path === OWN_PATH) return { value: own ?? '' }
    const name = e.path.slice(DIR.length + 1)
    log.read?.push(name)
    if (!(name in files)) throw new Error('okunamadı')
    return { value: files[name] as string }
  })
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => {
    log.ticks?.push('every')
    return { value: undefined }
  })
  if (log.refusing)
    on('state.get', (_, e, next) => {
      if (e.key === 'others' && log.refusing?.on) {
        log.refused?.push('get')
        return { value: undefined } as never // a reply the engine cannot read: reading the atom rejects
      }
      return next(e)
    })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.append', (_, e, next) => {
    log.appended?.push('row')
    return next(e)
  })
  on('prompt.submit', (_, e) => {
    log.say?.push(e.text)
    return { text: e.text }
  })
  on('prompt.fill', (_, e) => {
    log.fill?.push(e.text)
    return { isFilled: true }
  })
  await $.session.start({ cwd: '/Users/x/Projeler/shop', surface, isInteractive: true })
}
const textIn = (root: Node, s: string) => nodesOf(root).some(n => n.type === 'Text' && textOf(n) === s)
const otherBoxes = (root: Node) => nodesOf(root).filter(n => String(n.props?.key).startsWith('other-'))

test('other sessions, which files count (criterion 1: regular, .json, not own, under 24 h, at most 256 KiB, newest 20)', async () => {
  // Source: the brief's criterion 1; boundaries computed by hand (DAY, KIB256 above). Exactly 24 h old is not "in the last 24 hours".
  const names = (l: Entry[]) => otherFiles(l, DIR, OWN_PATH, NOW).map(x => x.name)
  expect(names([entry('a--1.json'), entry('shop.json')])).toEqual(['a--1.json'])
  expect(names([entry('in.json', { mtimeMs: NOW - DAY + 1 }), entry('out.json', { mtimeMs: NOW - DAY })])).toEqual(['in.json'])
  expect(names([entry('fit.json', { size: KIB256 }), entry('big.json', { size: KIB256 + 1 })])).toEqual(['fit.json'])
  expect(names([entry('l1.json', { kind: 'other', isLink: true, size: 0, mtimeMs: 0 }), entry('l2.json', { isLink: true })])).toEqual([])
  expect(names([entry('notes.txt'), entry('json'), entry('d.json', { kind: 'dir' })])).toEqual([])
  // Newest first, at most 20: 21 entries, mtimes NOW-1s ... NOW-21s; the 21st (oldest) is left out.
  const many = Array.from({ length: 21 }, (_, i) => entry(`f${i}.json`, { mtimeMs: NOW - 1000 * (i + 1) }))
  const got = names([...many].reverse())
  expect(got.length).toBe(20)
  expect(got[0]).toBe('f0.json')
  expect(got).not.toContain('f20.json')
})

test('other sessions, wiring: 21 files give 20 reads, an unreadable or unparsable file or one with no decision is skipped silently, own is not counted (criteria 1, 2)', async ($, on) => {
  const read: string[] = []
  const listing = [
    entry('shop.json', { mtimeMs: NOW }), // own: never counted even with decisions
    ...Array.from({ length: 21 }, (_, i) => entry(`p${i}--0000000${i % 10}.json`, { mtimeMs: NOW - 1000 * (i + 1) })),
    entry('stale--aaaaaaaa.json', { mtimeMs: NOW - DAY }),
  ]
  const files: Record<string, string> = Object.fromEntries(listing.slice(1, 22).map(e => [e.name, decisionsOnly(1)]))
  files['p3--00000003.json'] = 'not json' // unparsable
  files['p4--00000004.json'] = JSON.stringify({ v: 1, decisions: [], tasks: [] }) // no decision
  delete files['p5--00000005.json'] // read fails
  files['stale--aaaaaaaa.json'] = decisionsOnly(1)
  await bootOthers($, on, 'desktop', listing, files, { read, own: decisionsOnly(7) })
  expect(read.length).toBe(20)
  expect(read).not.toContain('p20--00000000.json')
  expect(read).not.toContain('stale--aaaaaaaa.json')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // 20 read; 3 of them give nothing (unparsable, empty, unreadable): 17 sessions with 1 decision each; own's 7 are not in it.
  expect(textIn(await drawnOf(ui), 'Diğer oturumlarda 17 karar bekliyor')).toBe(true)
  await ui.unmount()
})

test('desktop: the strip under the header, collapsed first, then each session in a card; Göster/Gizle toggle and it is remembered (criteria 3, 4, 6)', async ($, on) => {
  await bootOthers($, on, 'desktop', DESIGN_LISTING, DESIGN_FILES)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const root = await drawnOf(ui)

  // Criterion 3 (design frame 1): amber 8 px dot, bold title, per-session counts, Göster; above "Senin sıran" / the tasks.
  expect(textIn(root, 'Diğer oturumlarda 4 karar bekliyor')).toBe(true)
  expect(textIn(root, 'bbirinci · 3 karar (1 takıldı) · NorthScore · 1 karar')).toBe(true)
  expect(textNode(root, /^Diğer oturumlarda 4 karar bekliyor$/)?.props).toMatchObject({ weight: 'semibold' })
  expect(nodesOf(root).find(n => n.props?.key === 'others-toggle')?.props?.label).toBe('Göster')
  const dot = nodesOf(root).find(n => n.type === 'Svg' && n.props?.alt === 'diğer oturumlarda karar bekliyor')
  expect(dot?.props).toMatchObject({ width: 8, height: 8 })
  expect(String(dot?.props?.source)).toContain('fill="#E5C07B"')
  expect(textIn(root, 'Diğer oturumlar')).toBe(false)
  const order = nodesOf(root).map(n => String(n.props?.key))
  expect(order.indexOf('others-toggle')).toBeGreaterThan(order.indexOf('pause'))
  expect(order.indexOf('others-toggle')).toBeLessThan(order.indexOf('t-t1'))
  expect(otherBoxes(root)).toEqual([])

  // Criterion 4 (design frame 2): header row, a card per session newest first, options as text, the footnote.
  await ui.press({ key: 'others-toggle' })
  const open = await drawnOf(ui)
  expect(textIn(open, 'Diğer oturumlarda 4 karar bekliyor')).toBe(false)
  expect(textNode(open, /^Diğer oturumlar$/)?.props).toMatchObject({ weight: 'semibold' })
  expect(textIn(open, '4 karar')).toBe(true)
  expect(nodesOf(open).find(n => n.props?.key === 'others-toggle')?.props?.label).toBe('Gizle')
  expect(otherBoxes(open).map(b => b.props?.key)).toEqual([`other-${BB}`, `other-${NS}`])
  const [bb, ns] = otherBoxes(open) as [Node, Node]
  expect(bb.props).toMatchObject({ backgroundColor: 'rgba(128,128,128,0.10)', borderColor: 'rgba(224,108,108,0.45)' })
  expect(ns.props).toMatchObject({ backgroundColor: 'rgba(128,128,128,0.10)', borderColor: 'rgba(128,128,128,0.28)' })
  expect(textIn(bb, 'bbirinci · 350e44d7')).toBe(true)
  expect(textIn(bb, 'son yazım 14:20')).toBe(true) // from updatedAt, not the 14:25 mtime
  expect(textIn(ns, 'NorthScore · 1a2b3c4d')).toBe(true)
  expect(textIn(ns, 'son yazım 13:05')).toBe(true) // no updatedAt: from the mtime
  expect(textNode(bb, /^Takıldı · C1 ai-deploy kapı çekirdeği$/)?.props).toMatchObject({ color: '#F2A3A3' })
  expect(textIn(bb, "Developer başlatılamadı: ajan başlatma hook'u reddetti. Ne yapayım?")).toBe(true)
  expect(textNode(bb, /^Başlatmayı ben onaylarım · Plugin'i kapat$/)?.props).toMatchObject({ dimColor: true })
  expect(textNode(bb, /^Ürün kararı · Faz M modül kataloğu$/)?.props).toMatchObject({ color: 'claude' })
  expect(textIn(bb, "Faz A'yı bekle")).toBe(false) // an option alone is no text node: they are joined
  expect(textIn(ns, 'Haftalık · Aylık')).toBe(true)
  expect(textIn(open, 'Cevabı o oturumda ver; seçenekler buradan gönderilemez. 24 saattir güncellenmeyen dosyalar sayılmaz.')).toBe(true)
  // Options are text, never buttons: the only buttons are the pane's own and the toggle.
  expect(buttons(open).map(b => b.props?.key)).toEqual(['pause', 'others-toggle', 'pane-team-on', 'detail-t1'])

  // Remembered for the session: a new mount of the pane keeps it open; the toggle closes it again.
  await ui.unmount()
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(otherBoxes(await drawnOf(again)).length).toBe(2)
  await again.press({ key: 'others-toggle' })
  expect(otherBoxes(await drawnOf(again)).length).toBe(0)
  expect(textIn(await drawnOf(again), 'Diğer oturumlarda 4 karar bekliyor')).toBe(true)
  await again.unmount()
})

test('desktop: nothing in this section sends, fills or submits anything (criterion 4)', async ($, on) => {
  const log: OtherLog = { say: [], fill: [], appended: [] }
  await bootOthers($, on, 'desktop', DESIGN_LISTING, DESIGN_FILES, log)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'others-toggle' })
  await ui.press({ key: 'others-toggle' })
  await ui.unmount()
  expect(log.say).toEqual([])
  expect(log.fill).toEqual([])
  expect(log.appended).toEqual([])
})

test('desktop: a decision whose linked task is blocked, and any spelling of takıldı the parser accepts, draws in error; a card with one gets the error border (criterion 2)', async ($, on) => {
  const viaTask = JSON.stringify({
    v: 1,
    decisions: [{ id: 'd1', kind: 'Onay', task: 't1', text: 'Devam mı?', options: ['Evet'] }],
    tasks: [{ id: 't1', title: 'Takılı iş', stage: 'build', roles: [{ name: 'Developer', state: 'hook reddetti', status: 'blocked' }] }],
  })
  const spelled = JSON.stringify({
    v: 1,
    decisions: [
      { id: 'd1', kind: '  TAKILDI: hook', text: 'Büyük harf', options: [] },
      { id: 'd2', kind: 'takıldı', text: 'Küçük harf', options: [] },
      { id: 'd3', kind: 'Soru', text: 'Normal', options: [] },
      { id: 'd4', kind: 'Takildi (ASCII)', text: 'Noktasız yazım', options: [] },
    ],
  })
  await bootOthers($, on, 'desktop', [entry('a--aaaaaaaa.json'), entry('b--bbbbbbbb.json', { mtimeMs: NOW - 120_000 }), entry('c--cccccccc.json', { mtimeMs: NOW - 180_000 })], {
    'a--aaaaaaaa.json': viaTask,
    'b--bbbbbbbb.json': spelled,
    'c--cccccccc.json': decisionsOnly(1),
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'others-toggle' })
  const root = await drawnOf(ui)
  const [a, b, c] = otherBoxes(root) as [Node, Node, Node]
  expect(a.props?.borderColor).toBe('rgba(224,108,108,0.45)')
  expect(textNode(a, /^Onay · Takılı iş$/)?.props?.color).toBe('#F2A3A3')
  expect(b.props?.borderColor).toBe('rgba(224,108,108,0.45)')
  expect(textNode(b, /TAKILDI: hook/)?.props?.color).toBe('#F2A3A3')
  expect(textNode(b, /^takıldı$/)?.props?.color).toBe('#F2A3A3')
  expect(textNode(b, /^Soru$/)?.props?.color).toBe('claude')
  expect(textNode(b, /^Takildi \(ASCII\)$/)?.props?.color).toBe('#F2A3A3')
  expect(c.props?.borderColor).toBe('rgba(128,128,128,0.28)')
  // The strip's counts: a has 1 stuck decision of 1, b has 3 of 4, c none.
  await ui.press({ key: 'others-toggle' })
  expect(textIn(await drawnOf(ui), 'a · 1 karar (1 takıldı) · b · 4 karar (3 takıldı) · c · 1 karar')).toBe(true)
  await ui.unmount()
})

test('desktop: nothing is drawn when no other session has a decision, and a failing listing is no error (criteria 1, 3)', async ($, on) => {
  await bootOthers($, on, 'desktop', [entry('quiet--11111111.json')], { 'quiet--11111111.json': JSON.stringify({ v: 1, decisions: [], tasks: [] }) })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const root = await drawnOf(ui)
  expect(nodesOf(root).some(n => n.props?.key === 'others-toggle')).toBe(false)
  expect(textNode(root, /Diğer oturum/)).toBeUndefined()
  expect(nodesOf(root).some(n => n.type === 'Svg' && String(n.props?.alt).startsWith('diğer'))).toBe(false)
  expect(textNode(root, /okunamadı/)).toBeUndefined()
  await ui.unmount()
})

test('empty pane shows the strip; a task detail does not (criterion 6)', async ($, on) => {
  const log: OtherLog = { own: null }
  await bootOthers($, on, 'desktop', DESIGN_LISTING, DESIGN_FILES, log)
  const empty = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const root = await drawnOf(empty)
  expect(textIn(root, 'Agent Team kapalı')).toBe(true) // the empty pane
  expect(textIn(root, 'Diğer oturumlarda 4 karar bekliyor')).toBe(true)
  await empty.unmount()
})

test('a task detail has no strip, on either surface (criterion 6)', async ($, on) => {
  await bootOthers($, on, 'desktop', DESIGN_LISTING, DESIGN_FILES)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(nodesOf(await drawnOf(ui)).some(n => n.props?.key === 'others-toggle')).toBe(true)
    await ui.press({ key: 'detail-t1' })
    const detail = await drawnOf(ui)
    expect(nodesOf(detail).some(n => n.props?.key === 'others-toggle')).toBe(false)
    expect(textNode(detail, /Diğer oturum/)).toBeUndefined()
    await ui.press({ key: 'detail-back' })
    await ui.unmount()
  }
})

test('terminal: the collapsed line, the expanded boxes, v toggles, no number keys on those decisions (criteria 5, 6)', async ($, on) => {
  await bootOthers($, on, 'terminal', DESIGN_LISTING, DESIGN_FILES)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const root = await drawnOf(ui)

  // Collapsed (design frame 3): warning ◇ line with "v: göster" on the right, the dim per-session count line, hint with "v diğer".
  const head = nodesOf(root).find(n => n.type === 'Box' && textOf(n) === '◇ Diğer oturumlarda 4 karar') as Node
  expect(head?.props).toMatchObject({ flexDirection: 'row', justifyContent: 'space-between' })
  expect(textNode(head, /^◇ $/)?.props).toMatchObject({ color: 'warning' })
  expect(textNode(head, /^Diğer oturumlarda 4 karar$/)?.props).toMatchObject({ color: 'warning', weight: 'bold' })
  const toggle = nodesOf(head).find(n => n.type === 'Button') as Node
  expect(toggle.props).toMatchObject({ key: 'others-toggle', label: 'göster', plain: true, hotkey: 'v' })
  expect(textNode(root, /^ {2}bbirinci 3/)?.props).toMatchObject({ dimColor: true })
  expect(textOf(textNode(root, /^ {2}bbirinci 3/) as Node)).toBe('  bbirinci 3 (1 takıldı) · NorthScore 1')
  expect(textOf(textNode(root, /^a-o ayrıntı/) as Node)).toBe('a-o ayrıntı  1-9 karar seç  v diğer  p pause  esc çık')
  expect(otherBoxes(root)).toEqual([])
  // v is its own key: no other button shares it, none of the task keys a c d e f g h i j k m n o, none reserved b l p s t.
  const keys = hotkeys(root)
  expect(keys['others-toggle']).toBe('v')
  const used = Object.values(keys).filter(Boolean)
  expect(new Set(used).size).toBe(used.length)

  // Expanded (design frame 4).
  await ui.press({ key: 'others-toggle' })
  const open = await drawnOf(ui)
  const title = nodesOf(open).find(n => n.type === 'Box' && textOf(n) === '◇ DİĞER OTURUMLAR · 4 karar') as Node
  expect(title?.props).toMatchObject({ flexDirection: 'row', justifyContent: 'space-between' })
  expect(textNode(title, /^◇ DİĞER OTURUMLAR$/)?.props).toMatchObject({ color: 'warning', weight: 'bold' })
  expect(textNode(title, /^ · 4 karar$/)?.props).toMatchObject({ dimColor: true })
  expect(nodesOf(title).find(n => n.type === 'Button')?.props).toMatchObject({ label: 'gizle', hotkey: 'v', plain: true })
  expect(otherBoxes(open).map(b => b.props?.key)).toEqual([`other-${BB}`, `other-${NS}`])
  const [bb, ns] = otherBoxes(open) as [Node, Node]
  expect(bb.props).toMatchObject({ borderStyle: 'single', borderColor: 'error' }) // square corners; takıldı inside
  expect(ns.props).toMatchObject({ borderStyle: 'single', borderColor: 'subtle' })
  const first = bb.children?.[0] as Node
  expect(first.props).toMatchObject({ flexDirection: 'row', justifyContent: 'space-between' })
  expect(textOf(first)).toBe('bbirinci · 350e44d714:20')
  expect(textNode(first, /^bbirinci · 350e44d7$/)?.props).toMatchObject({ weight: 'bold' })
  expect(textNode(first, /^14:20$/)?.props).toMatchObject({ dimColor: true })
  expect(textOf(ns.children?.[0] as Node)).toBe('NorthScore · 1a2b3c4d13:05')
  // ✗ takıldı in error, ◆ the others in claude; text; the dim options line; one blank row between decisions (gap 1).
  expect(textNode(bb, /^✗ Takıldı · C1 ai-deploy kapı çekirdeği$/)?.props).toMatchObject({ color: 'error', weight: 'bold' })
  expect(textNode(bb, /^◆ Ürün kararı · Faz M modül kataloğu$/)?.props).toMatchObject({ color: 'claude', weight: 'bold' })
  expect(textNode(bb, /^◆ Onay · Faz A ön-uçuş$/)?.props).toMatchObject({ color: 'claude' })
  expect(textIn(bb, "Katalog kodunu Faz A'yı beklemeden ayrı dalda başlatayım mı?")).toBe(true)
  expect(textNode(bb, /Plugin'i kapat/)?.props).toMatchObject({ dimColor: true })
  expect(textOf(textNode(bb, /Plugin'i kapat/) as Node)).toBe("  Başlatmayı ben onaylarım / Plugin'i kapat")
  expect(textOf(textNode(ns, /Haftalık/) as Node)).toBe('  Haftalık / Aylık')
  expect((bb.children?.[1] as Node).props).toMatchObject({ flexDirection: 'column', gap: 1 })
  expect(textNode(open, /^Cevabı o oturumda ver; buradan gönderilemez\.$/)?.props).toMatchObject({ dimColor: true })
  // No number hotkeys on these decisions: no Button inside a session box, and the own keys stay as they were.
  expect(buttons(bb).length + buttons(ns).length).toBe(0)
  expect(hotkeys(open)).toEqual({ pause: 'p', 'others-toggle': 'v', 'pane-team-on': 'o', 'detail-t1': 'a' })
  expect(RAW_COLOR.test(JSON.stringify(nodesOf(open).map(n => n.props)))).toBe(false)
  expect(nodesOf(open).some(n => n.type === 'Svg')).toBe(false)

  // v toggles back; remembered over a new mount.
  await ui.press({ key: 'others-toggle' })
  expect(otherBoxes(await drawnOf(ui)).length).toBe(0)
  await ui.press({ key: 'others-toggle' })
  await ui.unmount()
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(otherBoxes(await drawnOf(again)).length).toBe(2)
  await again.unmount()
})

test('terminal: a decision linked to a blocked task shows ✗ in error; the strip also shows on the empty pane (criteria 2, 6)', async ($, on) => {
  const viaTask = JSON.stringify({
    v: 1,
    decisions: [{ id: 'd1', kind: 'Onay', task: 't1', text: 'Devam mı?', options: ['Evet', 'Hayır'] }],
    tasks: [{ id: 't1', title: 'Takılı iş', stage: 'build', roles: [{ name: 'Developer', state: 'hook reddetti', status: 'blocked' }] }],
  })
  await bootOthers($, on, 'terminal', [entry('proj.json')], { 'proj.json': viaTask }, { own: null })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const closed = await drawnOf(ui)
  expect(textIn(closed, '  proj 1 (1 takıldı)')).toBe(true)
  expect(textNode(closed, /^a-o ayrıntı/)).toBeUndefined() // the empty pane has no hint line today
  await ui.press({ key: 'others-toggle' })
  const root = await drawnOf(ui)
  const box = otherBoxes(root)[0] as Node
  expect(box.props).toMatchObject({ borderStyle: 'single', borderColor: 'error' })
  expect(textOf(box.children?.[0] as Node).startsWith('proj')).toBe(true)
  expect(textNode(box, /^✗ Onay · Takılı iş$/)?.props).toMatchObject({ color: 'error' })
  await ui.unmount()
})

test('terminal: zero total draws nothing and the hint has no "v diğer"; own keys unchanged (criteria 3, 5)', async ($, on) => {
  await bootOthers($, on, 'terminal', [entry('quiet--11111111.json')], { 'quiet--11111111.json': JSON.stringify({ v: 1, decisions: [], tasks: [] }) })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const root = await drawnOf(ui)
  expect(textNode(root, /Diğer oturum/)).toBeUndefined()
  expect(nodesOf(root).some(n => n.props?.key === 'others-toggle')).toBe(false)
  expect(textOf(textNode(root, /^a-o ayrıntı/) as Node)).toBe('a-o ayrıntı  1-9 karar seç  p pause  esc çık')
  expect(hotkeys(root)).toEqual({ pause: 'p', 'pane-team-on': 'o', 'detail-t1': 'a' })
  await ui.unmount()
})

// Round 2 (QA r1: a huge or hostile file of another session must not stop this session's start; what is stored and drawn is bounded).
// Source: the Lead's round-2 decision: kind 120, text 400, option 60 characters (cut with "…"), 10 decisions kept, counts of ALL decisions,
// "+<m> karar daha" for the rest. The numbers below are the Lead's, written by hand.
const decisionsOf = (n: number, over: Record<string, unknown> = {}) => Array.from({ length: n }, (_, i) => ({ id: `d${i}`, kind: 'Soru', text: `Soru ${i}`, options: ['A', 'B'], ...over }))

test('other sessions, caps (round 2): kind 120, text 400, option 60 with …, first 10 kept, the counts are of all', async () => {
  const e = entry('big--aaaaaaaa.json')
  const long = (c: string, n: number) => c.repeat(n)
  const status = parseStatus(
    JSON.stringify({
      v: 1,
      tasks: [{ id: 't1', title: long('T', 200), stage: 'build' }],
      decisions: [
        { id: 'a', kind: 'Soru', task: 't1', text: long('x', 1000), options: [long('o', 100), 'kısa', 'b', 'c'] },
        ...decisionsOf(10, { kind: 'Takıldı' }).map((d, i) => ({ ...d, id: `s${i}` })),
        { id: 'z', kind: 'Takıldı', text: 'son', options: [] },
      ],
    }),
  )
  const o = otherSession(e, status)
  expect(o?.count).toBe(12)
  expect(o?.stuckCount).toBe(11) // all of them, also the ones past the tenth
  expect(o?.decisions.length).toBe(10)
  const first = o?.decisions[0]
  expect(first?.kind?.length).toBe(120) // "Soru · TTTT…" joined, cut to 120 including the …
  expect(first?.kind?.endsWith('…')).toBe(true)
  expect(first?.text).toBe(`${'x'.repeat(399)}…`)
  expect(first?.options).toEqual([`${'o'.repeat(59)}…`, 'kısa', 'b', 'c'])
  expect(o?.decisions[1]?.text).toBe('Soru 0') // short values are not touched
})

test('other sessions, zero decisions are dropped from what is drawn (criterion 1; QA r1 M6)', async ($, on) => {
  const quiet = JSON.stringify({ v: 1, decisions: [], tasks: [{ id: 't1', title: 'Boş', stage: 'build' }] })
  const empty = JSON.stringify({ v: 1, decisions: [{ id: 'x', text: '' }] }) // the parser drops the only decision
  await bootOthers($, on, 'desktop', [...DESIGN_LISTING, entry('quiet--11111111.json'), entry('empty--22222222.json')], { ...DESIGN_FILES, 'quiet--11111111.json': quiet, 'empty--22222222.json': empty })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(textIn(await drawnOf(ui), 'bbirinci · 3 karar (1 takıldı) · NorthScore · 1 karar')).toBe(true)
  await ui.press({ key: 'others-toggle' })
  expect(otherBoxes(await drawnOf(ui)).map(b => b.props?.key)).toEqual([`other-${BB}`, `other-${NS}`])
  await ui.unmount()
})

// A second start after team mode is on: start must still poll, open the pane and announce the path, whatever the other files hold.
const restartWith = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], listing: Entry[], files: Record<string, string>, extra: Partial<OtherLog> = {}) => {
  const log: OtherLog = { appended: [], opened: [], ticks: [], ...extra }
  const start: Entry[] = []
  await bootOthers($, on, 'desktop', start, files, log)
  const foot = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  await foot.press({ key: 'team-mode' }) // team mode on
  await foot.unmount()
  start.push(...listing)
  const before = [log.appended?.length, log.opened?.length, log.ticks?.length]
  await $.session.start({ cwd: '/Users/x/Projeler/shop', surface: 'desktop', isInteractive: true })
  return { log, ran: [log.appended?.length, log.opened?.length, log.ticks?.length].map((n, i) => (n ?? 0) - (before[i] ?? 0)) }
}

test('other sessions, QA repro (round 2): one small file with a 60 KiB task title and 100 decisions: start completes, total 100, 10 drawn, "+90 karar daha"', async ($, on) => {
  const bigFile = JSON.stringify({
    v: 1,
    tasks: [{ id: 't1', title: 'T'.repeat(60 * 1024), stage: 'build' }],
    decisions: decisionsOf(100, { task: 't1' }),
  })
  const { ran } = await restartWith($, on, [entry('big--aaaaaaaa.json', { size: bigFile.length })], { 'big--aaaaaaaa.json': bigFile })
  expect(ran).toEqual([1, 1, 1]) // announce row, pane opened, the clock registered: the rest of session.start ran
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const root = await drawnOf(ui)
  expect(await ui.find({ key: 'detail-t1' })).toBeDefined() // the own pane draws
  expect(textIn(root, 'Diğer oturumlarda 100 karar bekliyor')).toBe(true)
  await ui.press({ key: 'others-toggle' })
  const open = await drawnOf(ui)
  expect(nodesOf(open).filter(n => String(n.props?.key).startsWith('odec-')).length).toBe(10)
  expect(textIn(open, '+90 karar daha')).toBe(true)
  expect(textIn(open, '100 karar')).toBe(true)
  await ui.unmount()
})

test('other sessions, 17 files of 255 KiB (round 2): start completes and all 17 are counted', async ($, on) => {
  const one = JSON.stringify({ v: 1, decisions: [{ id: 'd', text: 'x'.repeat(255 * 1024 - 60), options: [] }] })
  const listing = Array.from({ length: 17 }, (_, i) => entry(`p${i}--0000000${i % 10}.json`, { size: 255 * 1024, mtimeMs: NOW - 1000 * (i + 1) }))
  const files = Object.fromEntries(listing.map(e => [e.name, one]))
  const { ran } = await restartWith($, on, listing, files)
  expect(ran).toEqual([1, 1, 1])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(textIn(await drawnOf(ui), 'Diğer oturumlarda 17 karar bekliyor')).toBe(true)
  await ui.unmount()
})

test('other sessions, the atom access rejects (round 2): start still completes and the own pane draws; the next poll heals', async ($, on) => {
  const refused: string[] = []
  const refusing = { on: true }
  const { log, ran } = await restartWith($, on, DESIGN_LISTING, DESIGN_FILES, { refused, refusing })
  expect(refused.length).toBeGreaterThan(0) // the rejection really happened during the start
  expect(ran).toEqual([1, 1, 1]) // announce row, pane opened, the clock registered
  expect(log.ticks?.length).toBeGreaterThan(0)
  refusing.on = false // the pane's own read of the atom is not what is tested
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'detail-t1' })).toBeDefined()
  await ui.unmount()
})

test('terminal: more than 10 decisions end the box with a dim "+<m> karar daha", the counts are of all (round 2)', async ($, on) => {
  const f = JSON.stringify({ v: 1, decisions: [...decisionsOf(11), { id: 'z', kind: 'Takıldı', text: 'on ikinci', options: [] }] })
  await bootOthers($, on, 'terminal', [entry('many--bbbbbbbb.json')], { 'many--bbbbbbbb.json': f })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(textIn(await drawnOf(ui), '  many 12 (1 takıldı)')).toBe(true)
  await ui.press({ key: 'others-toggle' })
  const open = await drawnOf(ui)
  const box = otherBoxes(open)[0] as Node
  expect(box.props).toMatchObject({ borderColor: 'error' }) // the stuck one is past the tenth, the border still counts it
  expect(nodesOf(box).filter(n => String(n.props?.key).startsWith('odec-')).length).toBe(10)
  expect(textNode(box, /^\+2 karar daha$/)?.props).toMatchObject({ dimColor: true })
  expect(box.children?.at(-1)).toBe(textNode(box, /^\+2 karar daha$/))
  expect(textNode(open, /^ · 12 karar$/)).toBeDefined() // the title counts all 12
  await ui.unmount()
})

// Decision buttons write into the prompt box (owner decision 2026-11-13; approved design "Karar", frames 1-4; criteria 1-7 of the
// decision-buttons brief). Expected strings are spelled out by hand from the brief and the design's renderVals, never read back
// from the implementation.
test('criterion 1: the decision line is appended on its own line, or replaces the same decision in place; the rest is untouched', async () => {
  // Source: brief criterion 1 (hand-written drafts).
  expect(withKarar('', 'd1', 'Sonra')).toBe('Karar (d1): Sonra')
  expect(withKarar('merhaba', 'd1', 'Sonra')).toBe('merhaba\nKarar (d1): Sonra')
  expect(withKarar('merhaba\n', 'd1', 'Sonra')).toBe('merhaba\nKarar (d1): Sonra')
  expect(withKarar('önce\nKarar (d1): Durumları gör\nsonra  ', 'd1', 'Sonra')).toBe('önce\nKarar (d1): Sonra\nsonra  ')
  // Two decisions: each its own line, the first one stays; changing d1 again keeps the order.
  const two = withKarar(withKarar('', 'd1', 'A'), 'd2', 'B')
  expect(two).toBe('Karar (d1): A\nKarar (d2): B')
  expect(withKarar(two, 'd1', 'C')).toBe('Karar (d1): C\nKarar (d2): B')
  // d1 is not d10, and a line that only mentions the decision is not its line.
  expect(withKarar('Karar (d10): X', 'd1', 'Y')).toBe('Karar (d10): X\nKarar (d1): Y')
  expect(withKarar('bkz Karar (d1): X', 'd1', 'Y')).toBe('bkz Karar (d1): X\nKarar (d1): Y')
})

test('criterion 2: a line break in an id or option becomes a space; regex characters in an id match literally', async () => {
  // Source: brief criterion 2 (the file is model-written).
  expect(kararLine('d1', 'a\nb\r\nc\rd')).toBe('Karar (d1): a b c d')
  expect(kararLine('x\ny', 'o')).toBe('Karar (x y): o')
  expect(withKarar('', 'd1', 'a\nKarar (d2): Evet').split('\n')).toEqual(['Karar (d1): a Karar (d2): Evet'])
  // "a.b" must not take the line of "axb"; "(" "*" "$" "|" "[" in an id are plain characters.
  expect(withKarar('Karar (axb): X', 'a.b', 'Y')).toBe('Karar (axb): X\nKarar (a.b): Y')
  for (const id of ['a.b', 'd(1)', '.*', '^d$', 'a|b', '[x]', '\\d']) {
    expect(withKarar(`Karar (${id}): eski`, id, 'yeni')).toBe(`Karar (${id}): yeni`)
  }
  expect(kararLines('x\nKarar (d1): A\nKarar (d2): B\ny')).toEqual(['Karar (d1): A', 'Karar (d2): B'])
  expect(pickedAt(['Karar (d1): Sonra'], { id: 'd1', text: 't', options: ['Durumları gör', 'Sonra'] })).toBe(1)
  expect(pickedAt(['Karar (d1): Sonra'], { id: 'd2', text: 't', options: ['Sonra'] })).toBe(-1)
})

// A fake prompt box under a mounted session: the box is the single truth, `fill` edits it, and the engine's `prompt.change`
// (origin plugin, after a plugin's fill) is raised by `echo`, as the d.ts says it is; `type` is the owner typing (`prompt.edit`).
const kBoot = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], text = TERM, o: { isFilled?: boolean; boxText?: string; throws?: boolean; atomFails?: boolean } = {}) => {
  const box = { text: o.boxText ?? '', cursor: 0 }
  const log = { sent: [] as string[], fills: [] as { text: string; mode?: string }[], sets: [] as string[], gets: [] as string[] }
  let file = text
  let mtime = 1
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/Users/x' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: mtime, isLink: false } }))
  on('fs.read', () => ({ value: file }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.append', (_, e, next) => next(e))
  on('state.get', (_, e, next) => {
    log.gets.push(e.key)
    return next(e)
  })
  on('state.set', (_, e, next) => {
    log.sets.push(e.key)
    if (o.atomFails && e.key === 'karar') throw new Error('atom refused')
    return next(e)
  })
  on('prompt.read', () => ({ value: { text: box.text, cursor: box.cursor } }))
  on('prompt.submit', (_, e) => {
    log.sent.push(e.text)
    return { text: e.text }
  })
  on('prompt.fill', (_, e) => {
    if (o.throws) throw new Error('no composer')
    log.fills.push({ text: e.text, mode: e.mode })
    if (o.isFilled === false) return { isFilled: false }
    box.text = e.mode === 'append' ? box.text + e.text : e.text
    box.cursor = box.text.length
    return { isFilled: true }
  })
  on('prompt.change', (_, e) => ({ text: e.text }))
  on('prompt.edit', (_, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
  const start = () => $.session.start({ cwd: '/Users/x/Projeler/shop', surface: 'terminal', isInteractive: true })
  await start()
  // The test engine's `$.prompt` has `edit` and `change` at run time, but the d.ts (EventCalls) does not list them.
  const ev = $.prompt as unknown as {
    change: (e: { text: string; cursor: number; origin: { kind: string; name?: string } }) => Promise<unknown>
    edit: (e: { origin: { kind: 'composer' }; text: string; cursor: number; start: number; end: number; inputText: string }) => Promise<{ text: string; cursor: number }>
  }
  const echo = () => ev.change({ text: box.text, cursor: box.cursor, origin: { kind: 'plugin', name: 'agent-team' } })
  // The owner replaces box[start, end) with `inputText`.
  const type = (start: number, end: number, inputText: string) =>
    ev.edit({ origin: { kind: 'composer' }, text: box.text, cursor: end, start, end, inputText }).then(r => {
      box.text = r.text
      box.cursor = r.cursor
    })
  // Enter: the engine empties the box and says so.
  const send = async () => {
    box.text = ''
    box.cursor = 0
    await ev.change({ text: '', cursor: 0, origin: { kind: 'clear' } })
  }
  // Another poll with a new file.
  const rewrite = (next: string) => {
    file = next
    mtime += 1
    return start()
  }
  return { box, log, echo, type, send, rewrite }
}
const pressKey = async (ui: { press: (a: { key: string }) => Promise<unknown> }, echo: () => Promise<unknown>, key: string) => {
  await ui.press({ key })
  await echo()
}

test('criteria 1 and 4: a desktop press writes the line into the box, never submits; two decisions give two lines and one Enter', async ($, on) => {
  const k = await kBoot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pressKey(ui, k.echo, 'd-d1-1')
  expect(k.box.text).toBe('Karar (d1): Sonra')
  await pressKey(ui, k.echo, 'd-d2-0')
  expect(k.box.text).toBe('Karar (d1): Sonra\nKarar (d2): Evet')
  expect(k.log.sent).toEqual([])
  expect(k.log.fills.every(f => f.mode === 'append')).toBe(true) // the owner's text is never re-written when a line is only added
  await ui.unmount()
})

test('criterion 1: a press appends below what the owner typed', async ($, on) => {
  const below = await kBoot($, on, TERM, { boxText: 'önce şunu yap' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pressKey(ui, below.echo, 'd-d1-0')
  expect(below.box.text).toBe('önce şunu yap\nKarar (d1): Durumları gör')
  await ui.unmount()
})

test('criterion 1: a press replaces the same decision line in place and keeps the rest', async ($, on) => {
  const same = await kBoot($, on, TERM, { boxText: 'önce\nKarar (d1): Durumları gör\nsonra' })
  const ui2 = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pressKey(ui2, same.echo, 'd-d1-1')
  expect(same.box.text).toBe('önce\nKarar (d1): Sonra\nsonra')
  expect(same.log.sent).toEqual([])
  await ui2.unmount()
})

test('criterion 2: a decision from the file with a line break and regex characters writes one clean line', async ($, on) => {
  const odd = JSON.stringify({ v: 1, decisions: [{ id: 'a.b(1)', text: 'K', options: ['bir\niki', 'x'] }, { id: 'axb(1)', text: 'L', options: ['y'] }] })
  const k = await kBoot($, on, odd, { boxText: 'Karar (axb(1)): eski' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pressKey(ui, k.echo, 'd-a.b(1)-0')
  expect(k.box.text).toBe('Karar (axb(1)): eski\nKarar (a.b(1)): bir iki')
  await ui.unmount()
})

test('criterion 3 (desktop): a picked decision draws the success border, "✓ <option>", the others non-primary and the note; another press switches the line', async ($, on) => {
  // Source: design "Karar" frame 2 (renderVals: chosen(), picked, faded) and brief criterion 3; theme key success, not the mock's hex.
  const k = await kBoot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const card = () => ui.find({ key: 'd-d1' })
  expect((await card())?.props.borderColor).toBe('rgba(128,128,128,0.28)')
  expect(await ui.find({ type: 'Text', text: /Seçildi/ })).toBeUndefined()
  expect((await ui.find({ key: 'd-d1-0' }))?.props).toMatchObject({ label: 'Durumları gör', variant: 'primary' })

  await pressKey(ui, k.echo, 'd-d1-1')
  expect((await card())?.props.borderColor).toBe('success')
  expect((await ui.find({ key: 'd-d1-1' }))?.props).toMatchObject({ label: '✓ Sonra', variant: 'primary' })
  expect((await ui.find({ key: 'd-d1-0' }))?.props).toMatchObject({ label: 'Durumları gör', variant: 'secondary' })
  const note = await ui.find({ type: 'Text', text: '✓ Seçildi: Sonra · mesaj kutunda, Enter ile gider' })
  expect(note?.props.color).toBe('success')
  // The other decision is untouched.
  expect((await ui.find({ key: 'd-d2' }))?.props.borderColor).toBe('rgba(128,128,128,0.28)')
  expect((await ui.find({ key: 'd-d2-0' }))?.props).toMatchObject({ label: 'Evet', variant: 'primary' })

  // Another option of the picked decision: the line is switched, never two lines for one decision.
  await pressKey(ui, k.echo, 'd-d1-0')
  expect(k.box.text).toBe('Karar (d1): Durumları gör')
  expect((await ui.find({ key: 'd-d1-0' }))?.props.label).toBe('✓ Durumları gör')
  expect((await ui.find({ key: 'd-d1-1' }))?.props).toMatchObject({ label: 'Sonra', variant: 'secondary' })
  expect(await ui.find({ type: 'Text', text: /Seçildi: Sonra/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '✓ Seçildi: Durumları gör · mesaj kutunda, Enter ile gider' })).toBeDefined()
  await ui.unmount()
})

test('criterion 3 (desktop): deleting or editing the line, or sending the message, returns the card to its normal look', async ($, on) => {
  const k = await kBoot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const picked = async () => (await ui.find({ key: 'd-d1' }))?.props.borderColor === 'success'
  await pressKey(ui, k.echo, 'd-d1-1')
  expect(await picked()).toBe(true)

  // The owner types into the line: no longer the exact line, no longer picked (prompt.edit).
  await k.type(k.box.text.length, k.box.text.length, 'x')
  expect(k.box.text).toBe('Karar (d1): Sonrax')
  expect(await picked()).toBe(false)
  expect((await ui.find({ key: 'd-d1-1' }))?.props).toMatchObject({ label: 'Sonra', variant: 'secondary' })
  // Typing it back brings the pick back.
  await k.type(k.box.text.length - 1, k.box.text.length, '')
  expect(await picked()).toBe(true)
  // Deleting the whole line (prompt.edit).
  await k.type(0, k.box.text.length, '')
  expect(k.box.text).toBe('')
  expect(await picked()).toBe(false)

  // Sending the message (prompt.change, origin clear).
  await pressKey(ui, k.echo, 'd-d1-0')
  expect(await picked()).toBe(true)
  await k.send()
  expect(await picked()).toBe(false)
  expect(await ui.find({ type: 'Text', text: /Seçildi/ })).toBeUndefined()
  await ui.unmount()
})

test('criterion 5 (desktop): the box cannot be filled, the press goes out as today and the card says so until the decision leaves the file', async ($, on) => {
  // Source: brief criterion 5; the note text is the brief's.
  const SENT = 'Gönderildi · Lead işini bitirince okuyacak'
  const k = await kBoot($, on, TERM, { isFilled: false })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: SENT })).toBeUndefined()
  await pressKey(ui, k.echo, 'd-d1-1')
  expect(k.log.sent).toEqual(['Karar (d1): Sonra'])
  expect(k.box.text).toBe('')
  expect(await ui.findAll({ type: 'Text', text: SENT })).toHaveLength(1)
  expect((await ui.find({ key: 'd-d1' }))?.props.borderColor).toBe('rgba(128,128,128,0.28)') // not "picked": it is sent, not in the box
  // The Lead removes the decision: the note goes, and does not come back with the same id.
  await k.rewrite(JSON.stringify({ v: 1, decisions: [{ id: 'd2', text: 'Birleşsin mi?', options: ['Evet'] }] }))
  expect(await ui.find({ type: 'Text', text: SENT })).toBeUndefined()
  await k.rewrite(TERM)
  expect(await ui.find({ type: 'Text', text: SENT })).toBeUndefined()
  await ui.unmount()
})

test('criterion 5: a fill that rejects falls back to the same submit', async ($, on) => {
  const k = await kBoot($, on, TERM, { throws: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'd-d2-0' })
  expect(k.log.sent).toEqual(['Karar (d2): Evet'])
  expect(await ui.find({ type: 'Text', text: 'Gönderildi · Lead işini bitirince okuyacak' })).toBeDefined()
  await ui.unmount()
})

test('criteria 1, 3 and 4 (terminal): hotkeys 1-9 write the lines; the picked option is success bold, the box has the note, the hint always says "karar seç"', async ($, on) => {
  // Source: design "Karar" frame 4 (term lines) and brief criterion 3; no raw color.
  const k = await kBoot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const start = await drawnOf(ui)
  expect(hotkeys(start)).toMatchObject({ 'd-d1-0': '1', 'd-d1-1': '2', 'd-d2-0': '3' })
  expect(textNode(start, /^✓ seçildi/)).toBeUndefined()
  expect(textOf(textNode(start, /^a-o ayrıntı/) as Node)).toBe('a-o ayrıntı  1-9 karar seç  p pause  esc çık') // design frame 4: always "karar seç"

  await pressKey(ui, k.echo, 'd-d1-1')
  expect(k.box.text).toBe('Karar (d1): Sonra')
  expect(k.log.sent).toEqual([])
  const one = await drawnOf(ui)
  const d1 = nodesOf(one).find(n => n.props?.key === 'd-d1') as Node
  const pickedButton = nodesOf(d1).find(n => n.props?.key === 'd-d1-1') as Node
  expect(pickedButton.props).toMatchObject({ plain: true, hotkey: '2' })
  expect(textNode(pickedButton, /^Sonra$/)?.props).toMatchObject({ color: 'success', weight: 'bold' })
  expect(textNode(nodesOf(d1).find(n => n.props?.key === 'd-d1-0') as Node, /./)?.props?.color).not.toBe('success')
  expect(textNode(d1, /^✓ seçildi: Sonra · Enter ile gider$/)?.props?.color).toBe('success')
  expect(textNode(one, /^✓ seçildi/)).toBe(textNode(d1, /^✓ seçildi/)) // only d1's box has it
  expect(textOf(textNode(one, /^a-o ayrıntı/) as Node)).toBe('a-o ayrıntı  1-9 karar seç  p pause  esc çık')
  expect(JSON.stringify(one)).not.toMatch(RAW_COLOR)

  // A second decision, one more line; the picked one before stays.
  await pressKey(ui, k.echo, 'd-d2-0')
  expect(k.box.text).toBe('Karar (d1): Sonra\nKarar (d2): Evet')
  expect(nodesOf(await drawnOf(ui)).filter(n => n.type === 'Text' && /^✓ seçildi/.test(textOf(n))).map(textOf)).toEqual([
    '✓ seçildi: Sonra · Enter ile gider',
    '✓ seçildi: Evet · Enter ile gider',
  ])

  // The line deleted: normal look and the old hint again.
  await k.type(0, k.box.text.length, '')
  const gone = await drawnOf(ui)
  expect(textNode(gone, /^✓ seçildi/)).toBeUndefined()
  expect(textOf(textNode(gone, /^a-o ayrıntı/) as Node)).toBe('a-o ayrıntı  1-9 karar seç  p pause  esc çık')
  await ui.unmount()
})

test('criterion 5 (terminal): the box cannot be filled, the press goes out and the box says so', async ($, on) => {
  const k = await kBoot($, on, TERM, { isFilled: false })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'd-d2-0' })
  expect(k.log.sent).toEqual(['Karar (d2): Evet'])
  const root = await drawnOf(ui)
  const d2 = nodesOf(root).find(n => n.props?.key === 'd-d2') as Node
  expect(textNode(d2, /^Gönderildi · Lead işini bitirince okuyacak$/)).toBeDefined()
  expect(textNode(nodesOf(root).find(n => n.props?.key === 'd-d1') as Node, /Gönderildi/)).toBeUndefined()
  await ui.unmount()
})

test('criterion 6: Pause, Devam and "Lead\'e sor" keep today\'s behaviour', async ($, on) => {
  const k = await kBoot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'pause' })
  expect(k.log.sent).toEqual(['Pause'])
  expect(k.log.fills).toEqual([])
  await ui.unmount()
})

test('prompt.edit: typing that leaves the "Karar (" lines as they were writes no atom; a changed line writes once', async ($, on) => {
  // Source: Lead's round r1b (least work per keystroke, never throws); the atom writes are counted on state.set, key "karar".
  const k = await kBoot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pressKey(ui, k.echo, 'd-d1-1')
  const writes = () => k.log.sets.filter(key => key === 'karar').length
  const before = writes()
  const reads = k.log.gets.filter(key => key === 'karar').length
  expect(before).toBeGreaterThan(0)
  await k.type(k.box.text.length, k.box.text.length, '\nmerhaba') // a new line under the decision line
  await k.type(k.box.text.length, k.box.text.length, ' dünya')
  expect(k.box.text).toBe('Karar (d1): Sonra\nmerhaba dünya')
  expect(writes()).toBe(before)
  expect(k.log.gets.filter(key => key === 'karar').length).toBe(reads) // not even a read of the atom
  // Touching the decision line does write, once.
  await k.type(0, 0, 'x')
  expect(writes()).toBe(before + 1)
  await ui.unmount()
})

test('prompt.edit: when the atom write fails, typing still goes through (never throws)', async ($, on) => {
  const bad = await kBoot($, on, TERM, { boxText: 'Karar (d1): Sonra', atomFails: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await bad.type(bad.box.text.length, bad.box.text.length, 'x') // the decision line changes, so a write is tried and refused
  expect(bad.box.text).toBe('Karar (d1): Sonrax')
  expect(bad.log.sets).toContain('karar')
  await ui.unmount()
})
