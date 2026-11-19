import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { decisionTask, detailScroll, isInside, isPush, isStuck, kararLine, kararLines, otherFiles, otherSession, parseFolders, parseStatus, pickedAt, stamp, summary, withKarar } from '../hooks/status'
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
  const sent: string[] = []
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.append', (_, e, next) => next(e))
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  // pane-motion criterion 10: before the first read the pane draws placeholders, so this test now lets the session read (no file yet) first.
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('env.get', () => ({ value: '/Users/x' }))
  on('fs.exists', () => ({ value: false }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/Users/x/Projeler/shop', surface: 'desktop', isInteractive: true })

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
  // hardening criterion 2: on the desktop an example is a press (the draft a fill writes is one the owner never sees), trailing space trimmed.
  expect(filled).toEqual([])
  expect(sent).toEqual(['Bir hatayı düzelt:'])
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
  const sent: string[] = []
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
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
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
  // hardening criterion 1: the terminal fills the box; the desktop (where a fill is an unseen draft) presses a one-line question.
  expect(filled).toEqual(['Seçim kutusu taşması hakkında: '])
  // Review revision 1: the ask replaces what is in the prompt box, as the empty-pane examples do.
  expect(modes).toEqual(['replace'])
  expect(sent).toEqual(['Seçim kutusu taşması ne durumda?'])
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
const POLL = 500 // pane-motion: was 3000 (criterion 6, the poll is 500 ms); the tests mean "one poll"
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
  await c.clock.advance(600)
  // hardening F24: the poll is 500 ms, so it fires no later than the session.end timer (500 ms): this test pins the outcome, not which of the two
  // carried it. The timer alone is tested at the end of the file (F24 / R6).
  expect(c.recordOf(ID_NEW)).toEqual(rec(OLD, SWITCH, { announced: OLD }, CLEAR_NOW + 500))
  expect(c.modeNow()).toEqual(SWITCH)
})

test('hardening F24: a quit after the first poll tick after /clear leaves the record under the new id (mutant: poll without follow)', async ($, on) => {
  const c = await continuity($, on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  c.present.add(OLD)
  await c.start()
  await c.team()
  c.wipe(ID_NEW) // /clear with no session.end seen by the plugin (the id changes, the atoms reset)
  await c.clock.advance(POLL) // the first tick
  await $.session.end({ reason: 'prompt_input_exit', sessionId: ID_NEW, resume: { id: ID_NEW } })
  expect(c.recordOf(ID_NEW)).toEqual(rec(OLD, SWITCH, { announced: OLD }, CLEAR_NOW + POLL))
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
  expect(textNode(d3, /^(?!1-9 ile seç).*·/)).toBeUndefined() // no kind line (the caption row of hardening E18 has a · of its own)
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
  // hardening criterion 5: a made-up id has a character a written one cannot have (here `#1`), so it never equals a written `t1`.
  expect(s.tasks[0]?.id).toBe('#1')
  expect(s.tasks[0]?.generatedId).toBe(true)
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

// The design's own two sessions: ops (3 decisions, the first takıldı) and Webshop (1), the second with no updatedAt (time from mtime).
const OPS = JSON.stringify({
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
const BB = 'ops--5e6f7a8b.json'
const NS = 'Webshop--1a2b3c4d.json'
const DESIGN_LISTING = [entry(BB, { mtimeMs: at(14, 25) }), entry(NS, { mtimeMs: at(13, 5) })]
const DESIGN_FILES = { [BB]: OPS, [NS]: NORTH }

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
  expect(textIn(root, 'ops · 3 karar (1 takıldı) · Webshop · 1 karar')).toBe(true)
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
  expect(textIn(bb, 'ops · 5e6f7a8b')).toBe(true)
  expect(textIn(bb, 'son yazım 14:20')).toBe(true) // from updatedAt, not the 14:25 mtime
  expect(textIn(ns, 'Webshop · 1a2b3c4d')).toBe(true)
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
  expect(textNode(root, /^ {2}ops 3/)?.props).toMatchObject({ dimColor: true })
  expect(textOf(textNode(root, /^ {2}ops 3/) as Node)).toBe('  ops 3 (1 takıldı) · Webshop 1')
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
  expect(textOf(first)).toBe('ops · 5e6f7a8b14:20')
  expect(textNode(first, /^ops · 5e6f7a8b$/)?.props).toMatchObject({ weight: 'bold' })
  expect(textNode(first, /^14:20$/)?.props).toMatchObject({ dimColor: true })
  expect(textOf(ns.children?.[0] as Node)).toBe('Webshop · 1a2b3c4d13:05')
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
  expect(textIn(await drawnOf(ui), 'ops · 3 karar (1 takıldı) · Webshop · 1 karar')).toBe(true)
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
const kBoot = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], text = TERM, o: { isFilled?: boolean; boxText?: string; throws?: boolean; atomFails?: boolean; readFails?: boolean; surface?: 'terminal' | 'desktop'; edit?: (e: { text: string; start: number; end: number; inputText: string }) => unknown } = {}) => {
  const box = { text: o.boxText ?? '', cursor: 0 }
  const log = { reads: 0, sent: [] as string[], fills: [] as { text: string; mode?: string }[], sets: [] as string[], gets: [] as string[] }
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
  on('prompt.read', () => {
    log.reads++
    if (o.readFails) throw new Error('no composer')
    return { value: { text: box.text, cursor: box.cursor } }
  })
  // `submit` is flipped by a test: a rejected submit, or one a hook refused (`{ drop }`), enters nothing and is not in log.sent.
  const gate = { submit: 'ok' as 'ok' | 'throws' | 'drop' }
  on('prompt.submit', (_, e) => {
    if (gate.submit === 'throws') throw new Error('no session')
    if (gate.submit === 'drop') return { drop: 'refused' }
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
  on('prompt.edit', (_, e) => (o.edit ? o.edit(e) : { text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }) as never)
  const start = () => $.session.start({ cwd: '/Users/x/Projeler/shop', surface: o.surface ?? 'terminal', isInteractive: true })
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
  return { box, log, gate, echo, type, send, rewrite, rawEdit: ev.edit }
}
const pressKey = async (ui: { press: (a: { key: string }) => Promise<unknown> }, echo: () => Promise<unknown>, key: string) => {
  await ui.press({ key })
  await echo()
}

test('criteria 1 and 4 (terminal): a press writes the line into the box, never submits; two decisions give two lines and one Enter', async ($, on) => {
  const k = await kBoot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pressKey(ui, k.echo, 'd-d1-1')
  expect(k.box.text).toBe('Karar (d1): Sonra')
  await pressKey(ui, k.echo, 'd-d2-0')
  expect(k.box.text).toBe('Karar (d1): Sonra\nKarar (d2): Evet')
  expect(k.log.sent).toEqual([])
  expect(k.log.fills.every(f => f.mode === 'append')).toBe(true) // the owner's text is never re-written when a line is only added
  await ui.unmount()
})

test('criterion 1 (terminal): a press appends below what the owner typed', async ($, on) => {
  const below = await kBoot($, on, TERM, { boxText: 'önce şunu yap' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pressKey(ui, below.echo, 'd-d1-0')
  expect(below.box.text).toBe('önce şunu yap\nKarar (d1): Durumları gör')
  await ui.unmount()
})

test('criterion 1 (terminal): a press replaces the same decision line in place and keeps the rest', async ($, on) => {
  const same = await kBoot($, on, TERM, { boxText: 'önce\nKarar (d1): Durumları gör\nsonra' })
  const ui2 = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pressKey(ui2, same.echo, 'd-d1-1')
  expect(same.box.text).toBe('önce\nKarar (d1): Sonra\nsonra')
  expect(same.log.sent).toEqual([])
  await ui2.unmount()
})

test('criterion 2 (terminal): a decision from the file with a line break and regex characters writes one clean line', async ($, on) => {
  // (hardening criterion 5: an id may hold only letters, digits . _ -, so the regex characters now live in the unit test above.)
  const odd = JSON.stringify({ v: 1, decisions: [{ id: 'a.b', text: 'K', options: ['bir\niki', 'x'] }, { id: 'axb', text: 'L', options: ['y'] }] })
  const k = await kBoot($, on, odd, { boxText: 'Karar (axb): eski' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pressKey(ui, k.echo, 'd-a.b-0')
  expect(k.box.text).toBe('Karar (axb): eski\nKarar (a.b): bir iki')
  await ui.unmount()
})

test('criterion 3 (terminal): deleting or editing the line, or sending the message, returns the card to its normal look', async ($, on) => {
  const k = await kBoot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const picked = async () => !!textNode(await drawnOf(ui), /^✓ seçildi/)
  await pressKey(ui, k.echo, 'd-d1-1')
  expect(await picked()).toBe(true)

  // The owner types into the line: no longer the exact line, no longer picked (prompt.edit).
  await k.type(k.box.text.length, k.box.text.length, 'x')
  expect(k.box.text).toBe('Karar (d1): Sonrax')
  expect(await picked()).toBe(false)
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
  await ui.unmount()
})

test('criterion 5 (terminal): a fill that rejects falls back to the same submit', async ($, on) => {
  const k = await kBoot($, on, TERM, { throws: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'd-d2-0' })
  expect(k.log.sent).toEqual(['Karar (d2): Evet'])
  expect(textNode(await drawnOf(ui), /^Gönderildi: Evet$/)).toBeDefined()
  await ui.unmount()
})

// Desktop and any other graphical surface: the composer is the app's own, a fill would only write an engine draft the owner never
// sees (live check 2026-11-13, tasks/decision-buttons/live-desktop.md). Source for 1 to 4: the Lead's criteria for desktop-karar.
test('criterion 1 (desktop): a press submits the one clean Karar line as the owner and never reads or fills the box', async ($, on) => {
  const k = await kBoot($, on, TERM, { boxText: 'yarım yazı', surface: 'desktop' }) // a desktop session: only the terminal reads the box at the start (B7)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'd-d1-1' })
  expect(k.log.sent).toEqual(['Karar (d1): Sonra'])
  expect(k.log.reads).toBe(0)
  expect(k.log.fills).toEqual([])
  expect(k.box.text).toBe('yarım yazı')
  await ui.unmount()
  k.log.sent.length = 0
  // Options with line breaks stay one line; an id with one is not a written id (hardening criterion 5), so the line carries the made-up `#1`.
  const odd = JSON.stringify({ v: 1, decisions: [{ id: 'x\ny', text: 'K', options: ['bir\r\niki'] }] })
  await k.rewrite(odd)
  const ui2 = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui2.press({ key: 'd-#1-0' })
  expect(k.log.sent).toEqual(['Karar (#1): bir iki'])
  await ui2.unmount()
})

test('criterion 2 (desktop): after a press the card shows "✓ <option>", the others secondary, the success border and the sent note', async ($, on) => {
  const k = await kBoot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ key: 'd-d1' }))?.props.borderColor).toBe('rgba(128,128,128,0.28)')
  expect(await ui.find({ type: 'Text', text: /Gönderildi/ })).toBeUndefined()
  await ui.press({ key: 'd-d1-1' })
  expect(k.log.sent).toEqual(['Karar (d1): Sonra'])
  expect((await ui.find({ key: 'd-d1' }))?.props.borderColor).toBe('success')
  expect((await ui.find({ key: 'd-d1-1' }))?.props).toMatchObject({ label: '✓ Sonra', variant: 'primary' })
  expect((await ui.find({ key: 'd-d1-0' }))?.props).toMatchObject({ label: 'Durumları gör', variant: 'secondary' })
  const note = await ui.find({ type: 'Text', text: 'Gönderildi: Sonra' })
  expect(note?.props).toMatchObject({ color: 'success', size: 'caption' })
  // The other decision is untouched.
  expect((await ui.find({ key: 'd-d2' }))?.props.borderColor).toBe('rgba(128,128,128,0.28)')
  expect((await ui.find({ key: 'd-d2-0' }))?.props).toMatchObject({ label: 'Evet', variant: 'primary' })
  // It stays until the decision leaves the file, and does not come back with the same id.
  await k.rewrite(JSON.stringify({ v: 1, decisions: [{ id: 'd2', text: 'Birleşsin mi?', options: ['Evet'] }] }))
  expect(await ui.find({ type: 'Text', text: /Gönderildi/ })).toBeUndefined()
  await k.rewrite(TERM)
  expect((await ui.find({ key: 'd-d1' }))?.props.borderColor).toBe('rgba(128,128,128,0.28)')
  expect(await ui.find({ type: 'Text', text: /Gönderildi/ })).toBeUndefined()
  await ui.unmount()
})

test('criterion 3 (desktop): a further press on a decision that already went sends nothing, same or another option', async ($, on) => {
  const k = await kBoot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'd-d1-1' })
  await ui.press({ key: 'd-d1-1' })
  await ui.press({ key: 'd-d1-0' })
  expect(k.log.sent).toEqual(['Karar (d1): Sonra'])
  expect((await ui.find({ key: 'd-d1-1' }))?.props.label).toBe('✓ Sonra')
  expect((await ui.find({ key: 'd-d1-0' }))?.props.label).toBe('Durumları gör')
  await ui.press({ key: 'd-d2-0' }) // another decision still goes
  expect(k.log.sent).toEqual(['Karar (d1): Sonra', 'Karar (d2): Evet'])
  await ui.unmount()
})

test('criterion 4 (desktop): Karar lines in the engine draft never draw the "Seçildi" look; the terminal draws it from the same draft', async ($, on) => {
  const k = await kBoot($, on, TERM, { boxText: 'Karar (d1): Sonra' })
  // The owner (or a 0.6.0 press) leaves the line in the draft; an edit that restores it makes the pane read it.
  await k.type(0, 0, 'x')
  await k.type(0, 1, '')
  expect(k.log.sets).toContain('karar')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Seçildi/ })).toBeUndefined()
  expect((await ui.find({ key: 'd-d1' }))?.props.borderColor).toBe('rgba(128,128,128,0.28)')
  expect((await ui.find({ key: 'd-d1-1' }))?.props).toMatchObject({ label: 'Sonra', variant: 'secondary' })
  await ui.unmount()
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(textNode(await drawnOf(term), /^✓ seçildi: Sonra/)).toBeDefined() // control: the draft really holds the line
  await term.unmount()
})

