import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Decision, DirEntry, Mode, Other, Outbox, Press, Reopen, RoleStatus, SessionRecord, Status, StatusView, Task, TaskState } from '../types'
import { ANNOUNCE, ASK_WHERE, KARAR, OPEN_ROW, STAGE_LABELS, bandSegments, baseName, clip, countStates, decisionTask, detailScroll, expandHome, flat, isBlocking, isInside, isPush, kararLine, kararLines, otherFiles, otherSession, parseFolders, parseRecord, parseStatus, reopenLine, runningRoles, spinnerWord, stamp, stopped, trimSlash, withKarar } from './status'
import { AMBER, BAD, CLAY, MUTED, OK, TRACK, dotSvg, meterSvg, stagesSvg } from './svg'
import { FRAMES, QUEUED, QUEUED_PUSH, TBOX, hk, termBand, termBanner, termDecisions, termFooter, termHeader, termDetail, termHint, termOthers, termTasks, termUsage } from './terminal'

const PANE = 'agent-team'
const PANE_OPEN = { id: PANE, title: 'Agent Team', columns: 48 } as const
const POLL_MS = 500
const SOON_MS = 500
const TICK_MS = 1000
const KEEP_MS = 30 * 86_400_000

// Change a tag when that value's fields change: it declines what an earlier version stored.
const mode = atom({ plugin: 'agent-team', key: 'mode' } as const, { isOn: false, source: 'off' } as Mode, {
  shape: 'mode-1',
})
const status = atom(
  { plugin: 'agent-team', key: 'status' } as const,
  { file: '', mtime: 0, data: null, error: null } as StatusView,
  { shape: 'status-3' },
)
// The task whose detail view the pane shows (null: the list). Session state, not in the file.
const detail = atom({ plugin: 'agent-team', key: 'detail' } as const, null as string | null, { shape: 'detail-1' })
// Other team sessions' pending decisions (read-only strip) and whether it is open. Session state, starts collapsed.
const others = atom({ plugin: 'agent-team', key: 'others' } as const, [] as Other[], { shape: 'others-2' })
const othersOpen = atom({ plugin: 'agent-team', key: 'othersOpen' } as const, false, { shape: 'others-open-1' })
// The decision lines now in the owner's prompt box (kararLines of the draft): on the terminal a button writes one and the box shows it picked.
const karar = atom({ plugin: 'agent-team', key: 'karar' } as const, [] as string[], { shape: 'karar-1' })
// Pane presses on their way to the Lead (`queue`, in press order) and the decisions whose line was delivered (`sent`: [id, option]; dropped
// when the decision leaves the file). `said`: lines without a decision (Pause, Devam) submitted as the owner, until the next status read.
// One atom, so every change (a press, a delivery, a give-back) is one atomic update.
const outbox = atom({ plugin: 'agent-team', key: 'outbox' } as const, { queue: [], sent: [], said: [] } as Outbox, { shape: 'outbox-2' })
// A resumed session in team mode: when it started (the pane warns while the status file is older), and whether its first prompt still owes the
// Lead the reopen line. since 0: not reopened (a new session, /clear). An atom: a hot reload keeps it, /clear resets it.
const reopened = atom({ plugin: 'agent-team', key: 'reopen' } as const, { since: 0, line: false } as Reopen, { shape: 'reopen-1' })
// Whether this plugin's pane is placed (drawn) now, as $.ui.panes() says: written by the poll only when it changes, so the band above the prompt
// shows and goes by itself (a pane closed, the terminal resized across the floor). The frame (0-3) of the running role's glyph in the terminal pane.
const placed = atom({ plugin: 'agent-team', key: 'placed' } as const, false, { shape: 'placed-1' })
const tick = atom({ plugin: 'agent-team', key: 'tick' } as const, 0, { shape: 'tick-1' })

// Raw colors that read on a light and a dark pane alike (a theme key has no card fill).
const CARD = {
  flexDirection: 'column',
  gap: 'sm',
  padding: 'sm',
  borderStyle: 'round',
  borderColor: 'rgba(128,128,128,0.28)',
  backgroundColor: 'rgba(128,128,128,0.10)',
} as const
// The empty pane (approved design "Boş pane").
const EXAMPLES = ['Bir hatayı düzelt: ', 'Yeni özellik ekle: ', 'Şu değişikliği incelet: ']
const STEPS = [
  'Analyst neyin "bitti" sayılacağını yazar.',
  'Developer kendi dalında yazar, tek aday SHA teslim eder.',
  "QA (Astra) inceler; GO olunca main'e birleşir.",
  'Karar gerekince burada "Senin sıran" çıkar.',
]
const ROSTER = [
  ['Analyst', 'Fable 5.2'],
  ['Analyst 2', 'GPT-6 Astra'],
  ['Developer', 'Sonnet 5.5'],
  ['Developer (zor iş)', 'Opus 5.5'],
  ['QA', 'GPT-6 Astra'],
  ['QA 2 · canlı', 'Opus 5.5'],
  ['Helper', 'Haiku 5.5'],
] as const
// Task state chips and the blocked edge (approved design "Takıldı / bekliyor durumları").
const STATE_CHIP: Record<TaskState, [string, string, string]> = {
  running: ['◐ Çalışıyor', 'rgba(217,119,87,0.18)', '#F0B9A5'],
  blocked: ['✗ Takıldı', 'rgba(224,108,108,0.22)', '#F2A3A3'],
  waiting: ['⏸ Bekliyor', 'rgba(229,192,123,0.18)', '#E5CC7A'],
}
const BLOCKED_EDGE = 'rgba(224,108,108,0.45)'
const BLOCKED_INK = '#F2A3A3'
const CHIP_BLOCKING = 'rgba(224,108,108,0.18)'
const CHIP = 'rgba(128,128,128,0.2)'

const DOT_HEX: Record<RoleStatus, string> = { running: CLAY, done: OK, blocked: BAD, waiting: MUTED, idle: MUTED }
const DOT_ALT: Record<RoleStatus, string> = {
  running: 'çalışıyor',
  done: 'bitti',
  blocked: 'takıldı',
  waiting: 'sırada',
  idle: 'boşta',
}

const DOT: Record<RoleStatus, string> = {
  running: 'claude',
  done: 'success',
  blocked: 'error',
  waiting: 'inactive',
  idle: 'inactive',
}

// The status as the pane draws it: a reopened session's file older than the start has its running roles drawn stopped (`cut`), until the Lead writes again.
// The pane, the band, the spinner word and the tick all read this one answer.
async function drawnStatus($: EngineInterface) {
  const view = await read($, status)
  const since = (await read($, reopened)).since
  const cut = since > 0 && view.data && view.mtime < since ? stopped(view.data) : undefined
  return { view, cut, data: cut?.data ?? view.data }
}

