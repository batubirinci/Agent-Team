import { expect, test } from 'claude-code/testing'

import { isInside, parseFolders, parseStatus, summary } from '../hooks/status'
import { CLAY, MUTED, TRACK, dotSvg, meterSvg, stagesSvg } from '../hooks/svg'

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
    expect(await ui.find({ type: 'Text', text: /Seçim kutusu taşması/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /aday 3f9a1c2$/ })).toBeDefined()
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
  expect(await term.find({ type: 'Text', text: /5 saatlik %42/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /━━━/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /●/ })).toBeDefined()
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

  const off = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  const offKeys = (await off.findAll({ type: 'Button' })).map(b => b.key)
  expect(offKeys).toEqual(['team-mode', 'team-pane-open'])
  expect((await off.find({ key: 'team-pane-open' }))?.text).toBe('Pane')
  expect(await off.find({ type: 'Text', text: /İzinleri atla/ })).toBeDefined()
  await off.press({ key: 'team-pane-open' })
  await off.unmount()
  expect(opened).toMatchObject([{ id: 'agent-team' }])
  expect(appended).toEqual([])

  const toggle = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  await toggle.press({ key: 'team-mode' })
  await toggle.unmount()
  // turning the mode on opens the pane by itself (existing behaviour); start counting from here
  appended.length = 0
  opened.length = 0

  const on2 = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  expect((await on2.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['team-mode', 'team-pane-open'])
  await on2.press({ key: 'team-pane-open' })
  await on2.unmount()
  expect(opened).toMatchObject([{ id: 'agent-team' }])
  expect(appended).toEqual([])
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