// Round 2 (QA r1 finding 1). Source: the Lead's revision package: a decision counts as sent only when the submit went in
// (no rejection, no `drop`); on failure the card stays unmarked and the next press sends.
for (const failure of ['throws', 'drop'] as const) {
  test(`criterion 2 (desktop, submit ${failure}): the card stays unmarked, and the next press sends`, async ($, on) => {
    const k = await kBoot($, on)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    k.gate.submit = failure
    await ui.press({ key: 'd-d1-1' })
    expect(k.log.sent).toEqual([])
    expect((await ui.find({ key: 'd-d1' }))?.props.borderColor).toBe('rgba(128,128,128,0.28)')
    expect((await ui.find({ key: 'd-d1-1' }))?.props).toMatchObject({ label: 'Sonra', variant: 'secondary' })
    expect(await ui.find({ type: 'Text', text: /Gönderildi/ })).toBeUndefined()
    k.gate.submit = 'ok'
    await ui.press({ key: 'd-d1-1' })
    expect(k.log.sent).toEqual(['Karar (d1): Sonra'])
    expect((await ui.find({ key: 'd-d1-1' }))?.props.label).toBe('✓ Sonra')
    await ui.unmount()
  })
}

test('criterion 3 (desktop): three presses at once send exactly one line', async ($, on) => {
  const k = await kBoot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await Promise.all([ui.press({ key: 'd-d1-1' }), ui.press({ key: 'd-d1-1' }), ui.press({ key: 'd-d1-0' })])
  expect(k.log.sent).toHaveLength(1)
  await ui.unmount()
})

test('criterion 5 (terminal): a fallback whose submit fails draws no "Gönderildi"; a repeated fallback press submits again', async ($, on) => {
  const k = await kBoot($, on, TERM, { isFilled: false })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const went = async () => !!textNode(await drawnOf(ui), /^Gönderildi/)
  k.gate.submit = 'throws'
  await ui.press({ key: 'd-d1-1' })
  expect(await went()).toBe(false)
  k.gate.submit = 'drop'
  await ui.press({ key: 'd-d1-1' })
  expect(await went()).toBe(false)
  k.gate.submit = 'ok'
  await ui.press({ key: 'd-d1-1' })
  expect(k.log.sent).toEqual(['Karar (d1): Sonra'])
  expect(await went()).toBe(true)
  // The terminal keeps today's behaviour: a second fallback press (same or another option) submits again.
  await ui.press({ key: 'd-d1-0' })
  expect(k.log.sent).toEqual(['Karar (d1): Sonra', 'Karar (d1): Durumları gör'])
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
  expect(textNode(d2, /^Gönderildi: Evet$/)).toBeDefined()
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
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
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
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await bad.type(bad.box.text.length, bad.box.text.length, 'x') // the decision line changes, so a write is tried and refused
  expect(bad.box.text).toBe('Karar (d1): Sonrax')
  expect(bad.log.sets).toContain('karar')
  await ui.unmount()
})

// pause-fast: a press reaches the Lead at its next tool step (tool.call context) while a turn runs, as a submit when idle or at turn end.
// Expected values: the Analyst's measured runs P1-P3 (analyst-report.md), the owner's decisions of 2026-11-13 (push approval never
// by context), and the Lead's criteria 1-7; all spelled out by hand, never read back from the implementation.
const PSTATUS = JSON.stringify({
  v: 1,
  decisions: [
    { id: 'd1', kind: 'Ürün kararı', text: 'Hangisi sayılsın?', options: ['Durumları gör', 'Sonra'] },
    { id: 'd2', text: 'Birleşsin mi?', options: ['Evet'] },
    { id: 'd3', kind: 'Push onayı', text: 'Push edilsin mi?', options: ['Onayla', 'Reddet'] },
  ],
  tasks: [{ id: 't1', title: 'Görev', stage: 'build' }],
})
const HEAD = "[Agent Team pane] Sahip pane'de bastı:"
const QUEUED = 'Sırada · Lead sıradaki adımda okuyacak'
const QUEUED_PUSH = 'Sırada · Lead işini bitirince okuyacak'
type CtxResult = { context?: readonly string[]; result?: unknown; deny?: string; isError?: boolean }

const pBoot = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], o: { surface?: 'desktop' | 'terminal'; isFilled?: boolean; teamOn?: boolean; status?: string; noFile?: boolean } = {}) => {
  const log = { sent: [] as string[], asUser: [] as (boolean | undefined)[], fills: [] as string[], sets: [] as string[] }
  const gate = { submit: 'ok' as 'ok' | 'throws' | 'drop' | 'hold' }
  const held = { settle: undefined as undefined | ((fail: boolean) => void) }
  const core = { result: { result: 'ok', text: 'ok' } as unknown }
  const box = { text: '', cursor: 0 }
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/Users/x' }))
  on('fs.exists', () => ({ value: !o.noFile }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 1, isLink: false } }))
  on('fs.read', () => ({ value: o.status ?? PSTATUS }))
  const clock = mock.clock(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.append', (_, e, next) => next(e))
  on('state.set', (_, e, next) => {
    log.sets.push(e.key)
    return next(e)
  })
  on('prompt.read', () => ({ value: { text: box.text, cursor: box.cursor } }))
  on('prompt.submit', async (_, e) => {
    if (gate.submit === 'throws') throw new Error('no session')
    if (gate.submit === 'drop') return { drop: 'refused' }
    // 'hold': the submit stays in flight until the test settles it (held.settle(true) rejects it).
    if (gate.submit === 'hold') await new Promise<void>((res, rej) => (held.settle = fail => (fail ? rej(new Error('no session')) : res())))
    log.sent.push(e.text)
    log.asUser.push((e.origin as { asUser?: boolean } | undefined)?.asUser)
    return { text: e.text }
  })
  on('prompt.fill', (_, e) => {
    log.fills.push(e.text)
    if (o.isFilled === false) return { isFilled: false }
    box.text += e.text
    return { isFilled: true }
  })
  on('prompt.change', (_, e) => ({ text: e.text }))
  on('tool.call', () => core.result as never)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/Users/x/Projeler/shop', surface: o.surface ?? 'desktop', isInteractive: true })
  if (o.teamOn !== false) {
    const foot = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
    await foot.press({ key: 'team-mode' })
    await foot.unmount()
  }
  // The turn-end submit is not awaited by the hook: the mock clock's advance resolves "once the event loop settled".
  const settle = () => clock.advance(0)
  const start = (turnId: string, agentId?: string) => $.turn.start({ text: 'x', turnId, ...(agentId ? { agentId } : {}) })
  const end = async (turnId: string, agentId?: string) => {
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, reason: 'answer', turnId, ...(agentId ? { agentId } : {}) })
    await settle()
  }
  const tool = async (agentId?: string) => (await $.tool.call({ tool: 'Bash', command: 'ls', ...(agentId ? { agentId } : {}) } as never)) as CtxResult
  const mount = async (surface: 'desktop' | 'terminal' = o.surface ?? 'desktop') => $.ui.mount({ ...PANE, surface })
  return { log, gate, held, core, box, settle, start, end, tool, mount }
}

test('criterion 1 (analyst 1, P3): no turn running, Pause submits at once as the owner; tool.call results stay untouched', async ($, on) => {
  const k = await pBoot($, on)
  const ui = await k.mount()
  await ui.press({ key: 'pause' })
  expect(k.log.sent).toEqual(['Pause'])
  expect(k.log.asUser).toEqual([true])
  expect(await k.tool()).toEqual({ result: 'ok', text: 'ok' })
  await ui.unmount()
})

test('criterion 2, 3 (analyst 2, P1): a press during a turn waits for the next tool call, arrives once as one named context entry, then nothing', async ($, on) => {
  const k = await pBoot($, on)
  const ui = await k.mount()
  await k.start('t1')
  await ui.press({ key: 'pause' })
  expect(k.log.sent).toEqual([])
  const first = await k.tool()
  expect(first.result).toBe('ok')
  expect(first.context).toEqual([`${HEAD}\nPause`])
  expect(await k.tool()).toEqual({ result: 'ok', text: 'ok' })
  await k.end('t1')
  expect(k.log.sent).toEqual([]) // delivered: the turn end submits nothing
  await ui.unmount()
})

test('criterion 3 (analyst 3): two decisions and Pause pressed in one turn arrive in one entry in press order', async ($, on) => {
  const k = await pBoot($, on)
  const ui = await k.mount()
  await k.start('t1')
  await ui.press({ key: 'd-d2-0' })
  await ui.press({ key: 'pause' })
  await ui.press({ key: 'd-d1-1' })
  expect((await k.tool()).context).toEqual([`${HEAD}\nKarar (d2): Evet\nPause\nKarar (d1): Sonra`])
  await ui.unmount()
})

test('criterion 1 (analyst 4): before delivery the last press per decision wins; after delivery a further press sends nothing', async ($, on) => {
  const k = await pBoot($, on)
  const ui = await k.mount()
  await k.start('t1')
  await ui.press({ key: 'd-d1-0' })
  await ui.press({ key: 'd-d1-1' })
  expect((await k.tool()).context).toEqual([`${HEAD}\nKarar (d1): Sonra`])
  await ui.press({ key: 'd-d1-0' })
  expect((await k.tool()).context).toBeUndefined()
  await k.end('t1')
  expect(k.log.sent).toEqual([])
  await ui.unmount()
})

test('criterion 1 (analyst 5): press, then the turn ends with no tool call: one submit with every pending line joined by a line break, queue empty after', async ($, on) => {
  const k = await pBoot($, on)
  const ui = await k.mount()
  await k.start('t1')
  await ui.press({ key: 'd-d2-0' })
  await ui.press({ key: 'pause' })
  await k.end('t1')
  expect(k.log.sent).toEqual(['Karar (d2): Evet\nPause'])
  expect(k.log.asUser).toEqual([true])
  expect((await k.tool()).context).toBeUndefined()
  await k.end('t1')
  expect(k.log.sent).toHaveLength(1)
  await ui.unmount()
})

test('criterion 1 (analyst 6): a tool call of a role agent is left alone and the press stays pending for the Lead', async ($, on) => {
  const k = await pBoot($, on)
  const ui = await k.mount()
  await k.start('t1')
  await ui.press({ key: 'pause' })
  expect(await k.tool('agent-1')).toEqual({ result: 'ok', text: 'ok' })
  expect((await k.tool()).context).toEqual([`${HEAD}\nPause`])
  await ui.unmount()
})

test('criterion 1 (analyst 7 settled): an isError result carries the press, a deny keeps it pending and the result untouched', async ($, on) => {
  const k = await pBoot($, on)
  const ui = await k.mount()
  await k.start('t1')
  await ui.press({ key: 'pause' })
  k.core.result = { deny: 'no' }
  expect(await k.tool()).toEqual({ deny: 'no' })
  k.core.result = { result: 'boom', text: 'boom', isError: true }
  const failed = await k.tool()
  expect(failed.isError).toBe(true)
  expect(failed.context).toEqual([`${HEAD}\nPause`])
  await ui.unmount()
})

test('criterion 1 (analyst 8): turn ids are a set; the old turn ending first does not submit, the last one does', async ($, on) => {
  const k = await pBoot($, on)
  const ui = await k.mount()
  await k.start('t1')
  await k.start('t2')
  await ui.press({ key: 'pause' })
  await k.end('t1')
  expect(k.log.sent).toEqual([])
  await k.end('t2')
  expect(k.log.sent).toEqual(['Pause'])
  await ui.unmount()
})

test('criterion 1 (analyst 9): turns of an agent do not change the running set', async ($, on) => {
  const k = await pBoot($, on)
  const ui = await k.mount()
  await k.start('a1', 'agent-1') // an agent's turn alone is not a Lead turn: the press goes at once
  await ui.press({ key: 'pause' })
  expect(k.log.sent).toEqual(['Pause'])
  await k.start('t1')
  await ui.press({ key: 'd-d2-0' })
  await k.end('a1', 'agent-1') // an agent ending does not release it
  expect(k.log.sent).toEqual(['Pause'])
  await k.end('t1')
  expect(k.log.sent).toEqual(['Pause', 'Karar (d2): Evet'])
  await ui.unmount()
})

test('criterion 1 (analyst 10): a context already on the result is kept before ours; with nothing pending the result is core\'s as is', async ($, on) => {
  const k = await pBoot($, on)
  const ui = await k.mount()
  await k.start('t1')
  k.core.result = { result: 'ok', text: 'ok', context: ['eski'] }
  expect(await k.tool()).toEqual({ result: 'ok', text: 'ok', context: ['eski'] })
  await ui.press({ key: 'pause' })
  expect((await k.tool()).context).toEqual(['eski', `${HEAD}\nPause`])
  await ui.unmount()
})

test('criterion 6 (analyst 11): team mode off, hooks pass through and a press submits as today, even with a turn running', async ($, on) => {
  const k = await pBoot($, on, { teamOn: false })
  const ui = await k.mount()
  await k.start('t1')
  await ui.press({ key: 'pause' })
  expect(k.log.sent).toEqual(['Pause'])
  expect(await k.tool()).toEqual({ result: 'ok', text: 'ok' })
  await ui.unmount()
})

// Criterion 2 (owner decision 1): the kind of a push approval, trimmed and lowercased with Turkish rules, starts with "push onayı" / "push onayi".
for (const kind of ['Push onayı', '  PUSH ONAYI — main', 'push onayi', 'Push Onayı: team/x']) {
  const status = JSON.stringify({ v: 1, decisions: [{ id: 'p1', kind, text: 'Push?', options: ['Onayla'] }, { id: 'd2', text: 'B?', options: ['Evet'] }] })
  test(`criterion 2: kind "${kind}" is a push approval: idle, it is submitted at once as the owner`, async ($, on) => {
    const k = await pBoot($, on, { status })
    const ui = await k.mount()
    await ui.press({ key: 'd-p1-0' })
    expect(k.log.sent).toEqual(['Karar (p1): Onayla'])
    expect(k.log.asUser).toEqual([true])
    await ui.unmount()
  })
  test(`criterion 2: kind "${kind}": with a turn running it never goes by context, one submit at the turn end carries it with the other pending lines`, async ($, on) => {
    const k = await pBoot($, on, { status })
    const ui = await k.mount()
    await k.start('t1')
    await ui.press({ key: 'd-p1-0' })
    expect(await k.tool()).toEqual({ result: 'ok', text: 'ok' })
    await ui.press({ key: 'd-d2-0' })
    expect((await k.tool()).context).toEqual([`${HEAD}\nKarar (d2): Evet`])
    await ui.press({ key: 'pause' }) // pending when the turn ends: one submit carries both, press order
    await k.end('t1')
    expect(k.log.sent).toEqual(['Karar (p1): Onayla\nPause'])
    expect(k.log.asUser).toEqual([true])
    await ui.unmount()
  })
}