async function syncPlaced($: EngineInterface) {
  const now = (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced)
  if ((await read($, placed)) !== now) await update($, placed, () => now)
}

const leadText = (file: string) =>
  [
    "Bu oturum bir Agent Team oturumu (agent-team plugin'i). Sen Lead'sin:",
    "sahibin her mesajını agent-team skill'inin akışıyla ele al; /agent-team yazılması gerekmez.",
    "Skill bu oturumda henüz yüklenmediyse önce Skill aracıyla agent-team skill'ini yükle.",
    `${ANNOUNCE} ${file} (biçimi skill'in references/status.md dosyasında).`,
    'Dosyada bu oturumdan kalma görevler ve kararlar olabilir: yazmadan önce oku, bitirmediklerini koru, yalnız değişeni güncelle.',
  ].join(' ')

const syncKarar = async ($: EngineInterface, draft: string) => {
  const next = kararLines(draft)
  if (JSON.stringify(await read($, karar)) !== JSON.stringify(next)) await update($, karar, () => next)
}

// A press in the pane reaches the Lead without a message box: while a Lead turn runs it waits in the outbox and goes with the result
// of the Lead's next finished tool call (the `tool.call` hook); when no turn runs, or the turn ends with presses left, it is submitted
// as the owner's own message. An approval of an irreversible action (a push) is never put in a tool result: it is submitted at once when
// idle, else when the turn ends. A submit that fails (rejects, or a hook drops it) gives its lines back: a press is never lost.
// `running`: ids of the Lead's turns now running (a set: a queued turn starts before the old one completes).
const HEAD = "[Agent Team pane] Sahip pane'de bastı:"
const mark = (sent: Outbox['sent'], got: Press[]) =>
  got.reduce((acc, g) => (g.id === undefined ? acc : [...acc.filter(([id]) => id !== g.id), [g.id, g.option ?? ''] as [string, string]]), sent)

// Takes the deliverable presses out of the outbox (all, or without the push approvals) and marks their decisions sent, in one update.
// Reads first: with nothing to take (nearly every call) nothing is written, so no state change and no pane redraw per tool call.
async function take($: EngineInterface, ctx: boolean) {
  if (!(await read($, outbox)).queue.some(q => !ctx || !q.push)) return []
  let got: Press[] = []
  await update($, outbox, s => {
    got = ctx ? s.queue.filter(q => !q.push) : s.queue
    const said = ctx ? s.said : [...s.said, ...got.filter(g => g.id === undefined).map(g => g.line)]
    return got.length ? { queue: ctx ? s.queue.filter(q => q.push) : [], sent: mark(s.sent, got), said } : s
  })
  return got
}

// What a failed delivery puts back: before the later presses, a decision pressed again meanwhile keeps its newer press.
const giveBack = ($: EngineInterface, got: Press[]) =>
  update($, outbox, s => ({
    queue: [...got.filter(g => g.id === undefined || !s.queue.some(q => q.id === g.id)), ...s.queue],
    sent: s.sent.filter(([id]) => !got.some(g => g.id === id)),
    said: s.said.filter(l => !got.some(g => g.id === undefined && g.line === l)),
  }))

// Submits everything pending as the owner. Resolves when done; never throws.
// The engine skips this plugin's own prompt.submit hook for its own `$.prompt.submit` (types: the calling hook alone is skipped; measured: QA 2, a
// submit with no context), and a submit takes no context. So the lines a typed prompt carries (the Lead role, the pending reopen line) queue first as
// one hidden user row, the reminder a `session.append` is. Team mode only, as the hook; never throws.
async function contextRow($: EngineInterface) {
  try {
    await follow($) // after a /clear the atoms are reset until it carries the mode over: it runs before the mode is read
    if (!(await read($, mode)).isOn) return
    const line = await takeReopen($)
    const text = [leadText((await read($, status)).file), ...(line ? [line] : [])].join('\n')
    await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
  } catch {}
}

async function submitOut($: EngineInterface) {
  try {
    const got = await take($, false)
    if (!got.length) return
    let entered = false
    await contextRow($)
    try {
      entered = !(await $.prompt.submit({ text: got.map(g => g.line).join('\n'), asUser: true })).drop
    } catch {}
    if (!entered) await giveBack($, got)
  } catch {}
}

// The press itself. A decision that already went is not sent again (two answers to one decision must not reach the Lead), except
// on the terminal, where a repeated fallback press submits again; before delivery the last press per decision wins.
async function press($: EngineInterface, running: Set<string>, p: Press, term = false) {
  try {
    await follow($) // the mode below is read after a /clear carried it over
    let ignored = false
    await update($, outbox, s => {
      ignored = p.id !== undefined && !term && s.sent.some(([id]) => id === p.id)
      if (ignored || (p.id === undefined && s.queue.at(-1)?.line === p.line)) return s
      return { ...s, queue: [...s.queue.filter(q => p.id === undefined || q.id !== p.id), p] }
    })
    if (ignored || (running.size && (await read($, mode)).isOn)) return
    await submitOut($)
  } catch {}
}

// On the terminal a decision button writes its line into the owner's prompt box; the owner sends with Enter, so the answer reaches
// the Lead like a typed message (mid-turn), and one Enter carries several decisions. A new line is appended (the owner's text is
// not re-written), an existing line of that decision is replaced in the whole draft. If the box cannot take it (a dialog, no box)
// or the call fails, the press goes through `press`. On the desktop the composer is the app's own (a fill only writes a draft the
// owner never sees), so the press always goes through `press`.
async function pick($: EngineInterface, running: Set<string>, d: Decision, o: string, term: boolean) {
  let isFilled = false
  if (term) try {
    const box = await $.prompt.read()
    await syncKarar($, box.text).catch(() => undefined)
    const text = withKarar(box.text, d.id, o)
    isFilled =
      text === box.text ||
      (await $.prompt.fill(text.startsWith(box.text) ? { text: text.slice(box.text.length), mode: 'append' } : { text, mode: 'replace' })).isFilled
  } catch {}
  if (!isFilled) await press($, running, { line: kararLine(d.id, o), id: d.id, option: o, push: isPush(d.kind) }, term)
}

const openRow = (file: string) => `${OPEN_ROW}${leadText(file)}`

// The row that tells the Lead (and, later, a resumed session) the status path.
// The system prompt of a running thread does not change mid-session: tell the model in a row.
const announce = ($: EngineInterface, file: string) =>
  $.session.append({
    message: { type: 'user', content: [{ type: 'text', text: openRow(file) }] },
  })