test('criterion 2: a kind that only mentions push (or is empty) goes by context', async ($, on) => {
  const status = JSON.stringify({ v: 1, decisions: [{ id: 'a', kind: 'Ürün kararı: push sonrası', text: 'x', options: ['Evet'] }, { id: 'b', text: 'y', options: ['Evet'] }] })
  const k = await pBoot($, on, { status })
  const ui = await k.mount()
  await k.start('t1')
  await ui.press({ key: 'd-a-0' })
  await ui.press({ key: 'd-b-0' })
  expect((await k.tool()).context).toEqual([`${HEAD}\nKarar (a): Evet\nKarar (b): Evet`])
  await ui.unmount()
})

for (const failure of ['throws', 'drop'] as const) {
  test(`criterion 4 (submit ${failure}): at the turn end the lines stay pending, the card claims nothing, the next tool step or press delivers them`, async ($, on) => {
    const k = await pBoot($, on)
    const ui = await k.mount()
    await k.start('t1')
    await ui.press({ key: 'd-d1-1' })
    await ui.press({ key: 'pause' })
    k.gate.submit = failure
    await k.end('t1')
    expect(k.log.sent).toEqual([])
    expect(await ui.find({ type: 'Text', text: /Gönderildi/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: QUEUED })).toBeDefined()
    k.gate.submit = 'ok'
    await k.start('t2')
    expect((await k.tool()).context).toEqual([`${HEAD}\nKarar (d1): Sonra\nPause`]) // press order kept
    await ui.unmount()
  })

  test(`criterion 4 (submit ${failure}): an idle press that fails keeps its line; the next press submits both in press order`, async ($, on) => {
    const k = await pBoot($, on)
    const ui = await k.mount()
    k.gate.submit = failure
    await ui.press({ key: 'd-d2-0' })
    expect(k.log.sent).toEqual([])
    expect((await ui.find({ key: 'd-d2' }))?.props.borderColor).toBe('rgba(128,128,128,0.28)')
    k.gate.submit = 'ok'
    await ui.press({ key: 'pause' })
    expect(k.log.sent).toEqual(['Karar (d2): Evet\nPause'])
    expect((await ui.find({ key: 'd-d2' }))?.props.borderColor).toBe('success')
    await ui.unmount()
  })
}

test('criterion 5 (desktop): a queued decision says it waits for the next step, a push approval for the turn end, a delivered one has today\'s sent look', async ($, on) => {
  const k = await pBoot($, on)
  const ui = await k.mount()
  await k.start('t1')
  await ui.press({ key: 'd-d1-1' })
  await ui.press({ key: 'd-d3-0' })
  expect((await ui.find({ type: 'Text', text: QUEUED }))?.props).toMatchObject({ size: 'caption' })
  expect((await ui.find({ type: 'Text', text: QUEUED_PUSH }))?.props).toMatchObject({ size: 'caption' })
  expect(await ui.find({ type: 'Text', text: /Gönderildi/ })).toBeUndefined()
  expect((await ui.find({ key: 'd-d1' }))?.props.borderColor).toBe('rgba(128,128,128,0.28)')
  expect((await ui.find({ key: 'd-d1-1' }))?.props.label).toBe('Sonra') // not ticked before it was delivered
  await k.tool() // d1 goes by context, the push approval stays
  expect(await ui.find({ type: 'Text', text: QUEUED })).toBeUndefined()
  expect((await ui.find({ key: 'd-d1' }))?.props.borderColor).toBe('success')
  expect((await ui.find({ key: 'd-d1-1' }))?.props).toMatchObject({ label: '✓ Sonra', variant: 'primary' })
  expect((await ui.find({ type: 'Text', text: 'Gönderildi: Sonra' }))?.props).toMatchObject({ color: 'success', size: 'caption' })
  expect(await ui.find({ type: 'Text', text: QUEUED_PUSH })).toBeDefined()
  await k.end('t1')
  expect(k.log.sent).toEqual(['Karar (d3): Onayla'])
  expect(await ui.find({ type: 'Text', text: QUEUED_PUSH })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: 'Gönderildi: Onayla' }))?.props).toMatchObject({ color: 'success' })
  await ui.unmount()
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`criterion 5 (${surface}): Pause shows a short pending state "Pause · sırada" while queued, then follows the status file`, async ($, on) => {
    const k = await pBoot($, on, { surface })
    const ui = await k.mount(surface)
    await k.start('t1')
    expect((await ui.find({ key: 'pause' }))?.props.label).toBe('Pause')
    await ui.press({ key: 'pause' })
    expect((await ui.find({ key: 'pause' }))?.props.label).toBe('Pause · sırada')
    await k.tool()
    expect((await ui.find({ key: 'pause' }))?.props.label).toBe('Pause')
    await ui.unmount()
  })
}

test('criterion 5: Devam shows "Devam · sırada" while queued', async ($, on) => {
  const k = await pBoot($, on, { status: PSTATUS.replace('"v":1', '"v":1,"paused":true') })
  const ui = await k.mount()
  await k.start('t1')
  await ui.press({ key: 'resume' })
  expect((await ui.find({ key: 'resume' }))?.props.label).toBe('Devam · sırada')
  await ui.unmount()
})

test('criterion 5 (terminal): the decision buttons keep the fill path and queue nothing', async ($, on) => {
  const k = await pBoot($, on, { surface: 'terminal' })
  const ui = await k.mount()
  await k.start('t1')
  await ui.press({ key: 'd-d1-1' })
  expect(k.log.fills).toEqual(['Karar (d1): Sonra'])
  expect(textNode(await drawnOf(ui), /Sırada/)).toBeUndefined()
  expect((await k.tool()).context).toBeUndefined()
  await ui.unmount()
})

test('criterion 5 (terminal): a refused fill goes through the queue; delivered, the box says "Gönderildi: <o>"', async ($, on) => {
  const f = await pBoot($, on, { surface: 'terminal', isFilled: false })
  const ui2 = await f.mount()
  await f.start('t1')
  await ui2.press({ key: 'd-d2-0' })
  expect(f.log.sent).toEqual([])
  expect(textNode(await drawnOf(ui2), new RegExp(`^${QUEUED}$`))).toBeDefined()
  expect((await f.tool()).context).toEqual([`${HEAD}\nKarar (d2): Evet`])
  const done = await drawnOf(ui2)
  expect(textNode(done, /Sırada/)).toBeUndefined()
  expect(textNode(done, /^Gönderildi: Evet$/)).toBeDefined()
  await ui2.unmount()
})

test('criterion 5 (terminal): a push approval whose fill was refused waits for the turn end and says so', async ($, on) => {
  const k = await pBoot($, on, { surface: 'terminal', isFilled: false })
  const ui = await k.mount()
  await k.start('t1')
  await ui.press({ key: 'd-d3-0' })
  expect(textNode(await drawnOf(ui), new RegExp(`^${QUEUED_PUSH}$`))).toBeDefined()
  expect(await k.tool()).toEqual({ result: 'ok', text: 'ok' })
  await k.end('t1')
  expect(k.log.sent).toEqual(['Karar (d3): Onayla'])
  await ui.unmount()
})

// Round 2 (QA r1, Lead's consolidated list). Sources: brief criterion 6 (team mode off: the hooks pass through, a press submits as
// today) with both QAs' reproductions; the Lead's rule that nothing may write the atom on a tool call with nothing to take.
test('criterion 6 (round 2): team mode off, lines left over from a dropped idle submit never go by context; the turn end submits them as the owner', async ($, on) => {
  const k = await pBoot($, on, { teamOn: false })
  const ui = await k.mount()
  k.gate.submit = 'drop'
  await ui.press({ key: 'pause' })
  k.gate.submit = 'ok'
  await k.start('t1')
  expect(await k.tool()).toEqual({ result: 'ok', text: 'ok' })
  await k.end('t1')
  expect(k.log.sent).toEqual(['Pause'])
  expect(k.log.asUser).toEqual([true])
  await ui.unmount()
})

test('criterion 6 (round 2): Pause queued mid-turn, team mode then switched off: the tool call is untouched, the turn end submits it as the owner', async ($, on) => {
  const k = await pBoot($, on)
  const ui = await k.mount()
  await k.start('t1')
  await ui.press({ key: 'pause' })
  const foot = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  await foot.press({ key: 'team-mode' }) // on to off
  await foot.unmount()
  expect(await k.tool()).toEqual({ result: 'ok', text: 'ok' })
  expect(k.log.sent).toEqual([])
  await k.end('t1')
  expect(k.log.sent).toEqual(['Pause'])
  expect(k.log.asUser).toEqual([true])
  await ui.unmount()
})

test('round 2: with nothing to take, a Lead tool call and a turn end write no atom', async ($, on) => {
  const k = await pBoot($, on)
  const ui = await k.mount()
  await k.start('t1')
  k.log.sets.length = 0
  await k.tool()
  await k.tool('agent-1')
  await k.end('t1')
  expect(k.log.sets).toEqual([])
  await ui.unmount()
})

test('round 2: with only a push approval pending, a tool call writes no atom and leaves the result alone', async ($, on) => {
  const k = await pBoot($, on)
  const ui = await k.mount()
  await k.start('t1')
  await ui.press({ key: 'd-d3-0' })
  k.log.sets.length = 0
  expect(await k.tool()).toEqual({ result: 'ok', text: 'ok' })
  expect(k.log.sets).toEqual([])
  await ui.unmount()
})

// pane-motion (owner 2026-11-19, option A): a pane that moves and answers at once. Expected values come from three places, all
// spelled out by hand and never read back from the implementation: the Analyst's report §4 criteria 1-12 (criterion numbers below),
// the Lead's settlements in the brief (idle caption text, "gönderildi" label, 500 ms poll, timings 1600 ms / 0.4 / 24 px), and
// arithmetic of my own (segment = (320 - 4 * 4) / 5 = 60.8, so segment 2 starts at 2 * 64.8 = 129.6).
const MOTION = JSON.stringify({
  v: 1,
  decisions: [
    { id: 'd1', text: 'Hangisi sayılsın?', options: ['A', 'B'] },
    { id: 'd2', text: 'Takılan görev?', kind: 'Takıldı', task: 'tb', options: ['C'] },
  ],
  tasks: [
    {
      id: 'tr',
      title: 'Koşan',
      stage: 'review',
      roles: [
        { name: 'Dev', state: 'teslim etti', status: 'done' },
        { name: 'QA', state: 'inceliyor', status: 'running' },
        { name: 'Helper', state: 'boşta', status: 'idle' },
      ],
    },
    { id: 'tb', title: 'Takılan', stage: 'build', roles: [{ name: 'QA 2', state: 'başlatılamadı', status: 'blocked' }] },
    { id: 'tw', title: 'Bekleyen', stage: 'spec', wait: 'sırada', roles: [{ name: 'Analyst', state: 'sırada', status: 'waiting' }] },
  ],
})
const withPaused = (s: string) => s.replace('"v":1', '"v":1,"paused":true')
const stripStyle = (s: string) => s.replace(/<style>[\s\S]*?<\/style>/g, '')
const stripBand = (s: string) => stripStyle(s).replace(/<clipPath[\s\S]*?<\/clipPath>/g, '').replace(/<g class="band"[\s\S]*?<\/g>/g, '')
const moves = (s: string) => /@keyframes|animation|<animate/.test(s)
const svgOf = (root: Node, alt: RegExp | string) => String(nodesOf(root).find(n => n.type === 'Svg' && (typeof alt === 'string' ? n.props?.alt === alt : alt.test(String(n.props?.alt))))?.props?.source)
// The engine puts a hover beside a node's props in the drawn tree (seen in the probe's drawn tree), not inside them.
const hoverOf = (n: Node) => (n as { hover?: unknown }).hover
const OUT = "Bir seçeneğe bas · Lead'e gider"
const HOVER_EDGE = 'rgba(128,128,128,0.55)'
const HOVER_FILL = 'rgba(128,128,128,0.16)'

const mBoot = async (
  $: Parameters<TestBody>[0],
  on: Parameters<TestBody>[1],
  o: { surface?: 'desktop' | 'terminal'; status?: string; lazy?: boolean; noFile?: boolean; teamOn?: boolean } = {},
) => {
  const disk = { text: o.status ?? MOTION, mtime: 1, exists: !o.noFile }
  const log = { sent: [] as string[], sets: [] as string[], hold: false, fail: false }
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/Users/x' }))
  on('fs.exists', () => ({ value: disk.exists }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: disk.mtime, isLink: false } }))
  on('fs.read', () => ({ value: disk.text }))
  const clock = mock.clock(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.append', (_, e, next) => next(e))
  on('state.set', (_, e, next) => {
    log.sets.push(e.key)
    return next(e)
  })
  on('prompt.submit', async (_, e) => {
    if (log.fail) throw new Error('no session')
    log.sent.push(e.text)
    if (log.hold) await new Promise<never>(() => undefined)
    return { text: e.text }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }) as never)
  const start = () => $.session.start({ cwd: '/Users/x/Projeler/shop', surface: o.surface ?? 'desktop', isInteractive: true })
  if (!o.lazy) await start()
  if (o.teamOn) {
    const foot = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
    await foot.press({ key: 'team-mode' })
    await foot.unmount()
  }
  const mount = (surface: 'desktop' | 'terminal' = o.surface ?? 'desktop') => $.ui.mount({ ...PANE, surface })
  const change = async (text: string) => {
    disk.text = text
    disk.mtime++
    await clock.advance(500)
  }
  return { disk, log, clock, start, mount, change, settle: () => clock.advance(0) }
}