// The one place the status view changes: an open detail whose task is not in the new view is closed
// (file deleted, task removed), so the same id coming back does not reopen it by itself.
async function setView($: EngineInterface, view: StatusView) {
  await update($, status, () => view)
  await tidy($, view)
}

async function tidy($: EngineInterface, view: StatusView) {
  const ids = view.data?.decisions.map(d => d.id) ?? []
  await update($, outbox, s => ({ ...s, sent: s.sent.filter(([id]) => ids.includes(id)), said: [] }))
  const open = await read($, detail)
  if (open && !view.data?.tasks.some(t => t.id === open)) await update($, detail, () => null)
}

// The own file is read only up to this size: the pane's state holds the parsed view (4 MiB at most), and a file this big is not a status.
const MAX_KIB = 1024
const STATE_MAX = 4_194_304
async function refresh($: EngineInterface, file: string) {
  const prev = await read($, status)
  if (!(await $.fs.exists(file))) {
    if (prev.file !== file || prev.data || prev.error) await setView($, { file, mtime: 0, data: null, error: null })
    return
  }
  const { mtimeMs, size } = await $.fs.stat(file)
  if (prev.file === file && prev.mtime === mtimeMs) return
  // Every failure keeps the last good view and shows one Turkish line; the next change of the file tries again.
  const fail = (error: string) => setView($, { file, mtime: mtimeMs, data: prev.data, error })
  if (size > MAX_KIB * 1024) return fail(`Durum dosyası çok büyük: ${Math.ceil(size / 1024)} KiB (en çok ${MAX_KIB} KiB)`)
  let data: Status
  try {
    const text = await $.fs.read(file)
    data = parseStatus(typeof text === 'string' ? text : '')
  } catch (err) {
    return fail(`Durum dosyası okunamadı: ${err instanceof Error ? err.message : String(err)}`)
  }
  const view: StatusView = { file, mtime: mtimeMs, data, error: null }
  try {
    await update($, status, () => view)
  } catch (err) {
    // Only a view over the state limit (the engine counts the characters of the JSON value) says so; any other refusal says what it was.
    await fail(
      JSON.stringify(view).length > STATE_MAX ? "Durum dosyası pane'in durum sınırına sığmıyor (en çok 4 MiB)" : `Durum dosyası pane'e yazılamadı: ${err instanceof Error ? err.message : String(err)}`,
    )
    return
  }
  // The new view is written: a failure of what follows (the outbox, the open detail) is not the view's, and never takes it back.
  await tidy($, view)
}

// The other files of the status folder (see otherFiles): untrusted data, read-only; what fails to list, read or parse is skipped.
// `seen` keeps the parse of a file by its size and mtime, so a quiet poll is one listing and no reads.
type Seen = Map<string, { size: number; mtimeMs: number; other?: Other }>
async function scanOthers($: EngineInterface, dir: string, own: string, seen: Seen) {
  const one = async (e: DirEntry) => {
    const hit = seen.get(e.name)
    if (hit && hit.size === e.size && hit.mtimeMs === e.mtimeMs) return hit.other
    let text: unknown
    try {
      text = await $.fs.read(`${dir}/${e.name}`)
    } catch {
      return undefined
    }
    let other: Other | undefined
    try {
      other = otherSession(e, parseStatus(typeof text === 'string' ? text : ''))
    } catch {}
    seen.set(e.name, { size: e.size, mtimeMs: e.mtimeMs, other })
    return other
  }
  // Nothing in here may throw out: another session's file must not stop this session's poll or start.
  let next: Other[] = []
  try {
    const files = otherFiles(await $.fs.list(dir), dir, own, await $.clock.now())
    const names = new Set(files.map(f => f.name))
    for (const name of seen.keys()) if (!names.has(name)) seen.delete(name)
    next = (await Promise.all(files.map(one))).filter((o): o is Other => !!o)
  } catch {}
  try {
    if (JSON.stringify(await read($, others)) !== JSON.stringify(next)) await update($, others, () => next)
  } catch {}
}

// What a session keeps in $.store (one key per session, so two sessions never write one value): /clear changes the id and
// resets every atom, so the new id's record is the old one carried over; a resumed process finds its record by its id.
async function save($: EngineInterface, sid: string, rec: Omit<SessionRecord, 'at'>) {
  if (sid) await $.store.set(`session:${sid}`, { ...rec, at: new Date(await $.clock.now()).toISOString() })
}

// Records of sessions untouched for 30 days go; one whose `at` cannot be read is left alone.
async function sweep($: EngineInterface) {
  const now = await $.clock.now()
  for (const key of await $.store.keys()) {
    if (!key.startsWith('session:')) continue
    const held = await $.store.get(key)
    if (now - Date.parse(String(typeof held === 'object' && held ? (held as { at?: unknown }).at : '')) > KEEP_MS) await $.store.delete(key)
  }
}

// /clear: a new id, no session.start, every atom reset. `follow` sees the id change, carries the record over to the new
// id and puts the mode and the path back; the poll, a prompt and /team all run it before they read the atoms.
// `followed` is what session.start settled on: the status folder, the file it reads, the last session id seen.
const followed = { dir: '', file: '', last: '' }

// The reopen line, once: the first prompt of any kind (commands excepted) takes it, unless the Lead already rewrote the file.
async function takeReopen($: EngineInterface) {
  try {
    if (!(await read($, reopened)).line) return undefined // nearly every prompt: nothing is written
    // Claimed in one update: of two prompts at once, only the one that sees `line` set takes it.
    let since = -1
    await update($, reopened, s => {
      since = s.line ? s.since : -1
      return s.line ? { ...s, line: false } : s
    })
    if (since < 0) return undefined
    const { data, mtime } = await read($, status)
    return mtime < since ? reopenLine(data, await $.clock.now()) : undefined
  } catch {
    return undefined
  }
}

async function follow($: EngineInterface) {
  const { dir, file, last: was } = followed
  if (!dir) return
  // Nothing in here may throw out: it runs in the poll, in prompt.submit and in a command.
  try {
    const id = String(await $.session.id().catch(() => ''))
    if (!id || id === was) return
    followed.last = id
    await update($, reopened, () => ({ since: 0, line: false })) // /clear: the owner cleared, nothing was reopened
    // The path comes back first, record or none: a session that never was a team session has no record, and a /team
    // before the next poll must not read the reset (empty) path.
    await refresh($, file)
    const old = was ? parseRecord(await $.store.get(`session:${was}`), dir) : undefined
    if (!old) return
    await save($, id, old)
    if (old.mode.isOn) await update($, mode, () => old.mode)
  } catch {
    followed.last = was
  }
}