test('criteria 1, 3, 4 (svg.ts): a running dot pulses 1600 ms ease-in-out to 0.4 behind prefers-reduced-motion; the resting markup is today\'s dot', async () => {
  const still = dotSvg(CLAY)
  expect(moves(still)).toBe(false)
  const live = dotSvg(CLAY, true)
  expect(live).toMatch(/^<svg [^>]*width="8" height="8"/)
  expect(live).toContain('<style>@media (prefers-reduced-motion: no-preference){')
  expect(live.match(/@media/g)?.length).toBe(1)
  expect(live).toContain('@keyframes')
  expect(live).toMatch(/opacity:\s*0\.4/)
  expect(live).toMatch(/animation:[^;}]*1600ms ease-in-out infinite/)
  expect(live).not.toContain('<animate')
  expect(stripStyle(live)).toBe(still)
})

test('criteria 2, 3, 4 (svg.ts): the running stage line has a 24 px band clipped to the current segment; without the animation parts it is today\'s line', async () => {
  const still = stagesSvg(2)
  expect(moves(still)).toBe(false)
  const live = stagesSvg(2, 5, false, true)
  expect(live).toMatch(/^<svg [^>]*width="320" height="4"/)
  expect(live).toContain('<style>@media (prefers-reduced-motion: no-preference){')
  expect(live.match(/@media/g)?.length).toBe(1)
  expect(live).toMatch(/animation:[^;}]*1600ms ease-in-out infinite/)
  expect(live).not.toContain('<animate')
  expect(live).toMatch(/<clipPath [^>]*><rect x="129.6" width="60.8" height="4"/) // the current segment, by my arithmetic
  expect(live).toMatch(/<rect class="sweep" [^>]*width="24" height="4"[^>]*opacity="0"/) // 24 px, hidden unless the animation runs
  expect(stripBand(live)).toBe(still)
  expect(stripBand(stagesSvg(1, 5, true, true))).toBe(stagesSvg(1, 5, true)) // blocked colors stay
})

test('criteria 1, 2, 3, 4 (desktop): only a running role\'s dot and a running task\'s stage line move; every Svg has its size and no SMIL', async ($, on) => {
  const k = await mBoot($, on)
  const ui = await k.mount()
  const root = await drawnOf(ui)
  expect(moves(svgOf(root, 'çalışıyor'))).toBe(true)
  for (const alt of ['bitti', 'takıldı', 'sırada', 'boşta', 'karar bekliyor']) expect(moves(svgOf(root, alt))).toBe(false)
  const card = (id: string) => nodesOf(keyed(root, `t-${id}`))
  const stage = (id: string) => String(card(id).find(n => n.type === 'Svg' && /aşamanın/.test(String(n.props?.alt)))?.props?.source)
  expect(moves(stage('tr'))).toBe(true) // running
  expect(moves(stage('tb'))).toBe(false) // blocked
  expect(moves(stage('tw'))).toBe(false) // waiting
  expect(stripBand(stage('tr'))).toBe(stagesSvg(2))
  expect(stripStyle(svgOf(root, 'çalışıyor'))).toBe(dotSvg(CLAY))
  const all = nodesOf(root).filter(n => n.type === 'Svg')
  expect(all.length).toBeGreaterThan(5)
  for (const s of all) {
    expect(String(s.props?.source)).toMatch(/^<svg [^>]*width="\d+" height="\d+"/)
    expect(String(s.props?.source)).not.toContain('<animate')
    expect(s.props?.isInteractive).toBeUndefined() // image mode, as the owner's live look chose
  }
  await ui.unmount()
})

test('criterion 5 (terminal): no Svg and no style; a quiet 10 s writes no atom and starts no loop', async ($, on) => {
  const k = await mBoot($, on, { surface: 'terminal' })
  const ui = await k.mount()
  const root = await drawnOf(ui)
  expect(nodesOf(root).some(n => n.type === 'Svg')).toBe(false)
  expect(JSON.stringify(root)).not.toMatch(/@keyframes|<style|<animate/)
  k.log.sets.length = 0
  await k.clock.advance(10_000)
  expect(k.log.sets).toEqual([])
  await ui.unmount()
})

test('criterion 6: a status change is drawn after 500 ms and not before; a quiet poll writes no atom', async ($, on) => {
  const k = await mBoot($, on)
  const ui = await k.mount()
  expect(await ui.find({ type: 'Text', text: 'Koşan' })).toBeDefined()
  k.disk.text = MOTION.replace('Koşan', 'Yeni ad')
  k.disk.mtime = 2
  await k.clock.advance(499)
  expect(await ui.find({ type: 'Text', text: 'Yeni ad' })).toBeUndefined()
  await k.clock.advance(1)
  expect(await ui.find({ type: 'Text', text: 'Yeni ad' })).toBeDefined()
  k.log.sets.length = 0
  await k.clock.advance(5000)
  expect(k.log.sets).toEqual([])
  await ui.unmount()
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`criterion 7 (${surface}): Pause and Devam pressed with no turn running say "gönderildi" until the status file changes`, async ($, on) => {
    const k = await mBoot($, on, { surface })
    const ui = await k.mount()
    expect((await ui.find({ key: 'pause' }))?.props.label).toBe('Pause')
    await ui.press({ key: 'pause' })
    await k.settle()
    expect(k.log.sent).toEqual(['Pause'])
    expect((await ui.find({ key: 'pause' }))?.props.label).toBe('Pause · gönderildi')
    await k.clock.advance(3000) // time alone changes nothing
    expect((await ui.find({ key: 'pause' }))?.props.label).toBe('Pause · gönderildi')
    await k.change(withPaused(MOTION)) // the Lead paused: the button turns into Devam, the old note is gone
    expect((await ui.find({ key: 'resume' }))?.props.label).toBe('Devam')
    await ui.press({ key: 'resume' })
    await k.settle()
    expect((await ui.find({ key: 'resume' }))?.props.label).toBe('Devam · gönderildi')
    await k.change(MOTION) // the file changed again, not paused: Pause with no note
    expect((await ui.find({ key: 'pause' }))?.props.label).toBe('Pause')
    await ui.press({ key: 'pause' })
    await k.settle()
    await k.change(MOTION.replace('Koşan', 'Başka')) // a change that leaves paused as it was still clears the note
    expect((await ui.find({ key: 'pause' }))?.props.label).toBe('Pause')
    await ui.unmount()
  })
}

test('criterion 7: a failed submit takes "gönderildi" back (the press is not lost, nothing claims it went)', async ($, on) => {
  const k = await mBoot($, on)
  k.log.fail = true
  const ui = await k.mount()
  await ui.press({ key: 'pause' })
  await k.settle()
  expect((await ui.find({ key: 'pause' }))?.props.label).toBe('Pause · sırada')
  await ui.unmount()
})

test('criterion 8 (desktop): with the submit held unresolved, a decision, Pause and the detail are already drawn', async ($, on) => {
  const k = await mBoot($, on)
  k.log.hold = true
  const ui = await k.mount()
  await ui.press({ key: 'd-d1-1' })
  await k.settle()
  expect(k.log.sent).toEqual(['Karar (d1): B']) // the submit is in flight
  expect((await ui.find({ key: 'd-d1-1' }))?.props).toMatchObject({ label: '✓ B', variant: 'primary' })
  expect((await ui.find({ type: 'Text', text: 'Gönderildi: B' }))?.props).toMatchObject({ color: 'success' })
  await ui.press({ key: 'detail-tr' })
  expect(await ui.find({ key: 'detail-back' })).toBeDefined() // drawn without waiting for anything
  await ui.press({ key: 'detail-back' })
  await ui.unmount()
})

test('criterion 8 (desktop): with the submit held unresolved, Pause already says "gönderildi"', async ($, on) => {
  const p = await mBoot($, on)
  p.log.hold = true
  const ui2 = await p.mount()
  await ui2.press({ key: 'pause' })
  await p.settle()
  expect((await ui2.find({ key: 'pause' }))?.props.label).toBe('Pause · gönderildi')
  await ui2.unmount()
})

test('criterion 9 (desktop): a decision card has the same rows idle, queued and sent; idle says where the press goes', async ($, on) => {
  const k = await mBoot($, on, { teamOn: true })
  const ui = await k.mount()
  const rows = async () => keyed(await drawnOf(ui), 'd-d1').children?.length
  expect(await rows()).toBe(3) // text block, options, caption
  const idle = await ui.find({ type: 'Text', text: OUT })
  expect(idle?.props).toMatchObject({ size: 'caption', dimColor: true })
  await $.turn.start({ text: 'x', turnId: 't1' })
  await ui.press({ key: 'd-d1-1' })
  expect(await ui.find({ type: 'Text', text: QUEUED })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: OUT })).toBeDefined() // d2 still idle
  expect(await rows()).toBe(3)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect(await ui.find({ type: 'Text', text: 'Gönderildi: B' })).toBeDefined()
  expect(await rows()).toBe(3)
  await ui.unmount()
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`criterion 10 (${surface}): before the first read the pane draws placeholders and no onboarding; after a read with no file the onboarding shows`, async ($, on) => {
    const k = await mBoot($, on, { lazy: true, noFile: true, surface })
    const ui = await k.mount()
    const loading = await drawnOf(ui)
    expect(keyed(loading, 'ph-0')).toBeDefined()
    expect(keyed(loading, 'ph-1')).toBeDefined()
    expect(keyed(loading, 'ph-2')).toBeUndefined()
    for (const t of ['Takım hazır', 'Agent Team kapalı', 'Nasıl işler']) expect(textIn(loading, t)).toBe(false)
    expect(nodesOf(loading).some(n => n.props?.key === 'pane-team-on')).toBe(false)
    await k.start()
    const read = await drawnOf(ui)
    expect(keyed(read, 'ph-0')).toBeUndefined()
    expect(textIn(read, 'Agent Team kapalı')).toBe(true)
    await ui.unmount()
  })
}

test('criterion 11: task and decision cards carry the hover override on desktop', async ($, on) => {
  const k = await mBoot($, on)
  const ui = await k.mount()
  const root = await drawnOf(ui)
  // A plain card lights its edge and fill; a card with its own edge (blocked red) keeps that edge and lights the fill only.
  expect(hoverOf(keyed(root, 't-tr'))).toEqual({ borderColor: HOVER_EDGE, backgroundColor: HOVER_FILL })
  expect(hoverOf(keyed(root, 'd-d1'))).toEqual({ borderColor: HOVER_EDGE, backgroundColor: HOVER_FILL })
  expect(hoverOf(keyed(root, 't-tb'))).toEqual({ backgroundColor: HOVER_FILL })
  expect(hoverOf(keyed(root, 'd-d2'))).toEqual({ backgroundColor: HOVER_FILL })
  expect(hoverOf(keyed(root, 'detail-tr'))).toEqual({ color: 'claude' }) // lights with its card
  await ui.unmount()
})

test('criterion 11 (terminal): no card carries a hover', async ($, on) => {
  const term = await mBoot($, on, { surface: 'terminal' })
  const tui = await term.mount()
  expect(nodesOf(await drawnOf(tui)).filter(n => hoverOf(n) !== undefined)).toEqual([])
  await tui.unmount()
})

test('criterion 11: the read-only cards of other sessions carry no hover', async ($, on) => {
  await bootOthers($, on, 'desktop', DESIGN_LISTING, DESIGN_FILES)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'others-toggle' })
  const root = await drawnOf(ui)
  expect(otherBoxes(root).length).toBe(2)
  expect(otherBoxes(root).every(b => hoverOf(b) === undefined)).toBe(true)
  expect(hoverOf(keyed(root, 't-t1'))).toBeDefined() // the own task card still has it
  await ui.unmount()
})

test('criterion 12: opening a detail scrolls to the pane start, back to the card left (nearest); a failing scroll breaks nothing', async ($, on) => {
  // The fake engine has no implementation for a plugin's $.ui.scroll ("no implementation for ui.scroll", measured), so the call's
  // arguments are tested through the pure helper, and the press path with the call failing.
  expect(detailScroll('agent-team', 't1')).toEqual({ in: 'agent-team', to: 'start' })
  expect(detailScroll('agent-team', null, 't1')).toEqual({ in: 'agent-team', to: { key: 't-t1' }, block: 'nearest' })
  const k = await mBoot($, on)
  const ui = await k.mount()
  await ui.press({ key: 'detail-tr' })
  expect(await ui.find({ key: 'detail-back' })).toBeDefined()
  await ui.press({ key: 'detail-back' })
  expect(await ui.find({ key: 't-tr' })).toBeDefined()
  await ui.unmount()
})

// Coming back another day (task "reopen", criteria R1-R7 of analyst-report.md §3 plus owner Q4). Fixture: a store record for the session id,
// empty atoms, a status file written 2026-11-14 22:10 (+03:00), a clock at 2026-11-19 13:25 (+03:00) and a file mtime before the start.
// Every expected string is spelled out by hand from those: 14 Kas, 22:10, 5 gün (19 - 14), one running role = 1, then 0 running tasks.
const R_NOW = Date.parse('2026-11-19T13:25:00+03:00')
const R_OLD_MTIME = Date.parse('2026-11-14T22:10:00+03:00')
const R_PREFIX = '[Agent Team · yeniden açılış]'
const R_TASK = { id: 't1', title: 'Seçim kutusu taşması', stage: 'build', roles: [{ name: 'QA · GPT-6 Astra', state: 'inceliyor', status: 'running' }, { name: 'Analyst', state: 'bitti', status: 'done' }] }
const reopenStatus = (tasks: unknown[] = [R_TASK], updatedAt = '2026-11-14T22:10:00+03:00') => JSON.stringify({ v: 1, updatedAt, lead: 'Opus 5.5', tasks })
const BANNER = /^Oturum yeniden açıldı · durum 5 gün önceki · çalışıyor görünen 1 rol durmuş olabilir$/