async function setMode($: EngineInterface, isOn: boolean) {
  await follow($) // the footer chip and the pane buttons come here too
  const was = await read($, mode)
  if (was.isOn === isOn) return
  const now: Mode = { isOn, source: isOn ? 'switch' : 'off' }
  await update($, mode, () => now)
  // Never an empty path (the atom is reset by /clear until the next poll): the file this session reads.
  const file = (await read($, status)).file || followed.file
  await save($, String(await $.session.id().catch(() => '')), { file, mode: now, ...(isOn && { announced: file }) })
  if (isOn) await announce($, file)
  else
    await $.session.append({
      message: {
        type: 'user',
        content: [{ type: 'text', text: '[Agent Team modu kapandı] Bu oturum artık normal bir Claude oturumu; agent-team akışını bırak.' }],
      },
    })
  if (isOn) await $.ui.open(PANE_OPEN)
  else await $.ui.close({ id: PANE })
}

// The glyph tick: one 1 s timer while the terminal pane is placed, team mode is on and a role is drawn running. The poll starts and stops it; the timer
// checks again before every write, so nothing is written after the last role stops. Nothing else reads `tick`: only the Pane redraws.
// A (re)start of the session drops the old timer, so a hot reload or a new session never leaves two.
let beat: ReturnType<EngineInterface['clock']['every']> | undefined
// A session that ended for good (exit, logout, -p done): the poll, which nothing cancels, must not start the timer again. Clear and resume go on in the process.
let ended = false
const turning = async ($: EngineInterface) => (await read($, mode)).isOn && (await read($, placed)) && runningRoles((await drawnStatus($)).data).length > 0
function stopBeat() {
  beat?.cancel()
  beat = undefined
}
async function syncTick($: EngineInterface) {
  if (ended || !(await turning($))) return stopBeat()
  beat ??= $.clock.every(TICK_MS, async () => {
    try {
      if (await turning($)) await update($, tick, n => (n + 1) % FRAMES.length)
      else stopBeat()
    } catch {} // a failed read or write skips this beat; the next one tries again
  })
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    stopBeat()
    ended = false
    await $.command.register({ name: 'team', description: 'Agent Team modunu aç ya da kapat' })
    await $.command.register({ name: 'team-pane', description: "Agent Team pane'ini aç" })

    const home = (await $.env.get('HOME')) ?? ''
    const root = trimSlash(expandHome(String(options.evidenceRoot || '~/agent-team-evidence'), home))
    // One file per session: sessions in one folder (the SSH server's home) must not share a status.
    // A session keeps its first file whatever its id becomes: the one the atom holds (a reload), else the one in
    // this session's store record (a resume), if it is on disk; else a new one. No usable id (the call fails or
    // answers empty): the old <project>.json.
    const dir = `${root}/status`
    const sid = String(await $.session.id().catch(() => ''))
    const rec = sid ? parseRecord(await $.store.get(`session:${sid}`).catch(() => undefined), dir) : undefined
    let file = ''
    const held = (await read($, status)).file
    for (const old of [held, rec?.file]) if (!file && old && (await $.fs.exists(old))) file = old
    if (!file) file = `${dir}/${baseName(e.cwd)}${sid ? `--${sid.slice(0, 8)}` : ''}.json`
    Object.assign(followed, { dir, file, last: sid })
    let m = await read($, mode)
    if (!m.isOn) {
      const to: Mode | undefined = isInside(e.cwd, parseFolders(options.teamFolders, home)) ? { isOn: true, source: 'folder' } : rec?.mode.isOn ? rec.mode : undefined
      if (to) await update($, mode, () => (m = to))
    }
    // A reload (the atom holds the file) leaves the reopen state as it is.
    if (m.isOn && !held && rec) {
      const since = await $.clock.now().catch(() => 0)
      await update($, reopened, () => ({ since, line: since > 0 }))
    }
    let announced = rec?.announced
    if (m.isOn) {
      void $.ui.open(PANE_OPEN).catch(() => undefined) // not placed (a narrow terminal, no surface yet): session.attach asks again
      // The path goes to the Lead once per path (the store says so): a reload or a resume does not repeat it.
      if (announced !== file) await announce($, file).then(() => (announced = file), () => undefined)
    }
    // A session that never was a team session leaves no record.
    try {
      if (m.isOn || rec) await save($, sid, { file, mode: m, announced })
      await sweep($)
    } catch {} // a store that fails must not stop the start

    // Karar lines already in the box (a session started or the plugin reloaded with a draft) show picked; the desktop's box is the app's own.
    if (e.surface === 'terminal') await $.prompt.read().then(box => syncKarar($, box.text)).catch(() => undefined)

    const seen: Seen = new Map()
    // Independent: one failing stops neither the other nor the clock.
    const term = e.surface === 'terminal'
    const poll = async () => {
      const done = await Promise.allSettled([follow($), refresh($, file), scanOthers($, dir, file, seen)])
      // Terminal only: whether the pane is placed (the band), and the glyph tick. Reads, and writes only a change.
      if (term) {
        await syncPlaced($).catch(() => undefined) // a failing pane list leaves `placed` as it was; the tick is still looked at
        await syncTick($).catch(() => undefined)
      }
      return done
    }
    await poll()
    $.clock.every(POLL_MS, poll)

    return next(e)
  })

  // A surface joined: a pane opened unasked at the start may not have been placed then (F11), so ask again. The answer changes nothing here.
  on('session.attach', async ($, e, next) => {
    if ((await read($, mode)).isOn) await $.ui.open(PANE_OPEN).catch(() => undefined)
    return next(e)
  })

  // /clear ends the old session and the new id shows a moment later: look once after 500 ms, so a quit right after still leaves a record. The 500 ms poll looks
  // as often, so while it ticks this is a second path; with the poll stalled it is the only one (tested alone: the F24 / R6 test).
  on('session.end', async ($, e, next) => {
    stopBeat() // the tick never outlives its session; the poll starts it again where the process goes on (clear, resume)
    ended = e.reason !== 'clear' && e.reason !== 'resume'
    if (e.reason === 'clear') $.clock.after(SOON_MS, () => follow($))
    return next(e)
  })

  // Every owner prompt in team mode carries the Lead role beside it, unseen by the owner. Not a
  // system-prompt section: another plugin may pass prompt.compose on past this one, and a running
  // thread's system prompt does not change.
  on('prompt.submit', async ($, e, next) => {
    await follow($)
    // Its own submit never runs this hook in the engine; the guard keeps the lines once should one ever do (submitOut queues them).
    if (e.command || (e.origin?.kind === 'plugin' && e.origin.name === 'agent-team') || !(await read($, mode)).isOn) return next(e)
    const { file } = await read($, status)
    const line = await takeReopen($)
    const added = [...(e.isMeta ? [] : [leadText(file)]), ...(line ? [line] : [])]
    return next(added.length ? { ...e, context: [...(e.context ?? []), ...added] } : e)
  })

  // Lead turns now running (a set of ids: a queued prompt's turn starts before the old one completes). A role agent's turn is not the Lead's.
  const running = new Set<string>()
  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) running.add(e.turnId)
    return r
  })
  // The last Lead turn ending with presses pending submits them (not awaited: the submit enters the next turn). Empty set also when a
  // reload lost the ids, so a press is then submitted as before rather than held.
  on('turn.complete', async ($, e, next) => {
    try {
      return await next(e)
    } finally {
      if (e.agentId === undefined) {
        running.delete(e.turnId)
        if (!running.size) void submitOut($)
      }
    }
  })
  // The result of a finished tool call of the Lead carries the pending presses (all but push approvals) as one reminder entry. With
  // nothing pending, team mode off, or a role agent's call, or a deny, core's result is returned as it is; nothing here throws or waits.
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || r.deny !== undefined) return r
    try {
      // Team mode off: pass through; what is left goes out as an owner submit at the turn end (or the next press).
      if (!(await read($, outbox)).queue.some(q => !q.push) || !(await read($, mode)).isOn) return r
      const got = await take($, true)
      if (!got.length) return r
      return { ...r, context: [...(r.context ?? []), [HEAD, ...got.map(g => g.line)].join('\n')] }
    } catch {
      return r
    }
  })

  // The decision lines in the owner's box, for the pane: the owner's own edits (prompt.edit; prompt.change does not carry them) and
  // every other change of the draft (prompt.change): a plugin's fill, a recalled entry, the send that clears it. Never in the way of typing.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    // Typing that leaves the "Karar (" lines as they were is a string check and no atom access; this never throws.
    try {
      if (e.text.includes(KARAR) || box.text.includes(KARAR)) {
        const was = kararLines(e.text).join('\n')
        if (was !== kararLines(box.text).join('\n')) await syncKarar($, box.text)
      }
    } catch {}
    return box
  })
  on('prompt.change', async ($, e, next) => {
    await syncKarar($, e.text).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'team' }, async $ => {
    await follow($)
    const isOn = !(await read($, mode)).isOn
    await setMode($, isOn)
    return { text: isOn ? "Agent Team açık: bu oturumda her mesaj Lead'e gider." : 'Agent Team kapandı.' }
  })

  on('command.run', { command: 'team-pane' }, async $ => {
    await $.ui.open(PANE_OPEN)
    return { text: "Agent Team pane'i açıldı." }
  })

  // A chip left of the footer's mode labels turns team mode on and off, a Pane button next to it opens the pane; the band above the prompt is the other seat (AbovePrompt, below).
  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const { isOn } = await read($, mode)
    if (e.surface === 'terminal') return termFooter($.ui.resolve(e), isOn, e.props.modes, () => void setMode($, !isOn), () => void $.ui.open(PANE_OPEN))
    return (
      <Box flexDirection="row" alignItems="center" gap="sm">
        {/* Desktop draws this slot dim and ignores text colors (seen live): the variant is what shows the state. */}
        <Button
          key="team-mode"
          variant={isOn ? 'primary' : 'secondary'}
          label={isOn ? '● Agent Team' : '○ Agent Team'}
          onPress={() => void setMode($, !isOn)}
        />
        <Button key="team-pane-open" variant="secondary" label="Pane" onPress={() => void $.ui.open(PANE_OPEN)} />
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')}</Text>}
      </Box>
    )
  })

  // While the pane is not drawn: one row above the prompt with this session's counts and a key (after ctrl+x tab) that opens the pane. Terminal only.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey || !(await read($, mode)).isOn || (await read($, placed))) return next(e)
    const { cut, data } = await drawnStatus($)
    const n = countStates(data?.tasks ?? [])
    const total = (await read($, others)).reduce((t, o) => t + o.count, 0)
    const segs = bandSegments({ stale: !!cut, decisions: data?.decisions.length ?? 0, running: n.running, blocked: n.blocked, others: total }, e.props.bodyColumns)
    return segs ? termBand($.ui.resolve(e), segs, () => void $.ui.open({ ...PANE_OPEN, focus: true })) : next(e)
  })

  // The engine's spinner line names the running role during a Lead turn: only its word is rewritten, the engine keeps its mark, timer and color.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.message !== null || !(await read($, mode)).isOn) return next(e)
    const word = spinnerWord((await drawnStatus($)).data)
    return next(word ? { ...e, props: { ...e.props, word } } : e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    // The terminal draws no Svg (its table may still name one): there the bars stay text.
    const term = e.surface === 'terminal'
    const Svg = !term && 'Svg' in ui ? ui.Svg : undefined
    // On the terminal every Button is plain with its key; a card is a single-line box in a theme color.
    const key = (k: string) => (term ? hk(k) : {})
    const card = term ? TBOX : CARD
    const dot = (hex: string, themeKey: string, alt: string, pulse = false) =>
      Svg ? <Svg source={dotSvg(hex, pulse)} alt={alt} width={8} height={8} /> : <Text color={themeKey}>●</Text>
    const m = await read($, mode)
    const other = await read($, others)
    const otherOpen = await read($, othersOpen)
    const otherTotal = other.reduce((n, o) => n + o.count, 0)
    const { view, cut, data } = await drawnStatus($)
    const { file, error } = view
    // The glyph of a running role turns on the terminal only; the desktop never reads the tick.
    const frame = term ? await read($, tick) : 0
    const now = await $.clock.now().catch(() => NaN)
    const lines = await read($, karar)
    const out = await read($, outbox)
    // What a Pause / Devam button adds to its label: queued behind a running turn, or already submitted as the owner (until the file changes).
    const note = (line: string) => (out.queue.some(q => q.line === line) ? 'sırada' : out.said.includes(line) ? 'gönderildi' : '')
    const labelled = (label: string, line: string) => (note(line) ? `${label} · ${note(line)}` : label)
    // A detail opens at its top; back lands on the card that was left. Desktop only: the terminal stays as it is.
    const show = async (id: string | null, from?: string) => {
      await update($, detail, () => id)
      if (!term) await $.ui.scroll(detailScroll(PANE, id, from)).catch(() => undefined)
    }
    // The hover of a pressable card (the surface applies it, no hook runs); a card with its own edge (blocked, sent) lights its fill only.
    const hover = (edge: string) => (term ? undefined : { ...(edge === CARD.borderColor && { borderColor: 'rgba(128,128,128,0.55)' }), backgroundColor: 'rgba(128,128,128,0.16)' })
    const openId = await read($, detail)
    const open = openId ? data?.tasks.find(t => t.id === openId) : undefined

    const errorLine = error && <Text color="error" size="caption">{error}</Text>

    const decisionCard = (d: Decision) => {
      const { kind, blocked } = decisionTask(d, data?.tasks ?? [])
      // The desktop card shows what was delivered, or waits in the outbox: the draft is the engine's, the owner never sees it there.
      const queued = out.queue.find(q => q.id === d.id)
      const sentTo = queued ? undefined : out.sent.find(([id]) => id === d.id)?.[1]
      const at = sentTo === undefined ? -1 : d.options.indexOf(sentTo)
      const edge = sentTo !== undefined ? 'success' : blocked ? BLOCKED_EDGE : CARD.borderColor
      return (
      <Box key={`d-${d.id}`} {...CARD} borderColor={edge} hover={hover(edge)}>
        <Box flexDirection="column">
          {kind && <Text size="caption" weight="medium" color={blocked ? BLOCKED_INK : 'claude'}>{kind}</Text>}
          <Text>{d.text}</Text>
          {d.meta && <Text size="caption" mono dimColor>{d.meta}</Text>}
        </Box>
        {d.options.length > 0 && (
          <Box flexDirection="row" gap="xs" flexWrap="wrap">
            {d.options.map((o, i) => (
              <Button
                key={`d-${d.id}-${i}`}
                label={i === at ? `✓ ${o}` : o}
                variant={i === Math.max(at, 0) ? 'primary' : 'secondary'}
                onPress={() => void pick($, running, d, o, false)}
              />
            ))}
          </Box>
        )}
        {/* Always one caption row, so a press changes its text and never the card's height. */}
        {sentTo !== undefined ? (
          <Text size="caption" color="success">{`Gönderildi: ${sentTo}`}</Text>
        ) : (
          (queued || d.options.length > 0) && <Text size="caption" dimColor>{queued ? (queued.push ? QUEUED_PUSH : QUEUED) : "Bir seçeneğe bas · Lead'e gider"}</Text>
        )}
      </Box>
      )
    }

    // Other sessions' decisions, read-only: options are text, nothing here sends or fills (the owner answers in that session).
    const toggleOthers = () => void update($, othersOpen, v => !v)
    const othersDesktop = () => {
      const counts = other.map(o => `${o.project} · ${o.count} karar${o.stuckCount ? ` (${o.stuckCount} takıldı)` : ''}`).join(' · ')
      return otherOpen ? (
        <Box flexDirection="column" gap="sm">
          <Box flexDirection="row" alignItems="center" justifyContent="space-between">
            <Box flexDirection="row" alignItems="center" gap="xs">
              {dot(AMBER, 'warning', 'diğer oturumlarda karar bekliyor')}
              <Text weight="semibold">Diğer oturumlar</Text>
              <Text dimColor size="caption">{`${otherTotal} karar`}</Text>
            </Box>
            <Button key="others-toggle" label="Gizle" onPress={toggleOthers} />
          </Box>
          {other.map(o => (
            <Box key={`other-${o.file}`} {...CARD} borderColor={o.stuckCount ? BLOCKED_EDGE : CARD.borderColor}>
              <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
                <Text weight="semibold" wrap="truncate-end">{o.name}</Text>
                <Text size="caption" dimColor>{`son yazım ${o.when}`}</Text>
              </Box>
              {o.decisions.map((d, i) => (
                <Box key={`odec-${o.file}-${i}`} flexDirection="column">
                  {d.kind && <Text size="caption" weight="medium" color={d.stuck ? BLOCKED_INK : 'claude'}>{d.kind}</Text>}
                  <Text>{d.text}</Text>
                  {d.options.length > 0 && <Text size="caption" dimColor>{d.options.join(' · ')}</Text>}
                </Box>
              ))}
              {o.count > o.decisions.length && <Text size="caption" dimColor>{`+${o.count - o.decisions.length} karar daha`}</Text>}
            </Box>
          ))}
          <Text size="caption" dimColor>Cevabı o oturumda ver; seçenekler buradan gönderilemez. 24 saattir güncellenmeyen dosyalar sayılmaz.</Text>
        </Box>
      ) : (
        <Box {...CARD} flexDirection="row" alignItems="center" borderColor="rgba(229,192,123,0.40)" backgroundColor="rgba(229,192,123,0.08)">
          {dot(AMBER, 'warning', 'diğer oturumlarda karar bekliyor')}
          <Box flexDirection="column" flexGrow={1}>
            <Text weight="semibold">{`Diğer oturumlarda ${otherTotal} karar bekliyor`}</Text>
            <Text size="caption" dimColor>{counts}</Text>
          </Box>
          <Button key="others-toggle" label="Göster" onPress={toggleOthers} />
        </Box>
      )
    }

    const stateChip = (t: Task) => (
      <Box key={`chip-state-${t.id}`} backgroundColor={STATE_CHIP[t.state][1]} paddingX="xs">
        <Text size="caption" weight="medium" color={STATE_CHIP[t.state][2]}>{STATE_CHIP[t.state][0]}</Text>
      </Box>
    )
    const reason = (t: Task) =>
      t.reason && <Text size="caption" color={t.state === 'blocked' ? BLOCKED_INK : undefined} dimColor={t.state !== 'blocked'}>{t.reason}</Text>

    const taskCard = (t: Task) => (
      <Box key={`t-${t.id}`} {...CARD} borderColor={t.state === 'blocked' ? BLOCKED_EDGE : CARD.borderColor} hover={hover(t.state === 'blocked' ? BLOCKED_EDGE : CARD.borderColor)}>
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
            <Text weight="semibold" wrap="truncate-end">{t.title}</Text>
            <Box flexDirection="row" alignItems="center" gap="xs">
              {t.round !== undefined && <Text size="caption" dimColor>Tur {t.round}</Text>}
              {stateChip(t)}
            </Box>
          </Box>
          {reason(t)}
          {t.branch && <Text size="caption" mono dimColor wrap="truncate-end">{t.branch}</Text>}
        </Box>
        <Box flexDirection="column">
          {Svg ? (
            <Svg source={stagesSvg(t.stage, 5, t.state === 'blocked', t.state === 'running')} alt={`${STAGE_LABELS[t.stage]}, 5 aşamanın ${t.stage + 1}.`} />
          ) : (
            <Text size="caption">
              {STAGE_LABELS.map((_, i) => (
                <Text color={i < t.stage ? 'text' : i === t.stage ? 'claude' : 'inactive'}>━━━ </Text>
              ))}
            </Text>
          )}
          <Text size="caption" dimColor>{`${STAGE_LABELS[t.stage]} · ${t.stage + 1}/5`}</Text>
        </Box>
        {t.roles.length > 0 && (
          <Box flexDirection="column" gap="xs">
            {t.roles.map((r, i) => (
              <Box key={`t-${t.id}-r-${i}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
                <Box flexDirection="row" alignItems="center" gap="xs">
                  {dot(DOT_HEX[r.status], DOT[r.status], DOT_ALT[r.status], r.status === 'running')}
                  <Text wrap="truncate-end">{r.name}</Text>
                </Box>
                <Text size="caption" color={r.status === 'blocked' ? 'error' : undefined} dimColor={r.status !== 'blocked'}>{r.state}</Text>
              </Box>
            ))}
          </Box>
        )}
        {t.candidate && (
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
            <Text size="caption" mono dimColor>aday {clip(t.candidate, 7)}</Text>
            <Box flexDirection="row" gap="xs">
              {!!t.blocking && (
                <Box key={`chip-blocking-${t.id}`} backgroundColor={CHIP_BLOCKING} paddingX="xs">
                  <Text size="caption" color="error" weight="medium">{`${t.blocking} blocking`}</Text>
                </Box>
              )}
              {!!t.followup && (
                <Box key={`chip-followup-${t.id}`} backgroundColor={CHIP} paddingX="xs">
                  <Text size="caption">{`${t.followup} follow-up`}</Text>
                </Box>
              )}
            </Box>
          </Box>
        )}
        <Button key={`detail-${t.id}`} label="Ayrıntı ›" hover={{ color: 'claude' }} onPress={() => void show(t.id)} />
      </Box>
    )

    const asked = (t: Task) => flat(`${t.title} ne durumda?`)
    const detailView = (t: Task) => {
      const last = t.rounds?.at(-1)
      return (
        <Box flexDirection="column" gap="md" padding="sm">
          <Button key="detail-back" label="‹ Görevler" {...key('b')} onPress={() => void show(null, t.id)} />
          {errorLine}
          <Box flexDirection="column">
            <Text size="heading" weight="semibold">{t.title}</Text>
            <Box flexDirection="row" alignItems="center" gap="xs">
              {stateChip(t)}
              {reason(t)}
            </Box>
            {t.branch && <Text size="caption" mono dimColor wrap="truncate-end">{t.branch}</Text>}
            {t.candidate && <Text size="caption" mono dimColor>{clip(t.candidate, 7)}</Text>}
            {last && <Text size="caption" dimColor>{`${last.verdict} · ${last.n} tur`}</Text>}
          </Box>
          {t.rounds && (
            <Box flexDirection="column" gap="sm">
              <Text weight="semibold">Turlar</Text>
              {t.rounds.map((r, i) => (
                <Box key={`round-${i}`} {...card}>
                  <Box flexDirection="row" justifyContent="space-between" gap="sm">
                    <Text weight="semibold" color={r.verdict === 'GO' ? 'success' : r.verdict.startsWith('NO') ? 'error' : undefined}>{`Tur ${r.n} · ${r.verdict}`}</Text>
                    {r.candidate && <Text size="caption" mono dimColor>{clip(r.candidate, 7)}</Text>}
                  </Box>
                  {r.findings.map((f, j) => {
                    const tag = [f.severity, f.origin].filter(Boolean).join(' · ')
                    return (
                    <Box key={`round-${i}-f-${j}`} flexDirection="column">
                      {!!tag && <Text size="caption" weight="medium" color={isBlocking(f) ? 'error' : undefined}>{tag}</Text>}
                      <Text>{f.what}</Text>
                      {f.where && <Text size="caption" mono dimColor>{f.where}</Text>}
                    </Box>
                    )
                  })}
                  {r.note && <Text size="caption" dimColor>{r.note}</Text>}
                </Box>
              ))}
            </Box>
          )}
          {t.evidence && (
            <Box flexDirection="column" gap="xs">
              <Text weight="semibold">Kanıt</Text>
              {t.evidence.map((e, i) => (
                <Box key={`ev-${i}`} flexDirection="column">
                  <Text>{e.label}</Text>
                  {/* Not a Link: the desktop surface draws a non-https href as plain text (engine report in the test), so the path is mono text. */}
                  <Text size="caption" mono dimColor wrap="truncate-middle">{e.path}</Text>
                </Box>
              ))}
            </Box>
          )}
          {/* The composer is the app's own here (a fill is a draft the owner never sees): the question is a press, one line. */}
          <Button key="detail-ask" label={labelled("Lead'e sor", asked(t))} onPress={() => void press($, running, { line: asked(t) })} />
        </Box>
      )
    }

    if (open && term) {
      return (
        <Box flexDirection="column" padding="sm">
          {errorLine}
          {termDetail(
            ui,
            open,
            () => void show(null, open.id),
            () => void $.prompt.fill({ text: `${open.title} hakkında: `, mode: 'replace' }),
            frame,
          )}
        </Box>
      )
    }
    if (open) return detailView(open)

    const written = stamp(data?.updatedAt, now)
    const updated = written.text
    const reopenText = cut && `Oturum yeniden açıldı · durum ${written.days ? `${written.days} gün önceki` : 'önceki oturumdan'}${cut.count ? ` · çalışıyor görünen ${cut.count} rol durmuş olabilir` : ''}`
    const askWhere = () => void press($, running, { line: ASK_WHERE })
    const lim = data?.limits
    const usage = (
      [
        ['5 saatlik', lim?.fiveHourPct],
        ['Haftalık', lim?.weeklyPct],
      ] as const
    ).filter((u): u is readonly [typeof u[0], number] => u[1] !== undefined)
    const n = countStates(data?.tasks ?? [])
    const showOn = !!data && !m.isOn
    // Before the first read (file not yet known: session start, /clear, a reload) two empty cards stand in, not the onboarding text.
    const bar = (w: string) => <Box backgroundColor={TRACK} height={1} width={w} />
    const placeholder = (
      <Box flexDirection="column" gap="sm">
        {[0, 1].map(i => (
          <Box key={`ph-${i}`} {...CARD}>
            {bar('55%')}
            {bar('100%')}
            {bar('35%')}
          </Box>
        ))}
      </Box>
    )
    const placeholderTerm = (
      <Box flexDirection="column">
        {[0, 1].map(i => (
          <Box key={`ph-${i}`}>
            <Text dimColor>░░░░░░░░░░░░░░ ░░░░░░</Text>
          </Box>
        ))}
      </Box>
    )

    return (
      <Box flexDirection="column" gap="md" padding="sm">
        {term ? (
          termHeader(
            ui,
            [data?.lead && `Lead · ${data.lead}`, updated && updated, !m.isOn && 'mod kapalı'].filter(Boolean).join(' · ') || 'Lead',
            data ? !!data.paused : undefined,
            note(data?.paused ? 'Devam et' : 'Pause'),
            t => void press($, running, { line: t }),
          )
        ) : (
        <Box flexDirection="row" justifyContent="space-between" alignItems="flex-start" gap="sm">
          <Box flexDirection="column">
            <Text size="title">Agent Team</Text>
            <Text size="caption" dimColor>
              {[data?.lead && `Lead · ${data.lead}`, updated && `${updated}'de güncellendi`, !m.isOn && 'mod kapalı']
                .filter(Boolean)
                .join(' · ') || 'Lead'}
            </Text>
          </Box>
          {data &&
            (data.paused ? (
              <Button key="resume" label={labelled('Devam', 'Devam et')} onPress={() => void press($, running, { line: 'Devam et' })} />
            ) : (
              <Button key="pause" label={labelled('Pause', 'Pause')} onPress={() => void press($, running, { line: 'Pause' })} />
            ))}
        </Box>
        )}

        {reopenText && (term ? termBanner(ui, reopenText, note(ASK_WHERE), askWhere) : (
          <Box key="reopen-banner" {...CARD} borderColor="rgba(229,192,123,0.40)" backgroundColor="rgba(229,192,123,0.08)">
            <Text>{reopenText}</Text>
            <Button key="reopen-ask" label={labelled(ASK_WHERE, ASK_WHERE)} onPress={askWhere} />
          </Box>
        ))}

        {otherTotal > 0 && (term ? termOthers(ui, other, otherOpen, toggleOthers) : othersDesktop())}

        {showOn && <Button key="pane-team-on" variant="primary" label="Bu oturumda Agent Team'i aç" {...key('o')} onPress={() => void setMode($, true)} />}

        {errorLine}

        {file === '' && (term ? placeholderTerm : placeholder)}

        {file !== '' && !data && !error && (
          <Box flexDirection="column" gap="md">
            <Box flexDirection="column" gap="xs">
              <Text size="heading" weight="semibold">{m.isOn ? 'Takım hazır' : 'Agent Team kapalı'}</Text>
              <Text size="caption" dimColor>
                {m.isOn
                  ? 'Görevi sohbete düz cümleyle yaz. Lead işi rollere dağıtır, sen yalnızca karar gerekince devreye girersin.'
                  : 'Açınca bu sohbet Lead olur ve her mesajın takıma gider. Alt satırdaki Agent Team hapı da aynı işi yapar.'}
              </Text>
            </Box>
            {m.isOn ? (
              <Box flexDirection="column" gap="xs">
                {EXAMPLES.map((x, i) => (
                  <Button key={`ex-${i}`} label={`${x}…`} {...key(String(i + 1))} onPress={() => void (term ? $.prompt.fill({ text: x, mode: 'replace' }) : press($, running, { line: x.trimEnd() }))} />
                ))}
              </Box>
            ) : (
              <Button key="pane-team-on" variant="primary" label="Bu sohbette aç" {...key('o')} onPress={() => void setMode($, true)} />
            )}
            <Box flexDirection="column" gap="xs">
              <Text weight="semibold">Nasıl işler</Text>
              {STEPS.map((s, i) => (
                <Text size="caption" dimColor>{`${i + 1}. ${s}`}</Text>
              ))}
            </Box>
            <Box {...card} gap="xs">
              <Box flexDirection="row" justifyContent="space-between">
                <Text weight="semibold">Takım</Text>
                <Text size="caption" dimColor>{`${ROSTER.length} rol hazır`}</Text>
              </Box>
              {ROSTER.map(([name, model]) => (
                <Box key={`roster-${name}`} flexDirection="row" justifyContent="space-between" gap="sm">
                  <Text>{name}</Text>
                  <Text size="caption" dimColor>{model}</Text>
                </Box>
              ))}
            </Box>
            <Text size="caption" mono dimColor wrap="truncate-middle">{file}</Text>
          </Box>
        )}

        {term && termUsage(ui, usage.map(([label, pct]) => [label === '5 saatlik' ? '5 sa' : 'hafta', pct] as const))}

        {!term && usage.length > 0 &&
          (Svg ? (
            <Box flexDirection="row" gap="md">
              {usage.map(([label, pct]) => (
                <Box key={`lim-${label}`} flexDirection="column" gap="xs" flexGrow={1}>
                  <Box flexDirection="row" justifyContent="space-between">
                    <Text size="caption" dimColor>{label}</Text>
                    <Text size="caption" tabular>{`%${pct}`}</Text>
                  </Box>
                  <Svg source={meterSvg(pct)} alt={`${label} kullanım %${pct}`} />
                </Box>
              ))}
            </Box>
          ) : (
            <Text size="caption" dimColor tabular>
              {usage.map(([label, pct]) => `${label} %${pct}`).join('   ·   ')}
            </Text>
          ))}

        {term && data && data.decisions.length > 0 && termDecisions(ui, data.decisions, data.tasks, (d, o) => void pick($, running, d, o, true), lines, out)}

        {term && data && data.tasks.length > 0 && termTasks(ui, data.tasks, n, showOn, id => void show(id), frame)}

        {term && data && termHint(ui, otherTotal > 0, !!reopenText)}

        {!term && data && data.decisions.length > 0 && (
          <Box flexDirection="column" gap="sm">
            <Box flexDirection="row" alignItems="center" gap="xs">
              {dot(CLAY, 'claude', 'karar bekliyor')}
              <Text weight="semibold">Senin sıran</Text>
              <Text dimColor size="caption">{`${data.decisions.length} karar`}</Text>
            </Box>
            {data.decisions.map(decisionCard)}
          </Box>
        )}

        {!term && data && data.tasks.length > 0 && (
          <Box flexDirection="column" gap="sm">
            <Box flexDirection="row" justifyContent="space-between">
              <Text weight="semibold">Görevler</Text>
              <Text size="caption" dimColor>{`${n.running} çalışıyor${n.blocked ? ` · ${n.blocked} takıldı` : ''}${n.waiting ? ` · ${n.waiting} bekliyor` : ''} · ${data.tasks.length} görev`}</Text>
            </Box>
            {data.tasks.map(taskCard)}
          </Box>
        )}
      </Box>
    )
  })
}