const rBoot = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], o: { status?: string; record?: boolean; surface?: 'desktop' | 'terminal'; placed?: boolean; exists?: boolean; recordOff?: boolean } = {}) => {
  const disk = { text: o.status ?? reopenStatus(), mtime: R_OLD_MTIME }
  const log = { sent: [] as string[], contexts: [] as (readonly string[] | undefined)[], opens: 0, openFails: false, attached: 0 }
  const state = { id: ID_OLD }
  const clock = mock.clock(on, { now: R_NOW })
  const store = new Map<string, unknown>(o.record === false ? [] : [[KEY_OLD, rec(OLD, o.recordOff ? OFF : SWITCH, { announced: OLD })]])
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', () => ({ value: undefined }))
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
  on('ui.open', () => {
    log.opens++
    if (log.openFails) return { deny: 'held by another plugin' } as never // a thrown error is skipped by the engine; a { deny } makes $.ui.open reject (d.ts: a pane another plugin holds)
    return { value: o.placed === false ? { isPlaced: false as const, reason: 'no surface' } : { isPlaced: true as const } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/Users/x' }))
  on('session.id', () => ({ value: state.id }))
  on('fs.exists', () => ({ value: o.exists ?? true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: disk.mtime, isLink: false } }))
  on('fs.read', () => ({ value: disk.text }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.attach', (_, e) => {
    log.attached++
    return { clientId: e.clientId }
  })
  on('session.append', (_, e, next) => next(e))
  on('prompt.submit', (_, e) => {
    log.sent.push(e.text)
    log.contexts.push(e.context)
    return { text: e.text }
  })
  const start = () => $.session.start({ cwd: '/Users/x/Projeler/shop', surface: o.surface ?? 'desktop', isInteractive: true })
  await start()
  const mount = () => $.ui.mount({ ...PANE, surface: o.surface ?? 'desktop' })
  const prompt = async (extra: object = {}) => {
    await $.prompt.submit({ wait: false, origin: { kind: 'composer' }, text: 'merhaba', ...extra } as never)
    return (log.contexts.at(-1) ?? []).filter(c => c.startsWith(R_PREFIX))
  }
  const rewrite = async (text = disk.text) => {
    disk.text = text
    disk.mtime = R_NOW + 1000
    await clock.advance(POLL)
  }
  const clear = async (id: string) => {
    state.id = id
    atoms.clear()
    await clock.advance(POLL)
  }
  return { disk, log, state, clock, start, mount, prompt, rewrite, clear }
}
const bannerOf = async (ui: Awaited<ReturnType<Awaited<ReturnType<typeof rBoot>>['mount']>>) => ui.find({ type: 'Text', text: /Oturum yeniden açıldı/ })

test('R1 (desktop): a reopened session shows the day in the header, the banner with the stopped count and age, nothing counted as running, and the Nerede kaldık? button', async ($, on) => {
  const r = await rBoot($, on)
  const ui = await r.mount()
  expect(await ui.find({ type: 'Text', text: /^Lead · Opus 5\.5 · 14 Kas 22:10'de güncellendi$/ })).toBeDefined()
  expect((await bannerOf(ui))?.text).toMatch(BANNER)
  expect(await ui.find({ type: 'Text', text: /^0 çalışıyor · 1 bekliyor · 1 görev$/ })).toBeDefined()
  const dots = (await ui.findAll({ type: 'Svg' })).filter(s => s.props.width === 8).map(s => s.props.alt)
  expect(dots).toEqual(['boşta', 'bitti'])
  expect(await ui.find({ type: 'Text', text: /^durmuş olabilir · inceliyor$/ })).toBeDefined()
  expect((await ui.find({ key: 'reopen-ask' }))?.props.label).toBe('Nerede kaldık?')
  await ui.press({ key: 'reopen-ask' })
  expect(r.log.sent).toEqual(['Nerede kaldık?']) // an owner message: the pane press goes through the outbox like Pause
  await ui.unmount()
})

test('R1 (terminal): the same banner, the day in the header, 0 running in the count, the button on r', async ($, on) => {
  const r = await rBoot($, on, { surface: 'terminal' })
  const ui = await r.mount()
  const root = await drawnOf(ui)
  expect(textNode(root, /14 Kas 22:10/)).toBeDefined()
  expect(textNode(root, BANNER)).toBeDefined()
  expect(textNode(root, /^GÖREVLER · 0 çalışıyor · 1 bekliyor$/)).toBeDefined()
  expect(hotkeys(root)['reopen-ask']).toBe('r')
  await ui.press({ key: 'reopen-ask' })
  expect(r.log.sent).toEqual(['Nerede kaldık?'])
  await ui.unmount()
})

test('R2: once the file is rewritten (mtime after the start) there is no banner and the running role is drawn and counted as running', async ($, on) => {
  const r = await rBoot($, on)
  await r.rewrite()
  const ui = await r.mount()
  expect(await bannerOf(ui)).toBeUndefined()
  expect(await ui.find({ key: 'reopen-ask' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^1 çalışıyor · 1 görev$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Svg' })).filter(s => s.props.width === 8).map(s => s.props.alt)).toEqual(['çalışıyor', 'bitti'])
  // the day stays in the header: it is still the 14th's file
  expect(await ui.find({ type: 'Text', text: /14 Kas 22:10/ })).toBeDefined()
  await ui.unmount()
})

test('R3: the first prompt after the start carries exactly one reopen line (prefix, last write, task · role of the one running role, the step name); the second carries none', async ($, on) => {
  const r = await rBoot($, on)
  const first = await r.prompt()
  expect(first).toHaveLength(1)
  expect(first[0]).toContain('14 Kas 22:10')
  expect(first[0]).toContain('Seçim kutusu taşması · QA · GPT-6 Astra')
  expect(first[0]).not.toContain('Analyst')
  expect(first[0]).toContain('Geri dönüş')
  expect(await r.prompt()).toEqual([])
})

test('R3: a prompt the engine marks isMeta (a notification) takes the line too, without the Lead rule; the line is not repeated after it', async ($, on) => {
  const r = await rBoot($, on)
  const meta = await r.prompt({ isMeta: true })
  expect(meta).toHaveLength(1)
  expect((r.log.contexts.at(-1) ?? []).some(c => c.includes("Sen Lead'sin"))).toBe(false)
  expect(await r.prompt()).toEqual([])
})

test('R3: when the Lead already rewrote the file before the first prompt there is no reopen line', async ($, on) => {
  const r = await rBoot($, on)
  await r.rewrite()
  expect(await r.prompt()).toEqual([])
})

test('R4: a new session (no record) shows no banner and sends no line', FOLDERS, async ($, on) => {
  const r = await rBoot($, on, { record: false })
  const ui = await r.mount()
  expect(await bannerOf(ui)).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Lead · Opus 5\.5 · 14 Kas 22:10'de güncellendi$/ })).toBeDefined() // an old file still shows its day
  await ui.unmount()
  expect(await r.prompt()).toEqual([])
})

test('R4: a hot reload (the atom already holds the file) shows no banner and sends no line', FOLDERS, async ($, on) => {
  const r = await rBoot($, on, { record: false })
  await r.start() // the second start: a record exists now and the atom holds the file
  const ui = await r.mount()
  expect(await bannerOf(ui)).toBeUndefined()
  await ui.unmount()
  expect(await r.prompt()).toEqual([])
})

test('R4: after /clear (no session.start) there is no banner and no line, though the file is still the old one', async ($, on) => {
  const r = await rBoot($, on)
  await r.clear(ID_NEW)
  const ui = await r.mount()
  expect(await ui.find({ type: 'Text', text: /Lead · Opus 5\.5/ })).toBeDefined() // the file is read again on the same path
  expect(await bannerOf(ui)).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^1 çalışıyor · 1 görev$/ })).toBeDefined() // not stopped: the owner cleared, nothing was reopened
  await ui.unmount()
  expect(await r.prompt()).toEqual([])
})

test('R5: a status written on the clock\'s own day shows the clock only, as before', async ($, on) => {
  const r = await rBoot($, on, { status: reopenStatus([R_TASK], '2026-11-19T08:05:00+03:00') })
  const ui = await r.mount()
  expect(await ui.find({ type: 'Text', text: /^Lead · Opus 5\.5 · 08:05'de güncellendi$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Kas/ })).toBeUndefined()
  await ui.unmount()
})

test('R6 / Q4: in team mode a session.attach asks ui.open again, and an answer of isPlaced:false breaks nothing', async ($, on) => {
  const r = await rBoot($, on, { placed: false })
  await r.clock.advance(0)
  expect(r.log.opens).toBe(1) // at session.start
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(r.log.opens).toBe(2)
  const ui = await r.mount() // the pane still draws
  expect(await ui.find({ type: 'Text', text: /Lead · Opus 5\.5/ })).toBeDefined()
  await ui.unmount()
})

test('R6: with team mode off a session.attach opens nothing', async ($, on) => {
  const r = await rBoot($, on, { record: false })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(r.log.opens).toBe(0)
})

test('R7: a task that carries `session` (a live task session) is never drawn as stopped, and is not in the banner count nor the line', async ($, on) => {
  const live = { ...R_TASK, id: 't2', title: 'Ayrı oturum', session: { name: 'gorev-2' } }
  const r = await rBoot($, on, { status: reopenStatus([R_TASK, live]) })
  const ui = await r.mount()
  expect((await bannerOf(ui))?.text).toMatch(BANNER) // still 1 stopped role, the t1 one
  expect(await ui.find({ type: 'Text', text: /^1 çalışıyor · 1 bekliyor · 2 görev$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Svg' })).filter(s => s.props.width === 8).map(s => s.props.alt)).toEqual(['boşta', 'bitti', 'çalışıyor', 'bitti'])
  await ui.unmount()
  const line = (await r.prompt())[0] ?? ''
  expect(line).toContain('Seçim kutusu taşması · QA · GPT-6 Astra')
  expect(line).not.toContain('Ayrı oturum')
})

test('R7 (parser): `session` is kept only as { name } with a non-empty name', async () => {
  const one = (session: unknown) => parseStatus(JSON.stringify({ v: 1, tasks: [{ id: 't1', title: 'G', stage: 'build', session }] })).tasks[0]?.session
  expect(one({ name: 'gorev-2' })).toEqual({ name: 'gorev-2' })
  expect(one({ name: '' })).toBeUndefined()
  expect(one('gorev-2')).toBeUndefined()
  expect(one(undefined)).toBeUndefined()
})

test('a reopened session whose roles are all done still shows the banner (no stopped count) and the line says no role looked running', async ($, on) => {
  const done = { ...R_TASK, roles: [{ name: 'Analyst', state: 'bitti', status: 'done' }] }
  const r = await rBoot($, on, { status: reopenStatus([done]) })
  const ui = await r.mount()
  expect((await bannerOf(ui))?.text).toBe('Oturum yeniden açıldı · durum 5 gün önceki')
  await ui.unmount()
  expect((await r.prompt())[0]).toContain('Çalışıyor görünen rol yok')
})

// hardening (small follow-ups from the QA reports). Group A: on the desktop "Lead'e sor" and the example buttons are presses, not fills.
// Source of the expected strings for A1-A3: the Lead's criteria 1-3 of the hardening brief (`<title> ne durumda?`, the trimmed example, the
// ' · sırada' / ' · gönderildi' label like Pause, the terminal unchanged), and the pause-fast delivery rules already pinned above (HEAD entry).
const ASK_STATUS = JSON.stringify({ v: 1, tasks: [{ id: 't1', title: 'Seçim\nkutusu  taşması', stage: 'build' }] })
const ASKED = 'Seçim kutusu  taşması ne durumda?'

test('hardening A1 (desktop): "Lead\'e sor" sends the one-line question as the owner, never fills, and says "gönderildi"', async ($, on) => {
  const k = await pBoot($, on, { status: ASK_STATUS })
  const ui = await k.mount()
  await ui.press({ key: 'detail-t1' })
  expect((await ui.find({ key: 'detail-ask' }))?.props.label).toBe("Lead'e sor")
  await ui.press({ key: 'detail-ask' })
  expect(k.log.sent).toEqual([ASKED])
  expect(k.log.asUser).toEqual([true])
  expect(k.log.fills).toEqual([])
  expect((await ui.find({ key: 'detail-ask' }))?.props.label).toBe("Lead'e sor · gönderildi")
  await ui.unmount()
})

test('hardening A1 (desktop): mid-turn the question waits ("sırada") and rides the next Lead tool result in the pane reminder', async ($, on) => {
  const k = await pBoot($, on, { status: ASK_STATUS })
  const ui = await k.mount()
  await ui.press({ key: 'detail-t1' })
  await k.start('turn-1')
  await ui.press({ key: 'detail-ask' })
  expect(k.log.sent).toEqual([])
  expect((await ui.find({ key: 'detail-ask' }))?.props.label).toBe("Lead'e sor · sırada")
  expect((await k.tool()).context).toEqual([`${HEAD}\n${ASKED}`])
  expect((await ui.find({ key: 'detail-ask' }))?.props.label).toBe("Lead'e sor")
  expect(k.log.fills).toEqual([])
  await ui.unmount()
})

test('hardening A2 (desktop): an example button sends the example with its trailing space trimmed, never fills', async ($, on) => {
  const k = await pBoot($, on, { noFile: true })
  const ui = await k.mount()
  expect((await ui.find({ key: 'ex-0' }))?.props.label).toBe('Bir hatayı düzelt: …')
  await ui.press({ key: 'ex-0' })
  await ui.press({ key: 'ex-2' })
  expect(k.log.sent).toEqual(['Bir hatayı düzelt:', 'Şu değişikliği incelet:'])
  expect(k.log.fills).toEqual([])
  await ui.unmount()
})

test('hardening A3 (terminal): `s` in the detail view and the example keys still fill the box as before, and send nothing', async ($, on) => {
  const k = await pBoot($, on, { surface: 'terminal', status: ASK_STATUS })
  const ui = await k.mount()
  await ui.press({ key: 'detail-t1' })
  await ui.press({ key: 'detail-ask' })
  expect(k.log.fills).toEqual(['Seçim\nkutusu  taşması hakkında: '])
  expect(k.log.sent).toEqual([])
  await ui.unmount()
})

test('hardening A3 (terminal): an example key fills the box with the example as written, and sends nothing', async ($, on) => {
  const k = await pBoot($, on, { surface: 'terminal', noFile: true })
  const ui = await k.mount()
  await ui.press({ key: 'ex-0' })
  expect(k.log.fills).toEqual(['Bir hatayı düzelt: '])
  expect(k.log.sent).toEqual([])
  await ui.unmount()
})

// Group B: decision-line safety. Sources: criteria 5-7 of the hardening brief; decision-buttons QA r1 LOW 1 (id `): `), qa-fixes QA
// (generated `t1` vs written `t1`), decision-buttons QA r1 follow-ups (CRLF, picked state at start). The made-up id form `#<position>`
// is the Developer's choice (the brief only says it holds a character outside the set, e.g. `#2`).
const IDRE = /^[\p{L}\p{N}._-]{1,64}$/u

test('hardening B5 (parser): a written id counts only if it is 1-64 letters, digits . _ -; anything else, or a repeat, is not written', async () => {
  const s = parseStatus(
    JSON.stringify({
      v: 1,
      decisions: [
        { id: 'a', text: 'A', options: ['x'] },
        { id: 'a): b', text: 'B', options: ['y'] },
        { id: 'a', text: 'tekrar', options: ['z'] },
        { id: 'Şu-1_ü.2', text: 'U', options: [] },
        { id: 'x'.repeat(65), text: 'uzun', options: [] },
        { id: 'x'.repeat(64), text: 'sınır', options: [] },
        { id: 'a b', text: 'boşluklu', options: [] },
        { text: 'kimliksiz', options: [] },
      ],
    }),
  )
  const ids = s.decisions.map(d => d.id)
  // Written ones stay (64 characters is the longest); the rest are made up as `#<position>`: a repeat, `): `, 65 characters, a space, none.
  expect(ids).toEqual(['a', '#2', '#3', 'Şu-1_ü.2', '#5', 'x'.repeat(64), '#7', '#8'])
  for (const id of ids) expect(IDRE.test(id) || id.startsWith('#')).toBe(true)

  const t = parseStatus(
    JSON.stringify({
      v: 1,
      decisions: [{ id: 'd1', kind: 'Takıldı', text: 'Ne?', task: 't1', options: [] }],
      tasks: [
        { title: 'Kimliksiz', stage: 'build' },
        { id: 't1', title: 'Yazılı', stage: 'build' },
        { id: 't1', title: 'Tekrar', stage: 'build' },
        { id: 'a): b', title: 'Bozuk', stage: 'build' },
      ],
    }),
  )
  expect(t.tasks.map(x => x.generatedId === true)).toEqual([true, false, true, true])
  expect(t.tasks.map(x => x.id)).toEqual(['#1', 't1', '#3', '#4'])
  // The decision links to the written t1 only.
  expect(t.tasks.map(x => x.state)).toEqual(['waiting', 'blocked', 'waiting', 'waiting'])
  expect(decisionTask(t.decisions[0]!, t.tasks)).toEqual({ kind: 'Takıldı · Yazılı', blocked: true })
})

test('hardening B5 (parser): the id rule is tested on the raw text: an id with a control character is not written, though stripping would leave a valid one', async () => {
  const s = parseStatus(
    JSON.stringify({
      v: 1,
      decisions: ['d1\r', 'd\u001b2', 'd\u00003', 'd\u007f4', 'd\u009b5', 'd6'].map(id => ({ id, text: 'T', options: [] })),
      tasks: ['t1\r', 't\u001b2', 'ok.3'].map(id => ({ id, title: 'G', stage: 'build' })),
    }),
  )
  expect(s.decisions.map(d => d.id)).toEqual(['#1', '#2', '#3', '#4', '#5', 'd6'])
  expect(s.tasks.map(t => [t.id, t.generatedId === true])).toEqual([['#1', true], ['#2', true], ['ok.3', false]])
})

test('hardening B5 (parser): a decision that names a made-up task id (`#1`) does not link to it', async () => {
  const s = parseStatus(
    JSON.stringify({
      v: 1,
      decisions: [{ id: 'd1', kind: 'Takıldı · Developer', text: 'Ne?', task: '#1', options: [] }],
      tasks: [{ title: 'Kimliksiz', stage: 'build', roles: [{ name: 'Developer', state: 'yazıyor', status: 'running' }] }],
    }),
  )
  expect(s.tasks[0]).toMatchObject({ id: '#1', generatedId: true, state: 'running' })
  expect(decisionTask(s.decisions[0]!, s.tasks)).toEqual({ kind: 'Takıldı · Developer', blocked: false })
})

test('hardening B5 (terminal): an id with `): ` next to `a` — each card writes and finds only its own line', async ($, on) => {
  const odd = JSON.stringify({ v: 1, decisions: [{ id: 'a', text: 'A?', options: ['X', 'Y'] }, { id: 'a): b', text: 'B?', options: ['P', 'Q'] }] })
  const k = await kBoot($, on, odd)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pressKey(ui, k.echo, 'd-a-0')
  expect(k.box.text).toBe('Karar (a): X')
  await pressKey(ui, k.echo, 'd-#2-0')
  expect(k.box.text).toBe('Karar (a): X\nKarar (#2): P')
  await pressKey(ui, k.echo, 'd-a-1')
  expect(k.box.text).toBe('Karar (a): Y\nKarar (#2): P')
  const root = await drawnOf(ui)
  const card = (key: string) => nodesOf(root).find(n => n.props?.key === key) as Node
  expect(textNode(card('d-a'), /^✓ seçildi: Y/)).toBeDefined()
  expect(textNode(card('d-#2'), /^✓ seçildi: P/)).toBeDefined()
  await ui.unmount()
})

test('hardening B5 (pane): an id-less task before a written t1 — every key is unique and "Ayrıntı" opens the written t1', async ($, on) => {
  const text = JSON.stringify({ v: 1, tasks: [{ title: 'Kimliksiz', stage: 'build' }, { id: 't1', title: 'Kimlikli', stage: 'review' }] })
  await boot($, on, text)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const keys = nodesOf(await drawnOf(ui)).flatMap(n => (n.props?.key === undefined ? [] : [String(n.props.key)]))
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([])
    await ui.press({ key: 'detail-t1' })
    const root = await drawnOf(ui)
    expect(textNode(root, /^Kimlikli$/)).toBeDefined()
    expect(textNode(root, /^Kimliksiz$/)).toBeUndefined()
    await ui.press({ key: 'detail-back' })
    await ui.unmount()
  }
})

test('hardening B6: a Karar row ending in \\r is picked; replacing it keeps every other row (their \\r too) and its own \\r', async () => {
  // Expected values by hand: CRLF rows split on \n leave a \r at the end of each row but the last.
  expect(kararLines('önce\r\nKarar (d1): A\r\nKarar (d2): B\r\nsonra')).toEqual(['Karar (d1): A', 'Karar (d2): B'])
  const d = { id: 'd1', text: 't', options: ['A', 'B'] }
  expect(pickedAt(kararLines('Karar (d1): B\r\n'), d)).toBe(1)
  expect(withKarar('önce\r\nKarar (d1): A\r\nsonra\r\n', 'd1', 'B')).toBe('önce\r\nKarar (d1): B\r\nsonra\r\n')
  expect(withKarar('önce\r\nKarar (d1): A\nsonra\r\n', 'd1', 'B')).toBe('önce\r\nKarar (d1): B\nsonra\r\n') // the replaced row had no \r: none is added
  expect(withKarar('önce\r\n', 'd1', 'B')).toBe('önce\r\nKarar (d1): B')
})

test('hardening B6 (terminal): a CRLF box shows the picked option at once and a press keeps the other rows byte for byte', async ($, on) => {
  const k = await kBoot($, on, TERM, { boxText: 'önce\r\nKarar (d1): Durumları gör\r\nsonra' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(textNode(await drawnOf(ui), /^✓ seçildi: Durumları gör/)).toBeDefined()
  await pressKey(ui, k.echo, 'd-d1-1')
  expect(k.box.text).toBe('önce\r\nKarar (d1): Sonra\r\nsonra')
  await ui.unmount()
})

test('hardening B7 (terminal): Karar lines already in the box when the session starts show picked without any edit', async ($, on) => {
  const k = await kBoot($, on, TERM, { boxText: 'Karar (d1): Sonra\nyarım' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(textNode(await drawnOf(ui), /^✓ seçildi: Sonra · Enter ile gider$/)).toBeDefined()
  expect(k.log.fills).toEqual([])
  await ui.unmount()
})

test('hardening B7: a failing prompt.read does not break session.start (the pane still draws, nothing is picked); the desktop never reads the box', async ($, on) => {
  const k = await kBoot($, on, TERM, { readFails: true })
  expect(k.log.reads).toBeGreaterThan(0) // the read was tried at the start and failed
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'd-d1' })).toBeDefined()
  expect(textNode(await drawnOf(ui), /^✓ seçildi/)).toBeUndefined()
  await ui.unmount()
})

test('hardening B7 (desktop): starting reads nothing from the box', async ($, on) => {
  const k = await kBoot($, on, TERM, { surface: 'desktop', boxText: 'Karar (d1): Sonra' })
  expect(k.log.reads).toBe(0)
})

// Group C: small correctness. Sources: criteria 8-12 of the hardening brief; qa-fixes QA (lowercase blocking, U+0307); other-decisions QA r2
// follow-ups (surrogate cut, control characters, own file ~4 MiB). Expected strings by hand.
const SEVERITIES = [['blocking', 'a'], ['Blocking', 'b'], ['BLOCKING', 'c'], ['LOW', 'd']] as const
test('hardening C8: a finding severity "blocking" in any letter case is drawn like BLOCKING (error colour, not dim), desktop and terminal', async ($, on) => {
  const findings = SEVERITIES.map(([severity, origin], i) => ({ severity, origin, what: `w${i}` }))
  await boot($, on, detailStatus({ rounds: [{ n: 1, verdict: 'NO-GO', findings }] }))
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'detail-t1' })
    const root = await drawnOf(ui)
    for (const [severity, origin] of SEVERITIES) {
      const tag = textNode(root, new RegExp(`^${severity} · ${origin}$`)) as Node
      expect([surface, severity, tag.props?.color]).toEqual([surface, severity, severity === 'LOW' ? undefined : 'error'])
      expect([surface, severity, !!tag.props?.dimColor]).toEqual([surface, severity, severity === 'LOW' && surface === 'terminal'])
    }
    await ui.press({ key: 'detail-back' })
    await ui.unmount()
  }
})

test('hardening C9: isStuck and isPush also match a kind that carries U+0307 after lowercasing without Turkish rules, and NFD forms; what matched still matches', async () => {
  const dotted = ['Taki̇ldi', 'TAKİLDİ'.toLowerCase(), 'TAKİLDİ'.normalize('NFD'), 'taki̇ldi · Developer', ' TAKİLDİ'.normalize('NFD')]
  const before = ['Takıldı', 'Takildi', 'TAKILDI', 'TAKİLDİ', 'takildi · Developer', ' TAKİLDİ', 'takıldı']
  for (const k of [...dotted, ...before]) expect([k, isStuck(k)]).toEqual([k, true])
  for (const k of ['Bu takildi mı', 'Takilmis', 'Ürün kararı', '', undefined]) expect([k, isStuck(k)]).toEqual([k, false])
  const push = ['Push onayı', 'push onayi', 'PUSH ONAYI', 'PUSH ONAYİ', 'PUSH ONAYİ'.toLowerCase(), 'PUSH ONAYİ'.normalize('NFD'), 'Push onayi̇ · main']
  for (const k of push) expect([k, isPush(k)]).toEqual([k, true])
  for (const k of ['Push', 'Önce push onayı', 'Ürün kararı', undefined]) expect([k, isPush(k)]).toEqual([k, false])
})

test('hardening C10 (parser): every cap on a status text counts code points and never cuts a surrogate pair', async () => {
  // n - 1 letters then two emoji: n + 1 code points, so a cut to n code points keeps the first emoji whole (a cut by code unit would split it).
  const over = (n: number) => 'a'.repeat(n - 1) + '😀😀'
  const kept = (n: number) => 'a'.repeat(n - 1) + '😀'
  const s = parseStatus(
    detailStatus({
      wait: over(120),
      session: { name: over(60) },
      rounds: [{ n: 1, verdict: over(12), candidate: over(64), note: over(400), findings: [{ severity: over(20), origin: over(20), what: over(300), where: over(200) }] }],
      evidence: [{ label: over(60), path: over(300) }],
    }),
  )
  const t = s.tasks[0]!
  const r = t.rounds![0]!
  const f = r.findings[0]!
  expect([t.wait, t.session?.name]).toEqual([kept(120), kept(60)])
  expect([r.verdict, r.candidate, r.note]).toEqual([kept(12), kept(64), kept(400)])
  expect([f.severity, f.origin, f.what, f.where]).toEqual([kept(20), kept(20), kept(300), kept(200)])
  expect([t.evidence![0]!.label, t.evidence![0]!.path]).toEqual([kept(60), kept(300)])
})

test('hardening C10 (other sessions): `cut` counts code points, keeps its …, and never leaves a lone surrogate', async () => {
  const e = { name: 'p--aaaaaaaa.json', kind: 'file', size: 10, mtimeMs: NOW, isLink: false }
  // n + 1 code points: the first n - 1 are kept (n - 2 letters and one whole emoji), then …
  const over = (n: number) => 'a'.repeat(n - 2) + '😀😀😀'
  const kept = (n: number) => 'a'.repeat(n - 2) + '😀…'
  const o = otherSession(e, parseStatus(JSON.stringify({ v: 1, decisions: [{ id: 'd', kind: over(120), text: over(400), options: [over(60)] }] })))!
  expect([o.decisions[0]!.kind, o.decisions[0]!.text, o.decisions[0]!.options[0]]).toEqual([kept(120), kept(400), kept(60)])
  // 120 emoji are 120 code points (240 code units): not cut.
  const fits = otherSession(e, parseStatus(JSON.stringify({ v: 1, decisions: [{ id: 'd', kind: '😀'.repeat(120), text: 'x', options: [] }] })))!
  expect(fits.decisions[0]!.kind).toBe('😀'.repeat(120))
})

test('hardening C10 (pane): a candidate shortened to 7 characters (card, detail, round) never splits an emoji, desktop and terminal', async ($, on) => {
  const sha = '😀'.repeat(8)
  await boot($, on, detailStatus({ candidate: sha, rounds: [{ n: 1, verdict: 'GO', candidate: sha, findings: [] }] }))
  const seven = '😀'.repeat(7)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const list = await drawnOf(ui)
    expect(textNode(list, new RegExp(`^aday ${seven}$`))).toBeDefined()
    await ui.press({ key: 'detail-t1' })
    const detail = await drawnOf(ui)
    expect(strings(detail).some(x => x.includes(seven))).toBe(true)
    for (const root of [list, detail]) expect(strings(root).filter(x => /\p{Cs}/u.test(x))).toEqual([])
    await ui.press({ key: 'detail-back' })
    await ui.unmount()
  }
})

// Every string a drawn tree holds: text children and string props (labels, keys, colours).
const strings = (n: Node | string): string[] =>
  typeof n === 'string' ? [n] : [...Object.values(n.props ?? {}).filter((v): v is string => typeof v === 'string'), ...(n.children ?? []).flatMap(strings)]
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/

test('hardening C11: C0 controls but tab and line feed, DEL and C1 controls are removed from every kept string, so an escape sequence never reaches the pane', async ($, on) => {
  const x = (v: string) => `${v}\u001b[2J\u009b[2J\u007f\u0000`
  const file = JSON.stringify({
    v: 1,
    lead: x('Lead'),
    decisions: [{ id: 'd1', kind: x('Tür'), text: x('Soru'), meta: x('meta'), options: [x('Evet'), x('Hayır')] }],
    tasks: [
      {
        id: 't1',
        title: x('Başlık'),
        branch: x('dal'),
        wait: x('bekle'),
        stage: 'review',
        roles: [{ name: x('Rol'), state: x('durum'), status: 'running' }],
        rounds: [{ n: 1, verdict: x('GO'), note: x('not'), findings: [{ severity: x('LOW'), origin: x('kök'), what: x('bulgu'), where: x('yer') }] }],
        evidence: [{ label: x('etiket'), path: x('/yol') }],
      },
    ],
  })
  const s = parseStatus(file)
  // Removed, not replaced by a space; tab and line feed stay.
  expect(s.tasks[0]?.title).toBe('Başlık[2J[2J')
  expect(s.decisions[0]?.options).toEqual(['Evet[2J[2J', 'Hayır[2J[2J'])
  expect(parseStatus(JSON.stringify({ v: 1, tasks: [{ id: 't', title: 'a\tb\nc', stage: 'build' }] })).tasks[0]?.title).toBe('a\tb\nc')
  await boot($, on, file)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const list = await drawnOf(ui)
    await ui.press({ key: 'detail-t1' })
    const detail = await drawnOf(ui)
    for (const root of [list, detail]) expect([surface, strings(root).filter(v => CONTROL.test(v))]).toEqual([surface, []])
    expect(textNode(detail, /^Başlık\[2J\[2J$/)).toBeDefined()
    await ui.press({ key: 'detail-back' })
    await ui.unmount()
  }
})

test('hardening C11 (other sessions): the same strip applies to another session\'s file before it is drawn', async ($, on) => {
  const file = JSON.stringify({ v: 1, decisions: [{ id: 'd', kind: 'Tür\u001b[2J', text: 'Soru\u001b[2J', options: ['Evet\u001b[2J'] }] })
  await bootOthers($, on, 'terminal', [entry('x--bbbbbbbb.json')], { 'x--bbbbbbbb.json': file })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'others-toggle' })
  const root = await drawnOf(ui)
  expect(strings(root).filter(v => CONTROL.test(v))).toEqual([])
  expect(textIn(root, 'Soru[2J')).toBe(true)
  await ui.unmount()
})

// Own status file too big. Source: criterion 12 of the hardening brief (cap 1 MiB, the example line, last good view kept, poll goes on).
const BIG_GOOD = JSON.stringify({ v: 1, tasks: [{ id: 't1', title: 'İyi görev', stage: 'build' }] })
const sBoot = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], surface: 'desktop' | 'terminal' = 'desktop', more?: (on: Parameters<TestBody>[1]) => void) => {
  const disk = { text: BIG_GOOD, mtime: 1, size: 100, reads: 0 }
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/Users/x' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: disk.size, mtimeMs: disk.mtime, isLink: false } }))
  on('fs.read', () => {
    disk.reads++
    return { value: disk.text }
  })
  more?.(on)
  const clock = mock.clock(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/Users/x/Projeler/shop', surface, isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface })
  const change = async (text: string, size: number) => {
    Object.assign(disk, { text, size, mtime: disk.mtime + 1 })
    await clock.advance(500)
  }
  return { disk, ui, change, clock }
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`hardening C12 (${surface}): a file over 1 MiB is not read, one short Turkish line says size and limit, the last good view stays, and the poll recovers`, async ($, on) => {
    const k = await sBoot($, on, surface)
    const base = k.disk.reads // the reads the start made
    expect(base).toBeGreaterThan(0)
    expect(await k.ui.find({ key: 'detail-t1' })).toBeDefined()
    await k.change('X'.repeat(10), 1300 * 1024)
    expect(k.disk.reads).toBe(base) // not read
    const line = await k.ui.find({ type: 'Text', text: /^Durum dosyası çok büyük/ })
    expect(line?.text).toBe('Durum dosyası çok büyük: 1300 KiB (en çok 1024 KiB)')
    expect(await k.ui.find({ key: 'detail-t1' })).toBeDefined() // the last good view
    await k.clock.advance(5000) // the poll goes on, and reads nothing while the file stays too big
    expect(k.disk.reads).toBe(base)
    // Exactly 1 MiB is within the cap and is read; the line goes.
    await k.change(BIG_GOOD.replace('İyi', 'Küçük'), 1024 * 1024)
    expect(k.disk.reads).toBe(base + 1)
    expect(await k.ui.find({ type: 'Text', text: /^Durum dosyası çok büyük/ })).toBeUndefined()
    expect(await k.ui.find({ key: 'detail-t1' })).toBeDefined()
    await k.ui.unmount()
  })
}

test('hardening C12: a file under the cap whose view does not fit the state gets a short Turkish line, never the engine\'s message; the next good file recovers', async ($, on) => {
  const k = await sBoot($, on)
  // The stat says 900 KiB (under the cap) but the text read is 5 MiB, so the engine itself refuses the view (its state value limit is 4 MiB).
  await k.change(JSON.stringify({ v: 1, decisions: [{ id: 'd1', text: 'Y'.repeat(5 * 1024 * 1024), options: [] }] }), 900 * 1024)
  const lines = (await k.ui.findAll({ type: 'Text', text: /^Durum dosyası/ })).map(n => n.text)
  expect(lines.length).toBe(1)
  expect(lines[0]).not.toMatch(/\$\.state|4194304|characters|limit/i)
  expect(lines[0]!.length).toBeLessThan(80)
  expect(await k.ui.find({ type: 'Text', text: /İyi görev/ })).toBeDefined() // the last good view
  await k.change(BIG_GOOD.replace('İyi', 'Yeni'), 100)
  expect(await k.ui.findAll({ type: 'Text', text: /^Durum dosyası/ })).toEqual([])
  expect(await k.ui.find({ type: 'Text', text: /Yeni görev/ })).toBeDefined()
  await k.ui.unmount()
})

// Group D: reopen follow-ups. Sources: criteria 14-16 of the hardening brief (reload keeps the banner and the pending line; an unreadable
// status still carries one line; the header date uses the instant in local time), tasks/reopen/qa (lead-r1-adjudication.md). The test
// harness runs in the machine's own time zone (Europe/Istanbul here; the engine ignores TZ set outside), so dates are built from local parts.
test('hardening D14: a hot reload while the reopen banner is up keeps the banner and the pending reopen line', async ($, on) => {
  const r = await rBoot($, on)
  const ui = await r.mount()
  expect(await bannerOf(ui)).toBeDefined()
  await r.start() // the same process again: atoms and store kept, as a hot reload leaves them
  expect((await bannerOf(ui))?.text).toMatch(BANNER)
  const line = await r.prompt()
  expect(line).toHaveLength(1)
  expect(line[0]).toContain('14 Kas 22:10')
  expect(await r.prompt()).toEqual([])
  await ui.unmount()
})

test('hardening D14: a /clear after the reopen still ends the banner and the line', async ($, on) => {
  const r = await rBoot($, on)
  await r.clear(ID_NEW)
  expect(await r.prompt()).toEqual([])
  const ui = await r.mount()
  expect(await bannerOf(ui)).toBeUndefined()
  await ui.unmount()
})

test('hardening D15: an unreadable status file at the first prompt still carries one reopen line that says so and asks for "Geri dönüş"', async ($, on) => {
  const r = await rBoot($, on, { status: '{ bozuk' })
  const first = await r.prompt()
  expect(first).toHaveLength(1)
  expect(first[0]).toContain(R_PREFIX)
  expect(first[0]).toContain('okunamadı')
  expect(first[0]).toContain('Geri dönüş')
  expect(first[0]).not.toMatch(/son yazımı|Çalışıyor görünen/)
  expect(await r.prompt()).toEqual([]) // once only
})

test('hardening D15: a missing status file at the first prompt carries the same line', async ($, on) => {
  const r = await rBoot($, on, { exists: false })
  const first = await r.prompt()
  expect(first).toHaveLength(1)
  expect(first[0]).toContain('okunamadı')
  expect(first[0]).toContain('Geri dönüş')
})

test('hardening D15: an unreadable file the Lead rewrote since the reopen sends no line', async ($, on) => {
  const r = await rBoot($, on, { status: '{ bozuk' })
  await r.rewrite('{ hâlâ bozuk')
  expect(await r.prompt()).toEqual([])
})

// stamp: the written instant, the shown time and the day difference both in local time. The harness runs in the host's zone, so every
// expected value is built from local parts, and the written offsets are built at run time as the local offset shifted by whole hours: the
// digits written then differ from the local time in every zone, and only reading the instant gives the local day and clock.
const isoAt = (ms: number, offsetMin: number, form: 'colon' | 'plain' | 'hours') => {
  const d = new Date(ms + offsetMin * 60_000) // its UTC parts are the clock of that offset
  const p2 = (n: number) => String(n).padStart(2, '0')
  const sign = offsetMin < 0 ? '-' : '+'
  const h = p2(Math.floor(Math.abs(offsetMin) / 60))
  const m = p2(Math.abs(offsetMin) % 60)
  const off = form === 'colon' ? `${sign}${h}:${m}` : form === 'plain' ? `${sign}${h}${m}` : `${sign}${h}`
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:00${off}`
}
test('hardening D16: the header date uses the written instant in local time, in any host zone; a time without an offset counts as local', async () => {
  const now = new Date(2026, 10, 19, 10, 0).getTime()
  const evening = new Date(2026, 10, 18, 23, 30).getTime() // 18 Nov 23:30 local
  const local = -new Date(evening).getTimezoneOffset() // the host's offset in minutes
  for (const shift of [120, -180, 300]) {
    for (const form of ['colon', 'plain', 'hours'] as const) {
      if (form === 'hours' && (local + shift) % 60 !== 0) continue // "+05" cannot spell a half-hour offset
      const iso = isoAt(evening, local + shift, form) // whole hours from the host's offset: the digits are not the local clock
      expect([iso, stamp(iso, now)]).toEqual([iso, { text: '18 Kas 23:30', days: 1 }])
    }
  }
  // A Z time: the instant too (in UTC itself it is also the local clock).
  expect(stamp(new Date(evening).toISOString(), now)).toEqual({ text: '18 Kas 23:30', days: 1 })
  // The same evening written in an offset whose digits fall on today: the local day is yesterday's.
  const lateIso = isoAt(evening, local + 120, 'colon')
  expect(lateIso.slice(0, 10)).toBe('2026-11-19')
  expect(stamp(lateIso, now).days).toBe(1)
  // No offset: local as written.
  expect(stamp('2026-11-18T23:30:00', now)).toEqual({ text: '18 Kas 23:30', days: 1 })
  expect(stamp('2026-11-19T08:05:00', now)).toEqual({ text: '08:05', days: 0 })
  // Just after midnight: yesterday's evening is one day back whatever the offset it is written in.
  const midnight = new Date(2026, 10, 19, 0, 10).getTime()
  const late = new Date(2026, 10, 18, 23, 50).getTime()
  expect(stamp(isoAt(late, local - 180, 'colon'), midnight)).toEqual({ text: '18 Kas 23:50', days: 1 })
  // The brief's example, for a local +03:00 (this Mac); only checked in that zone.
  if (local === 180) expect(stamp('2026-11-18T23:30:00+00:00', now)).toEqual({ text: '02:30', days: 0 })
  expect(stamp(undefined, now)).toEqual({ text: undefined, days: 0 })
})

// Group E: the terminal decision card has one caption row from the start. Source: criterion 18 of the hardening brief (text, same rows
// before and after a press); the other rows' texts are the ones the earlier terminal tests above pin.
const CAPTION = '1-9 ile seç · kutuna yazılır'
test('hardening E18 (terminal): a decision card with options says "1-9 ile seç · kutuna yazılır" until a press, and a press replaces that row, never adds one', async ($, on) => {
  const k = await kBoot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const card = async (key = 'd-d1') => nodesOf(await drawnOf(ui)).find(n => n.props?.key === key) as Node
  const rows = async (key = 'd-d1') => (await card(key)).children?.length
  const before = await rows()
  expect((await card()).children?.map(c => (typeof c === 'string' ? c : textOf(c)))).toContain(CAPTION)
  await pressKey(ui, k.echo, 'd-d1-1')
  expect(await rows()).toBe(before)
  expect(textNode(await card(), /^✓ seçildi: Sonra · Enter ile gider$/)).toBeDefined()
  expect(textNode(await card(), new RegExp(`^${CAPTION}$`))).toBeUndefined()
  // Taking the line out of the box brings the caption back, still the same number of rows.
  await k.type(0, k.box.text.length, '')
  expect(await rows()).toBe(before)
  expect(textNode(await card(), new RegExp(`^${CAPTION}$`))).toBeDefined()
  await ui.unmount()
})

test('hardening E18 (terminal): a press that goes through the queue, and its delivery, keep the card at the same number of rows', async ($, on) => {
  const k = await kBoot($, on, TERM, { isFilled: false })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const rows = async () => ((nodesOf(await drawnOf(ui)).find(n => n.props?.key === 'd-d2') as Node).children ?? []).length
  const before = await rows()
  await ui.press({ key: 'd-d2-0' }) // the box refuses the fill: the press is submitted at once
  expect(k.log.sent).toEqual(['Karar (d2): Evet'])
  expect(await rows()).toBe(before)
  expect(textNode(await drawnOf(ui), /^Gönderildi: Evet$/)).toBeDefined()
  await ui.unmount()
})

test('hardening E18 (terminal): a decision without options has no caption row', async ($, on) => {
  await kBoot($, on, JSON.stringify({ v: 1, decisions: [{ id: 'd9', text: 'Yalnız bilgi', options: [] }] }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(textNode(await drawnOf(ui), new RegExp(`^${CAPTION}$`))).toBeUndefined()
  await ui.unmount()
})

// Group F: test gaps the QA reports named. Each test below fails on the mutant its title names (mutants.log holds the runs).
// Sources: decision-buttons QA r1 LOW 2 and 3 (F19, F20), desktop-karar QA r2 LOW 1 and 2 (F21), reopen QA LOW (F22), other-decisions
// QA r2 LOW 1 (F23), clear-continuity (F24).
const DECORATED = { text: 'KÖK', cursor: 1, decorations: [{ start: 0, end: 1, bold: true }] }

test('hardening F19: prompt.edit returns exactly what next(e) returned (text, cursor, decorations of another hook), on the untouched-line path', async ($, on) => {
  const k = await kBoot($, on, TERM, { edit: () => DECORATED })
  expect(await k.rawEdit({ origin: { kind: 'composer' }, text: 'abc', cursor: 3, start: 3, end: 3, inputText: 'd' })).toEqual(DECORATED)
})

test('hardening F19: the same on the changed-decision-line path (the atom is synced, the answer is still next(e)\'s)', async ($, on) => {
  const k = await kBoot($, on, TERM, { boxText: 'Karar (d1): Sonra', edit: () => ({ text: 'Karar (d1): Sonrax', cursor: 2, decorations: DECORATED.decorations }) })
  const r = await k.rawEdit({ origin: { kind: 'composer' }, text: 'Karar (d1): Sonra', cursor: 17, start: 17, end: 17, inputText: 'x' })
  expect(r).toEqual({ text: 'Karar (d1): Sonrax', cursor: 2, decorations: DECORATED.decorations })
})

test('hardening F19: a rejection of next(e) reaches the caller (the hook never swallows it)', async ($, on) => {
  const k = await kBoot($, on, TERM, {
    edit: () => {
      throw new Error('core refused')
    },
  })
  let failed = false
  await k.rawEdit({ origin: { kind: 'composer' }, text: 'a', cursor: 1, start: 1, end: 1, inputText: 'b' }).catch(() => (failed = true))
  expect(failed).toBe(true)
})

test('hardening F20 (terminal): a press appends below the owner\'s text and keeps its leading and trailing whitespace', async ($, on) => {
  const k = await kBoot($, on, TERM, { boxText: '  \tönce yaz  ' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pressKey(ui, k.echo, 'd-d1-0')
  expect(k.box.text).toBe('  \tönce yaz  \nKarar (d1): Durumları gör')
  expect(k.log.fills).toEqual([{ text: '\nKarar (d1): Durumları gör', mode: 'append' }]) // only the new line goes in; nothing the owner typed is re-written
  await ui.unmount()
  expect(withKarar('  a  ', 'd1', 'X')).toBe('  a  \nKarar (d1): X')
  expect(withKarar('a\n  ', 'd1', 'X')).toBe('a\n  \nKarar (d1): X')
  expect(withKarar('\n\nx', 'd1', 'X')).toBe('\n\nx\nKarar (d1): X')
})

test('hardening F21 (a): a failed delivery gives back only its own press: another decision\'s "Gönderildi" stays', async ($, on) => {
  const k = await pBoot($, on)
  const ui = await k.mount()
  await k.start('turn-1')
  await ui.press({ key: 'd-d1-0' })
  expect((await k.tool()).context).toEqual([`${HEAD}\nKarar (d1): Durumları gör`]) // d1 delivered
  await k.end('turn-1')
  k.gate.submit = 'throws'
  await ui.press({ key: 'd-d2-0' }) // idle: submitted at once, and the submit fails
  const root = await drawnOf(ui)
  expect(textNode(root, /^Gönderildi: Durumları gör$/)).toBeDefined() // d1's mark stays
  expect(textNode(nodesOf(root).find(n => n.props?.key === 'd-d2') as Node, /^Sırada/)).toBeDefined() // d2 is back in the queue
  expect((await ui.find({ key: 'd-d1' }))?.props.borderColor).toBe('success')
  await ui.unmount()
})

test('hardening F21 (b): on the terminal a failed re-press of a delivered decision is requeued and shown "Sırada"; its earlier mark is gone, so a desktop press of the same decision is accepted (kills: rollback keeps the mark)', async ($, on) => {
  const k = await pBoot($, on, { surface: 'terminal', isFilled: false })
  const ui = await k.mount()
  await ui.press({ key: 'd-d1-0' }) // box refuses the fill, idle: submitted
  expect(k.log.sent).toEqual(['Karar (d1): Durumları gör'])
  expect(textNode(await drawnOf(ui), /^Gönderildi: Durumları gör$/)).toBeDefined()
  k.gate.submit = 'throws'
  await ui.press({ key: 'd-d1-1' }) // the same decision again: allowed on the terminal; its submit fails
  const root = await drawnOf(ui)
  expect(textNode(root, /^Sırada/)).toBeDefined()
  expect(textNode(root, /^Gönderildi/)).toBeUndefined()
  // The desktop ignores a press of a decision whose mark stands. After the failed re-press the mark is gone: this press is taken and replaces the queued one.
  k.gate.submit = 'ok'
  const desk = await k.mount('desktop')
  await desk.press({ key: 'd-d1-0' })
  expect(k.log.sent).toEqual(['Karar (d1): Durumları gör', 'Karar (d1): Durumları gör'])
  expect(textNode(await drawnOf(ui), /^Gönderildi: Durumları gör$/)).toBeDefined()
  await desk.unmount()
  await ui.unmount()
})

test('hardening F21 (b2): a failed submit never puts back a press that a newer press of the same decision replaced meanwhile', async ($, on) => {
  const k = await pBoot($, on, { surface: 'terminal', isFilled: false })
  const ui = await k.mount()
  await k.start('turn-1')
  await ui.press({ key: 'd-d1-0' }) // queued behind the running turn
  k.gate.submit = 'hold'
  await k.end('turn-1') // the turn ends: the press is submitted, and the submit stays in flight
  await k.start('turn-2')
  await ui.press({ key: 'd-d1-1' }) // the newer answer, queued behind the new turn
  k.held.settle?.(true) // the first submit now fails
  await k.settle()
  const got = (await k.tool()).context
  expect(got).toEqual([`${HEAD}\nKarar (d1): Sonra`]) // only the newer one
  await ui.unmount()
})

test('hardening F22: a command neither carries the reopen line nor consumes it', async ($, on) => {
  const r = await rBoot($, on)
  const cmd = await r.prompt({ command: { name: 'help', args: '' } })
  expect(cmd).toEqual([])
  expect(await r.prompt()).toHaveLength(1) // the first real prompt still owes it
})

test('hardening F22: a rejecting ui.open at session.attach is caught and next(e) still runs (kills: the hook drops next(e); the engine runs a throwing hook fail-open, so removing the .catch alone is not observable here)', async ($, on) => {
  const r = await rBoot($, on)
  r.log.openFails = true
  const before = r.log.attached
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(r.log.opens).toBeGreaterThan(1) // asked again, and the open was refused ({ deny }: the call rejects)
  expect(r.log.attached).toBe(before + 1) // the engine's own attach ran
})

test('hardening F22: team mode off with a store record shows no banner and sends no reopen line', async ($, on) => {
  const r = await rBoot($, on, { recordOff: true })
  const ui = await r.mount()
  expect(await bannerOf(ui)).toBeUndefined()
  expect(await r.prompt()).toEqual([])
  await ui.unmount()
})

// A mounted session whose status folder lists other sessions' files from a fake that the test changes, polled by a mock clock.
test('hardening F23: a file that leaves the listing and comes back with the same size and mtime is read again (the seen cache is pruned)', async ($, on) => {
  const reads: string[] = []
  const state = { listing: [entry('p--aaaaaaaa.json', { size: 120, mtimeMs: NOW - 60_000 })] }
  const file = decisionsOnly(1)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/Users/x' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: state.listing }))
  on('fs.read', (_, e) => {
    reads.push(e.path)
    return { value: file }
  })
  const clock = mock.clock(on, { now: NOW })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.append', (_, e, next) => next(e))
  await $.session.start({ cwd: '/Users/x/Projeler/shop', surface: 'desktop', isInteractive: true })
  expect(reads).toHaveLength(1)
  await clock.advance(500)
  expect(reads).toHaveLength(1) // unchanged: from the cache
  state.listing = []
  await clock.advance(500) // gone from the listing: forgotten
  state.listing = [entry('p--aaaaaaaa.json', { size: 120, mtimeMs: NOW - 60_000 })]
  await clock.advance(500)
  expect(reads).toHaveLength(2) // back with the same size and mtime: read again
})

// Round 2 (R1): the overflow line is for a real overflow of the status write only. Source: criterion 12 and QA r1 Neon finding 1 (probes PROBE_4, 4b).
const FRESH = BIG_GOOD.replace('İyi', 'Yeni')
test('hardening C12 / R1: a failing outbox update after a good status write keeps the new view and shows no overflow line', async ($, on) => {
  const deny = { outboxOnce: false }
  const k = await sBoot($, on, 'desktop', on2 =>
    on2('state.set', (_, e, next) => {
      if (e.key === 'outbox' && deny.outboxOnce) {
        deny.outboxOnce = false
        return { deny: 'transient outbox failure' } as never
      }
      return next(e)
    }),
  )
  deny.outboxOnce = true
  await k.change(FRESH, 100)
  expect(await k.ui.find({ type: 'Text', text: /Yeni görev/ })).toBeDefined() // the good write is not reverted
  expect(await k.ui.find({ type: 'Text', text: /^Durum dosyası/ })).toBeUndefined()
  await k.ui.unmount()
})

test('hardening C12 / R1: a status write that fails for another reason than size keeps the last view and does not claim an overflow', async ($, on) => {
  const deny = { statusOnce: false }
  const k = await sBoot($, on, 'desktop', on2 =>
    on2('state.set', (_, e, next) => {
      if (e.key === 'status' && deny.statusOnce) {
        deny.statusOnce = false
        return { deny: 'policy denied' } as never
      }
      return next(e)
    }),
  )
  deny.statusOnce = true
  await k.change(FRESH, 100)
  const lines = (await k.ui.findAll({ type: 'Text', text: /^Durum/ })).map(n => n.text)
  expect(lines).toHaveLength(1)
  expect(lines[0]).not.toMatch(/sığmıyor|4 MiB/)
  expect(await k.ui.find({ type: 'Text', text: /İyi görev/ })).toBeDefined()
  await k.ui.unmount()
})

// Round 2 (R6): the session.end timer alone. A stalled poll (its period never answers) and a hand-held `clock.after` isolate it; the mock clock
// cannot, as it also answers `clock.every`. Source: QA r1 Neon finding 6 (probe PROBE_2); mutant: "session.end carry removed".
test('hardening F24 / R6: with the poll stalled, the session.end timer (500 ms) alone carries the record to the new id after /clear', async ($, on) => {
  let sid = ID_OLD
  let now = CLEAR_NOW
  const store = new Map<string, unknown>()
  const atoms = new Map<string, { value: unknown; version: number }>()
  const slot = (e: { plugin: string; key: string }) => `${e.plugin}/${e.key}`
  let carried!: () => void
  const done = new Promise<void>(res => (carried = res))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    if (e.key === `session:${ID_NEW}`) carried()
    return { value: undefined }
  })
  on('store.delete', () => ({ value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('state.get', (_, e) => ({ value: { value: atoms.get(slot(e))?.value, version: atoms.get(slot(e))?.version ?? 0 } }))
  on('state.set', (_, e) => {
    const version = atoms.get(slot(e))?.version ?? 0
    if (e.ifVersion !== undefined && e.ifVersion !== version) return { value: { isSet: false, version } }
    atoms.set(slot(e), { value: e.value, version: version + 1 })
    return { value: { isSet: true, version: version + 1 } }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.close', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/Users/x' }))
  on('session.id', () => ({ value: sid }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 1, isLink: false } }))
  on('fs.read', () => ({ value: '{"v":1}' }))
  on('fs.list', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.append', (_, e, next) => next(e))
  const afters: { ms: number; fire: () => void }[] = []
  on('clock.now', () => ({ value: now }))
  on('clock.every', () => new Promise<never>(() => undefined)) // the poll never ticks
  on('clock.after', (_, e) => new Promise<{ value: undefined }>(res => afters.push({ ms: e.ms, fire: () => res({ value: undefined }) })))
  await $.session.start({ cwd: '/Users/x/Projeler/shop', surface: 'desktop', isInteractive: true })
  const foot = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  await foot.press({ key: 'team-mode' }) // team mode on: the session has a record
  await foot.unmount()
  await $.session.end({ reason: 'clear', sessionId: ID_OLD, resume: { id: ID_OLD } })
  sid = ID_NEW
  atoms.clear()
  expect(afters.map(a => a.ms)).toEqual([500]) // the plugin asked for one look after 500 ms
  now += 500
  afters[0]!.fire()
  await done
  expect(store.get(`session:${ID_NEW}`)).toEqual(rec(OLD, SWITCH, { announced: OLD }, CLEAR_NOW + 500))
})

// Round 2 (R9): the reopen line is claimed in one atomic update, so two prompts at once cannot both carry it.
test('hardening R9: two prompts submitted at the same time carry the reopen line once', async ($, on) => {
  const r = await rBoot($, on)
  const send = (text: string) => $.prompt.submit({ wait: false, origin: { kind: 'composer' }, text } as never)
  await Promise.all([send('bir'), send('iki'), send('üç')])
  expect(r.log.contexts.flatMap(c => c ?? []).filter(c => c.startsWith(R_PREFIX))).toHaveLength(1)
})
