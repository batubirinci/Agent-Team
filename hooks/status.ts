import type { BandCounts, BandSeg, Bound, Candidate, Child, Decision, DirEntry, EvRec, EvRow, EvStat, Evidence, Finding, Forward, Fresh, Kid, Link, Mode, Other, Preview, Role, Round, RoleStatus, SessionLine, SessionRecord, Status, Task, TaskState } from '../types'

export const STAGES = ['spec', 'build', 'review', 'revise', 'report'] as const
export const STAGE_LABELS = ['Spec', 'Build', 'Review', 'Revise', 'Rapor'] as const
const ROLE_STATUSES: readonly RoleStatus[] = ['running', 'done', 'waiting', 'blocked', 'idle']

type Obj = Record<string, unknown>

const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x)
// C0 controls but tab and line feed, DEL and C1 controls (an escape sequence is one) are removed from every string the file gives.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g
const str = (x: unknown): string | undefined => {
  const s = typeof x === 'string' ? x.replace(CONTROL, '') : ''
  return s.trim() ? s : undefined
}
// A string cut to n code points (never between the halves of a surrogate pair): the file is model-written, a pane line is not a place for an essay.
export const clip = (s: string, n: number) => (s.length <= n ? s : Array.from(s).slice(0, n).join(''))
const short = (x: unknown, n: number): string | undefined => {
  const s = str(x)?.trim()
  return s && clip(s, n)
}
// A decision or task id counts as written only if it is 1-64 letters, digits . _ - and no earlier one in its list had it. A made-up id is
// `#<position>`: `#` is outside that set, so it never equals a written one (and `): ` can never be inside one).
const ID = /^[\p{L}\p{N}._-]{1,64}$/u
// The one id rule, on the raw text (before any control character is stripped: `d1\r` is not the id `d1`): every id the parser reads (a decision's id,
// a task's id, a decision's `task` link) goes through it, and a value that fails it is no id.
const idOf = (x: unknown) => (typeof x === 'string' && ID.test(x) ? x : undefined)
// A written id: one that passes the rule and that no earlier one in its list had.
const written = (x: unknown, taken: Set<string>) => {
  const id = idOf(x)
  return id && !taken.has(id) ? (taken.add(id), id) : undefined
}
const num = (x: unknown): number | undefined =>
  typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.round(x) : undefined
const list = (x: unknown): Obj[] => (Array.isArray(x) ? x.filter(isObj) : [])

// A kind as the two rules below read it: no U+0307 (an İ lowered without Turkish rules, or in NFD, is i + U+0307) and no zero-width character (U+200B-U+200D,
// U+2060, U+FEFF), both taken out before the trim, then trimmed, lower case (Turkish rules), ı as i.
const kindOf = (kind?: string) => (kind ?? '').replace(/[\u0307\u200b-\u200d\u2060\ufeff]/g, '').trim().toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/\u0307/g, '')

// A decision kind that says the work is stuck ("Takıldı ...", any case, also "takildi"): one rule for the parser and the strip.
export const isStuck = (kind?: string) => kindOf(kind).startsWith('takildi')

// A decision whose kind says it approves an irreversible action ("Push onayı ...", any case, also "push onayi"): never carried by a tool result.
export const isPush = (kind?: string) => kindOf(kind).startsWith('push onayi')

// How every consumer reads a decision's push flag (fail closed): a push unless the flag is the boolean false. A value stored by an earlier build, or any
// other path that lost the flag, never gives a button, a digit, a forward or a tool-result delivery.
export const pushOf = (d: { push?: unknown }) => d.push !== false

// A finding that blocks, "BLOCKING" in any letter case: one rule for the parser's cap order and for both drawings.
export const isBlocking = (f: Finding) => f.severity?.toLowerCase() === 'blocking'

// The desktop detail's round texts (evidence-restyle). A Map, not an object: the file is untrusted and a key like "constructor" must not find a function.
const SEVERITY = new Map([['blocking', 'ENGELLEYİCİ'], ['high', 'YÜKSEK'], ['medium', 'ORTA'], ['low', 'DÜŞÜK'], ['minor', 'KÜÇÜK']])
const ORIGIN = new Map([['introduced', 'yeni'], ['pre-existing', 'önceden vardı']])
// The severity tag: the Turkish word of a known severity (any letter case), any other value uppercased as written, nothing without one.
export const sevTag = (severity?: string) => (severity ? SEVERITY.get(severity.toLowerCase()) ?? severity.toUpperCase() : undefined)
// A finding's dim line: where, the origin in Turkish (an unknown one as written), and "kapandı" (`closed`: the caller's rule; the file records no round that closed it).
export const findingLine = (f: Finding, closed: boolean) => [f.where, f.origin && (ORIGIN.get(f.origin.toLowerCase()) ?? f.origin), closed && 'kapandı'].filter(Boolean).join(' · ')
// Whether a finding is drawn closed: a BLOCKING one in a round before the last of a task whose last verdict is GO (GO leaves no blocking finding open).
export const isClosed = (rounds: Round[], i: number, f: Finding) => rounds.at(-1)?.verdict === 'GO' && i < rounds.length - 1 && isBlocking(f)
// The line beside the last verdict: "2 turda · 1 engelleyici kapandı · 3 takip". Every number is the file's own (the last round's n, the earlier rounds' BLOCKING
// findings, the task's blocking and followup counts).
export const roundsCaption = (t: Pick<Task, 'rounds' | 'blocking' | 'followup'>) => {
  const rounds = t.rounds ?? []
  const last = rounds.at(-1)
  if (!last) return ''
  const closed = rounds.reduce((n, r, i) => n + r.findings.filter(f => isClosed(rounds, i, f)).length, 0)
  return [`${last.n} turda`, closed > 0 && `${closed} engelleyici kapandı`, (t.blocking ?? 0) > 0 && `${t.blocking} engelleyici açık`, (t.followup ?? 0) > 0 && `${t.followup} takip`].filter(Boolean).join(' · ')
}

// The file is written by the Lead (a model): read it as untrusted data, keep what is well formed.
export function parseStatus(text: string): Status {
  const raw: unknown = JSON.parse(text)
  if (!isObj(raw) || raw.v !== 1) throw new Error('durum dosyası v:1 değil')

  const decisionIds = new Set<string>()
  const taskIds = new Set<string>()
  const decisions: Decision[] = list(raw.decisions).flatMap((d, i) => {
    const t = str(d.text)
    if (!t) return []
    const options = Array.isArray(d.options) ? d.options.map(o => str(o)).filter((o): o is string => !!o).slice(0, 4) : []
    // The two flags are read once, here, from the whole kind as written and as drawn (a control character inside is dropped from the drawn one): every consumer
    // reads the flags, never the kind text, which a copy may cut (a padded "Push onayı" must never lose its flag).
    const kind = str(d.kind)
    const raw = typeof d.kind === 'string' ? d.kind : undefined
    return [{ id: written(d.id, decisionIds) ?? `#${i + 1}`, kind, text: t, meta: str(d.meta), task: idOf(d.task), options, push: isPush(kind) || isPush(raw), stuck: isStuck(kind) || isStuck(raw) }]
  })

  const tasks: Task[] = list(raw.tasks).flatMap((t, i) => {
    const title = str(t.title)
    if (!title) return []
    const stage = STAGES.indexOf(String(t.stage) as (typeof STAGES)[number])
    const roles: Role[] = list(t.roles).flatMap(r => {
      const name = str(r.name)
      if (!name) return []
      const status = ROLE_STATUSES.includes(r.status as RoleStatus) ? (r.status as RoleStatus) : 'idle'
      return [{ name, state: str(r.state) ?? '', status }]
    })
    const rounds: Round[] = list(t.rounds).flatMap((r, j) => {
      const verdict = short(r.verdict, 12)
      if (!verdict) return []
      const all = list(r.findings).flatMap(f => {
        const what = short(f.what, 300)
        return what ? [{ severity: short(f.severity, 20), origin: short(f.origin, 20), what, where: short(f.where, 200) }] : []
      })
      // Over the cap, a BLOCKING finding is never dropped for a non-blocking one; the kept ones read BLOCKING first, then file order.
      const findings = all.length > 10 ? [...all.filter(isBlocking), ...all.filter(f => !isBlocking(f))].slice(0, 10) : all
      // A round numbered 0 (or with no valid number) is shown by its position.
      return [{ n: num(r.n) || j + 1, verdict, candidate: short(r.candidate, 64), note: short(r.note, 400), findings }]
    }).slice(-10)
    const evidence: Evidence[] = list(t.evidence)
      .flatMap(e => {
        const label = short(e.label, 60)
        const path = short(e.path, 300)
        return label && path ? [{ label, path }] : []
      })
      .slice(0, 6)
    // A task with no (usable) id in the file gets one for the UI only; a decision can name only an id that is written.
    const own = written(t.id, taskIds)
    const id = own ?? `#${i + 1}`
    const sessionName = isObj(t.session) ? short(t.session.name, 60) : undefined
    const wait = short(t.wait, 120)
    const asked = own ? decisions.filter(d => d.task === own) : []
    const blocked = roles.find(r => r.status === 'blocked')
    // `done` counts only as the boolean true, and not while a decision of this file names the task: the pane never folds away a task that asks something.
    const finished = t.done === true && asked.length === 0
    const state: TaskState =
      blocked || asked.some(d => d.stuck) ? 'blocked' : roles.some(r => r.status === 'running') ? 'running' : finished ? 'done' : 'waiting'
    const reason =
      state === 'blocked' ? (asked.length ? `senden ${asked.length} karar bekliyor` : blocked?.state || undefined) : wait
    return [{
      id,
      title,
      branch: str(t.branch),
      ...(!own && { generatedId: true as const }),
      stage: stage < 0 ? 0 : stage,
      round: num(t.round),
      candidate: str(t.candidate),
      blocking: num(t.blocking),
      followup: num(t.followup),
      wait,
      ...(finished && { done: true as const }),
      state,
      reason,
      roles,
      ...(sessionName && { session: { name: sessionName } }),
      ...(rounds.length > 0 && { rounds }),
      ...(evidence.length > 0 && { evidence }),
    }]
  })

  const limits = isObj(raw.limits)
    ? { fiveHourPct: num(raw.limits.fiveHourPct), weeklyPct: num(raw.limits.weeklyPct) }
    : undefined

  // A file's `parent` is read nowhere: a task session is joined by its binding in the plugin store, never by what a file says.
  return { updatedAt: str(raw.updatedAt), lead: str(raw.lead), paused: raw.paused === true, limits, decisions, tasks }
}

export const expandHome = (p: string, home: string) => (p === '~' ? home : p.startsWith('~/') ? home + p.slice(1) : p)

export const trimSlash = (p: string) => p.replace(/\/+$/, '') || '/'

export const baseName = (p: string) => trimSlash(p).split('/').pop() || 'root'

export function parseFolders(value: unknown, home: string): string[] {
  const text = Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : ''
  return text
    .split(/[,\n]/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => trimSlash(expandHome(s, home)))
}

export const isInside = (cwd: string, folders: readonly string[]) =>
  folders.some(f => cwd === f || cwd.startsWith(f === '/' ? '/' : f + '/'))

// "14:32" from an ISO time, in the time written there (the Lead writes local time with offset).
export const clockOf = (iso?: string) => iso?.match(/T(\d{2}:\d{2})/)?.[1]

const pad2 = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

// An ISO time as the pane writes it: "14 Kas 22:10" when its day is not `now`'s day, else "22:10", both in local time (a time written with an
// offset is an instant; one without is local already); `days` is how many days before `now`'s day it was written (0: today, or `now` unknown).
export function stamp(iso: string | undefined, now: number) {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return { text: undefined, days: 0 }
  // "Z", "+03:00", "+0300" or "+03" (hours 00-23, minutes 00-59; any other offset is read as no offset: local): the instant is the written clock minus the offset (parsed here: Date reads only "+03:00" forms).
  const o = iso!.match(/(?:(Z)|([+-])([01]\d|2[0-3]):?([0-5]\d)?)$/i)
  const w = o
    ? new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) - (o[1] ? 0 : (o[2] === '-' ? -1 : 1) * (+o[3]! * 60 + +(o[4] ?? 0)) * 60_000))
    : new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!)
  const t = Number.isFinite(now) ? new Date(now) : undefined
  const days = t ? Math.max(0, Math.round((Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) - Date.UTC(w.getFullYear(), w.getMonth(), w.getDate())) / 86_400_000)) : 0
  const clock = `${pad2(w.getHours())}:${pad2(w.getMinutes())}`
  return { text: days ? `${w.getDate()} ${MONTHS[w.getMonth()]} ${clock}` : clock, days }
}

// A reopened session (a resume): the roles the file calls running belong to a process that is gone. They are drawn stopped, their task
// no longer running, and counted. A task that carries `session` is a live task session's: left as it is.
export function stopped(s: Status) {
  let count = 0
  const tasks = s.tasks.map((t): Task => {
    if (t.session || !t.roles.some(r => r.status === 'running')) return t
    const roles = t.roles.map((r): Role => (r.status === 'running' ? (count++, { ...r, status: 'idle', state: ['durmuş olabilir', r.state].filter(Boolean).join(' · ') }) : r))
    return { ...t, roles, ...(t.state === 'running' && { state: 'waiting' as const, reason: t.wait }) }
  })
  return { data: { ...s, tasks }, count }
}

// The press that asks the Lead where things stand, and the fixed prefix of the one context line a reopened session's first prompt carries.
export const ASK_WHERE = 'Nerede kaldık?'
export const REOPEN = '[Agent Team · yeniden açılış]'

export function reopenLine(s: Status | null, now: number) {
  // A file the pane could not read (missing, bad): no time, no roles, only the step.
  if (!s) return `${REOPEN} Oturum yeniden açıldı; durum dosyası okunamadı. agent-team skill'inin "Geri dönüş" adımını çalıştır.`
  const names = s.tasks.filter(t => !t.session).flatMap(t => t.roles.filter(r => r.status === 'running').map(r => `${t.title} · ${r.name}`))
  const when = stamp(s.updatedAt, now).text
  return [
    `${REOPEN} Oturum yeniden açıldı; durum dosyasının son yazımı ${when ?? 'bilinmiyor'}.`,
    names.length ? `Çalışıyor görünen roller (eski sürecin işiydi, durmuştur): ${names.slice(0, 10).join('; ')}.` : 'Çalışıyor görünen rol yok.',
    `agent-team skill'inin "Geri dönüş" adımını çalıştır.`,
  ].join(' ')
}

export function summary(s: Status | null): string {
  if (!s) return 'durum dosyası henüz yok'
  if (s.paused) return 'duraklatıldı'
  const parts: string[] = []
  if (s.decisions.length) parts.push(`${s.decisions.length} karar bekliyor`)
  const running = s.tasks.filter(t => t.state === 'running').flatMap(t => t.roles.filter(r => r.status === 'running').map(r => `${r.name.split(' · ')[0]} ${r.state}`))
  if (running[0]) parts.push(running[0])
  parts.push(`${s.tasks.length} görev`)
  return parts.join(' · ')
}

export const countStates = (tasks: readonly Task[]) => ({
  running: tasks.filter(t => t.state === 'running').length,
  blocked: tasks.filter(t => t.state === 'blocked').length,
  waiting: tasks.filter(t => t.state === 'waiting').length,
  done: tasks.filter(t => t.state === 'done').length,
})

// What just finished: the tasks with a written id that `prev` (the status as drawn before a read) has as not done and `next` (as drawn after it) has as done,
// each with the state it left (`from`). No `prev` (a first read, a /clear, a resume) gives none: a finished task that was already there never plays.
export const finishes = (prev: Status | null, next: Status | null): Pick<Fresh, 'id' | 'from'>[] => {
  const was = new Map(prev?.tasks.filter(t => !t.generatedId).map(t => [t.id, t.state]))
  return (next?.tasks ?? []).flatMap(t => {
    const from = was.get(t.id)
    return !t.generatedId && t.state === 'done' && from && from !== 'done' ? [{ id: t.id, from }] : []
  })
}

// A finished task stays in the section it left for this long (a poll ends it: no timer of its own).
export const FRESH_MS = 5000

// The tasks by section: Çalışan, Bekleyen (blocked first, then file order) and Biten. A done task with a live `fresh` entry (0 <= now - at < FRESH_MS; a clock that
// is not a number or went back makes none live) goes where it came from, among the tasks of that state; every other task goes by its state.
export function sections(tasks: readonly Task[], fresh: readonly Fresh[], now: number) {
  const place = tasks.map(t => ({ t, at: (t.state === 'done' && !t.generatedId && fresh.find(f => f.id === t.id && now - f.at >= 0 && now - f.at < FRESH_MS)?.from) || t.state }))
  const of = (...at: TaskState[]) => place.filter(p => at.includes(p.at)).map(p => p.t)
  return { running: of('running'), waiting: [...of('blocked'), ...of('waiting')], done: of('done') }
}

// The task a decision names (if it is in the file): its title joins the kind line, a blocked one draws the card in error.
export function decisionTask(d: Omit<Decision, 'push' | 'stuck'>, tasks: readonly Task[]) {
  const t = d.task ? tasks.find(x => x.id === d.task && !x.generatedId) : undefined
  return { kind: [d.kind, t?.title].filter(Boolean).join(' · ') || undefined, blocked: t?.state === 'blocked' }
}

// A decision answer is one line of the owner's draft, "Karar (<id>): <option>". The id and the option are model-written:
// a line break in them (also U+2028 and U+2029) would start another line, so it becomes a space.
export const KARAR = 'Karar ('
export const flat = (s: string) => s.replace(/\r\n|[\r\n\u2028\u2029]/g, ' ')
const head = (id: string) => `${KARAR}${flat(id)}): `
export const kararLine = (id: string, option: string) => head(id) + flat(option)

// The draft with the decision's line set: a line of that decision is replaced in place, else a new line is added at the end.
// Plain startsWith, never a regex: the id is data. Everything else stays as the owner typed it.
export function withKarar(draft: string, id: string, option: string) {
  const line = kararLine(id, option)
  const rows = draft.split('\n')
  // The replaced row keeps its own \r (a CRLF draft); the other rows are not touched.
  if (rows.some(r => r.startsWith(head(id)))) return rows.map(r => (r.startsWith(head(id)) ? line + (r.endsWith('\r') ? '\r' : '') : r)).join('\n')
  return draft && !draft.endsWith('\n') ? `${draft}\n${line}` : draft + line
}

// The decision lines of a draft (all the pane needs to know of it), and which option of `d` one of them picks (-1: none).
// A CRLF draft's rows end in \r: it is not part of the line.
export const kararLines = (draft: string) => draft.split('\n').filter(r => r.startsWith(KARAR)).map(r => r.replace(/\r$/, ''))
export const pickedAt = (lines: readonly string[], d: Omit<Decision, 'push' | 'stuck'>) => d.options.findIndex(o => lines.includes(kararLine(d.id, o)))

// The sentence that tells the Lead the status path (register.tsx leadText) and the prefix of the row that carries it.
export const ANNOUNCE = "Pane'in okuduğu durum dosyası:"
export const OPEN_ROW = '[Agent Team modu açıldı] '

const MODE_SOURCES: readonly string[] = ['folder', 'switch', 'off']

// The binding of a task session (trust addendum §1): a handle is a task id the Lead chose, a code is the one-time string of the start, written literally
// (a shell expansion such as $(uuidgen) is no code). The marker is the line the Lead puts first in the child's first prompt.
export const HANDLE = /^[a-z0-9][a-z0-9-]{0,23}$/
const CODE = /^[A-Za-z0-9-]{16,64}$/
export const MARKER = /\[Agent Team görev oturumu\] task=([a-z0-9][a-z0-9-]{0,23}) kod=([A-Za-z0-9-]{16,64})(?![A-Za-z0-9-])/
export const markerOf = (text: string) => {
  const m = MARKER.exec(text)
  return m ? { task: m[1]!, code: m[2]! } : undefined
}
export const KIDS_MAX = 16

const kidsIn = (x: unknown): Record<string, Kid> | undefined => {
  if (!isObj(x)) return undefined
  const ok = Object.entries(x).flatMap(([task, k]): [string, Kid][] =>
    HANDLE.test(task) && isObj(k) && typeof k.code === 'string' && CODE.test(k.code) && typeof k.at === 'number' && Number.isFinite(k.at) && (k.to === undefined || (typeof k.to === 'string' && k.to.length > 0 && k.to.length <= 128))
      ? [[task, { code: k.code, at: k.at, ...(typeof k.to === 'string' && { to: k.to }) }]]
      : [],
  )
  const kept = ok.sort((a, b) => b[1].at - a[1].at).slice(0, KIDS_MAX)
  return kept.length ? Object.fromEntries(kept) : undefined
}
const boundOf = (x: unknown): Bound | undefined =>
  isObj(x) && typeof x.task === 'string' && HANDLE.test(x.task) && typeof x.code === 'string' && CODE.test(x.code) && typeof x.token === 'string' && x.token.length > 0 && x.token.length <= 128
    ? { task: x.task, code: x.code, token: x.token }
    : undefined

// A store record is data on disk: it counts only if it is well formed and its file is directly in <statusDir>/ and ends in .json. Of `kids` and `bound` only
// well formed ones are kept (at most 16 kids, the newest).
export function parseRecord(raw: unknown, statusDir: string): SessionRecord | undefined {
  if (!isObj(raw) || typeof raw.file !== 'string' || typeof raw.at !== 'string' || !isObj(raw.mode)) return undefined
  const { file, at, mode, announced } = raw
  if (typeof mode.isOn !== 'boolean' || !MODE_SOURCES.includes(String(mode.source))) return undefined
  if (!file.endsWith('.json') || !file.startsWith(`${statusDir}/`) || file.slice(statusDir.length + 1).includes('/')) return undefined
  const kids = kidsIn(raw.kids)
  const bound = boundOf(raw.bound)
  return { file, mode: { isOn: mode.isOn, source: mode.source as Mode['source'] }, at, ...(typeof announced === 'string' && { announced }), ...(kids && { kids }), ...(bound && { bound }) }
}

// The store's session records as one list: `sid` is the id after `session:` (never empty).
export type Rec = { sid: string; r: SessionRecord }
const atOf = (r: SessionRecord) => Date.parse(r.at) || 0
const newest = (a: Rec, b: Rec) => atOf(b.r) - atOf(a.r) || a.sid.localeCompare(b.sid)

// One session = one status file: a /clear carries a session's record to its new id with its file, so its earlier ids keep records of the same file. Every
// reader that counts, compares or ranks records asks here: the other sessions than `sid`'s (no record of its file), each one group of its records, newest
// first; the groups in the order of their newest records.
export function othersOf(recs: readonly Rec[], sid: string): Rec[][] {
  const own = recs.find(x => x.sid === sid)?.r.file
  const by = new Map<string, Rec[]>()
  for (const x of [...recs].sort(newest)) if (x.sid !== sid && x.r.file !== own) by.set(x.r.file, [...(by.get(x.r.file) ?? []), x])
  return [...by.values()]
}

// A binding is valid while another session (othersOf) holds that code for that task in its `kids`; else it is void (treated as absent).
export const isValid = (recs: readonly Rec[], sid: string, b: Bound | undefined) => !!b && othersOf(recs, sid).some(g => g.some(x => x.r.kids?.[b.task]?.code === b.code))

// Trust addendum §1.4: for each `kids[h]` of this session's own record, the other sessions' records (othersOf) whose `bound` has that task and code. None: unbound; one
// file: bound (ids newest first, at most 3; the newest's token); two or more files: conflict. At most 8 bound: the tasks the own file writes now (`open`)
// first, then the newest kids[h].at. `open` is required: every caller ranks alike, so a card that is drawn is also the one pressed, unbound and guarded.
export function linksOf(recs: readonly Rec[], own: string, open: ReadonlySet<string>): Link[] {
  const kids = recs.find(x => x.sid === own)?.r.kids ?? {}
  const all = Object.entries(kids).flatMap(([task, k]): Link[] => {
    const by = k.to ? 'owner' : 'code'
    const held = othersOf(recs, own).map(g => g.filter(x => x.r.bound?.task === task && x.r.bound.code === k.code)).filter(g => g.length)
    const holders = held[0] ?? []
    if (!holders.length) return [{ task, state: 'unbound', ids: [], by, at: k.at }]
    if (held.length > 1) return [{ task, state: 'conflict', ids: [], by, at: k.at }]
    return [{ task, state: 'bound', file: baseName(holders[0]!.r.file), ids: holders.slice(0, 3).map(x => x.sid), token: holders[0]!.r.bound!.token, by, at: k.at }]
  })
  const rank = (l: Link) => (open.has(l.task) ? 0 : 1)
  const keep = new Set(all.filter(l => l.state === 'bound').sort((a, b) => rank(a) - rank(b) || b.at - a.at).slice(0, CHILDREN).map(l => l.task))
  return all.filter(l => l.state !== 'bound' || keep.has(l.task)).sort((a, b) => a.task.localeCompare(b.task))
}

// The records that started a bound task session (its report targets): other sessions' (othersOf), `kids[task].code` is its code; newest first, at most 3.
export const parentsOf = (recs: readonly Rec[], own: string, b: Bound) =>
  othersOf(recs, own).flatMap(g => g.filter(x => x.r.kids?.[b.task]?.code === b.code)).sort(newest).slice(0, 3).map(x => x.sid)

// "<project> · <id8>" of a record (the file's project part as otherSession names it, the id8 of the session id in the store key).
const projectOf = (file: string) => {
  const base = baseName(file).replace(/\.json$/, '')
  return base.match(/^(.+)--([^-]{8})$/)?.[1] ?? base
}

// The sessions the owner may bind to a task by hand (§1.9): each other session's newest record (othersOf), team mode on, with no `kids` and no valid `bound`; newest record first
// (ties by id); the first 9 and how many more. Only the store decides: no file's content, mtime or name decides who is listed or in what order.
export function candidatesOf(recs: readonly Rec[], own: string, now: number): { rows: Candidate[]; more: number } {
  const all = othersOf(recs, own).map(g => g[0]!).filter(x => x.r.mode.isOn && !x.r.kids && !isValid(recs, x.sid, x.r.bound))
  return { rows: all.slice(0, 9).map(x => ({ sid: x.sid, name: `${projectOf(x.r.file)} · ${x.sid.slice(0, 8)}`, ...(stamp(x.r.at, now).text && { when: stamp(x.r.at, now).text }) })), more: Math.max(0, all.length - 9) }
}

// Other team sessions' files in the status folder (the pane's read-only strip): a regular .json file that is not this
// session's own, written in the last 24 h (exactly 24 h old is out), at most 256 KiB; the newest 20 of them. Store records untouched for 30 days are swept.
export const KEEP_MS = 30 * 86_400_000
const OTHER_DAY_MS = 86_400_000
const OTHER_MAX_BYTES = 256 * 1024
const OTHER_MAX_FILES = 20

// A file the pane may read at all: regular, not a link, .json, at most 256 KiB.
export const readable = (e: DirEntry) => e.kind === 'file' && !e.isLink && e.name.endsWith('.json') && e.size <= OTHER_MAX_BYTES
export const otherFiles = (entries: readonly DirEntry[], dir: string, own: string, now: number) =>
  entries
    .filter(e => readable(e) && `${dir}/${e.name}` !== own && now - e.mtimeMs < OTHER_DAY_MS)
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name))
    .slice(0, OTHER_MAX_FILES)

// The file is untrusted and the result goes in a state atom (4 MiB limit) and on the pane: cut what is drawn.
const OTHER_KIND = 120
const OTHER_TEXT = 400
const OTHER_OPTION = 60
const OTHER_DECISIONS = 10
export const cut = (x: string, n: number) => (Array.from(x).length > n ? `${clip(x, n - 1)}…` : x)

// One other session from its parsed file, or undefined when it asks nothing. <project>--<id8>.json is "<project> · <id8>",
// <project>.json is "<project>"; the time is the file's updatedAt, else its mtime (local). `count` and `stuckCount` are of ALL
// the file's decisions, `decisions` keeps the first 10, cut.
export function otherSession(e: DirEntry, s: Status): Other | undefined {
  if (!s.decisions.length) return undefined
  const base = e.name.replace(/\.json$/, '')
  const m = base.match(/^(.+)--([^-]{8})$/)
  const project = m?.[1] ?? base
  const d = new Date(e.mtimeMs)
  const all = s.decisions.map(x => ({ x, ...decisionTask(x, s.tasks) }))
  return {
    file: e.name,
    project,
    name: m ? `${project} · ${m[2]}` : project,
    when: clockOf(s.updatedAt) ?? `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
    count: all.length,
    stuckCount: all.filter(a => a.blocked || a.x.stuck).length,
    decisions: all.slice(0, OTHER_DECISIONS).map(({ x, kind, blocked }) => ({
      kind: kind && cut(kind, OTHER_KIND),
      text: cut(x.text, OTHER_TEXT),
      options: x.options.map(o => cut(o, OTHER_OPTION)),
      stuck: blocked || x.stuck,
    })),
  }
}

// Task sessions (children): the one file of a bound task's session (linksOf), at most 8. Cut as an untrusted file is (F5): the first 12 roles (the rest
// counted), role names and states to 60, candidate to 64, reason and branch to 120; the card's state stays the parse's, of all roles.
const CHILDREN = 8
const ROLES = 12
export const STALE_MS = 1_800_000 // a guess from the skill's 20/40 minute watch, not a measured value
// The label of a child's option, as drawn and as sent (the child checks the same cut of its own option).
export const label = (o: string) => cut(flat(o), OTHER_OPTION)

export const childOf = (e: DirEntry, s: Status, task: string): Child => {
  const t = s.tasks.find(x => x.id === task) ?? s.tasks[0]
  const card = t && {
    ...t,
    roles: t.roles.slice(0, ROLES).map(r => ({ ...r, name: cut(r.name, 60), state: cut(r.state, 60) })),
    moreRoles: Math.max(0, t.roles.length - ROLES),
    candidate: t.candidate && clip(t.candidate, 64),
    reason: t.reason && cut(t.reason, 120),
    branch: t.branch && cut(t.branch, 120),
  }
  return {
    file: e.name,
    task,
    name: task,
    mtimeMs: e.mtimeMs,
    updatedAt: s.updatedAt,
    card,
    more: card ? s.tasks.length - 1 : 0,
    decisions: s.decisions.slice(0, OTHER_DECISIONS).map(d => ({ ...d, text: cut(d.text, OTHER_TEXT), kind: d.kind && cut(d.kind, OTHER_KIND), meta: d.meta && cut(d.meta, OTHER_KIND), options: d.options.map(label) })),
    count: s.decisions.length,
  }
}

// The children whose task is a written task of `own`, and `own` as the pane draws it: such a task keeps its id, title and wait, takes the child's stage,
// round, candidate, counts, roles, rounds, evidence, state and reason, and carries `session` (so a reopen never draws it stopped). The count and the order of the tasks never change.
export const kidsOf = (own: Status | null, kids: readonly Child[]) => kids.filter(c => own?.tasks.some(t => t.id === c.task && !t.generatedId))
export function joined(own: Status | null, kids: readonly Child[]): Status | null {
  const mine = kidsOf(own, kids)
  if (!own || !mine.length) return own
  return {
    ...own,
    tasks: own.tasks.map((t): Task => {
      const c = t.generatedId ? undefined : mine.find(k => k.task === t.id)
      const k = c?.card
      if (!c) return t
      // A child's own `done` counts as waiting, and the child's state wins, so a child never finishes a task and live work is never folded away. Only the parent's
      // own flag (`t.done`) finishes it, and only while the child asks nothing (`count` is compared with 0: anything else, also a missing count, keeps it waiting).
      const s = k && (k.state === 'done' ? 'waiting' : k.state)
      const fin = !!t.done && s === 'waiting' && c.count === 0
      return { ...t, ...(k && { stage: k.stage, round: k.round, candidate: k.candidate, blocking: k.blocking, followup: k.followup, roles: k.roles, moreRoles: k.moreRoles, rounds: k.rounds, evidence: k.evidence, state: fin ? ('done' as const) : s!, reason: fin ? t.wait : k.reason, branch: t.branch ?? k.branch }), ...(!k && t.state === 'done' && c.count !== 0 && { state: 'waiting' as const }), session: { name: c.name } }
    }),
  }
}

// "31 dk" under 60 minutes, "2 sa" under 48 hours, else "2 gün" (each floored).
export const ago = (ms: number) => (ms < 3_600_000 ? `${Math.floor(ms / 60_000)} dk` : ms < 172_800_000 ? `${Math.floor(ms / 3_600_000)} sa` : `${Math.floor(ms / 86_400_000)} gün`)

// Whether the owner may bind a session to this task by hand (§1.9): a written task that is unbound or in conflict (a `kids` entry nobody or two files present,
// or a row with `session` and no entry).
export const bindable = (t: Task, l: Link | undefined) => !t.generatedId && (l ? l.state !== 'bound' : !!t.session)

// The rows under a task's state row (Turkish, exact; trust addendum §1.4 table). `l`: its binding, if any; `c`: its child, if read; `failed`: a press on one of its
// decisions was not delivered. A running child silent for more than STALE_MS is marked; the task still counts as running (the pane cannot know more).
export function sessionLines(t: Task, l: Link | undefined, c: Child | undefined, o: { failed: boolean; now: number; term: boolean }): SessionLine[] {
  const { term } = o
  const mark = term ? '◇ ' : ''
  if (l?.state === 'conflict') return [{ text: `${term ? '✗ ' : ''}ayrı oturum · ${t.id} · iki oturum aynı kodu gösterdi`, color: 'error' }]
  if (l?.state !== 'bound') return bindable(t, l) ? [{ text: term ? `◇ ayrı oturum · ${t.session?.name ?? t.id} · bağlanmadı · ayrıntıda bağla` : `ayrı oturum · ${t.session?.name ?? t.id} · bağlanmadı` }] : []
  const id8 = l.ids[0]?.slice(0, 8) ?? ''
  if (!c) return [{ text: `${mark}ayrı oturum · ${t.id} · ${id8} · durum dosyası bekleniyor` }]
  const d = new Date(c.mtimeMs)
  const when = stamp(c.updatedAt, o.now).text ?? `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  const first: SessionLine[] = o.failed
    ? term
      ? [{ text: `✗ oturum açık değil · claude attach ${c.name}`, color: 'error' }]
      : [{ text: 'oturum açık değil · o oturumu aç', color: 'error' }]
    : c.card?.state === 'running' && o.now - c.mtimeMs > STALE_MS
      ? [{ text: `⚠ ${ago(o.now - c.mtimeMs)} önce yazdı · durmuş olabilir`, color: 'warning' }]
      : [{ text: term ? `◇ ayrı oturum · ${t.id} · ${id8} · ${when}` : `ayrı oturum · ${t.id} · ${id8} · son yazım ${when}` }]
  // A task its own row calls finished while its session keeps it live (it stays out of Biten: live work is never hidden).
  const marked = t.done && t.state !== 'done' ? [{ text: '✓ bitti işaretli · oturum sürüyor' }] : []
  return [...first, ...marked, ...(c.more > 0 ? [{ text: `+${c.more} görev o oturumda` }] : [])]
}

// The one caption row of a child's decision card (Turkish, exact): push, sent, failed, or the idle line; `f` is the answer's state, if any.
export function kidCaption(c: Child, d: Decision, f: Forward | undefined, term: boolean): SessionLine | undefined {
  if (pushOf(d)) return { text: 'Push onayı yalnız o oturumda verilir' }
  if (f?.state === 'sent') return { text: `Gönderildi: ${cut(f.option, 60)} · ${c.name} oturumuna`, color: 'success' }
  if (f?.state === 'failed') return { text: 'Gönderilemedi · oturum açık değil, cevabı o oturumda ver', color: 'error' }
  return d.options.length ? { text: term ? `1-9 ile seç · ${c.name} oturumuna hemen gider` : `Bir seçeneğe bas · ${c.name} oturumuna gider` } : undefined
}

// The first line of a main-pane press sent to a task session; a JSON line follows (token, decision id, 1-based option index, label). The child's plugin checks
// and consumes it, and delivers it as that session's own pane press; its model never reads this text.
export const PANE_HEAD = "[Agent Team pane · ana oturum] Sahip ana oturumun pane'inde bastı:"

// The report a child's plugin sends its parent at the end of a main-loop turn (terminal only): the first 400 code points of a final message that starts
// "GÖREV " (after white space and any of * # > `), or BLOCKED when the turn ended in an error; else nothing.
export const reportText = (answer: string, reason: string, task: string, file: string) =>
  reason === 'error'
    ? `GÖREV ${task}: BLOCKED · görev oturumunun turu hata ile bitti · durum ${file}`
    : /^[\s*#>`]*GÖREV /.test(answer) ? clip(answer, 400) : undefined

// Where the pane scrolls once a detail opens (its top) or closes (the card that was left, moved the least that shows it).
export const detailScroll = (pane: string, open: string | null, left?: string) =>
  open ? ({ in: pane, to: 'start' } as const) : ({ in: pane, to: { key: `t-${left}` }, block: 'nearest' } as const)

// The band above the prompt (terminal, pane not drawn): which segments fit `columns` cells (the band's `bodyColumns`), or null with nothing to say
// (a decision, a running or blocked task, a stale reopen; other sessions alone never count). The row is the segments joined by " · ", two spaces, "t: pane".
// Cut order when it does not fit: ◇ diğer, ◐ çalışıyor, ! yeniden açıldı; below the floor (◆ and ✗ and the button, 34 cells at two digits) ✗ stays before ◆.
// One cell per character (not measured: the glyphs' width outside tmux).
const BAND_BUTTON = 't: pane'.length
export function bandSegments(n: BandCounts, columns: number): BandSeg[] | null {
  if (!n.stale && !n.decisions && !n.running && !n.blocked) return null
  const all = [
    n.stale && { kind: 'stale', text: '! yeniden açıldı' },
    n.decisions > 0 && { kind: 'karar', text: `◆ ${n.decisions} karar` },
    n.running > 0 && { kind: 'running', text: `◐ ${n.running} çalışıyor` },
    n.blocked > 0 && { kind: 'blocked', text: `✗ ${n.blocked} takıldı` },
    n.others > 0 && { kind: 'others', text: `◇ ${n.others} diğer` },
  ].filter((x): x is BandSeg => !!x)
  const width = (s: readonly BandSeg[]) => s.reduce((w, x) => w + Array.from(x.text).length, 3 * Math.max(0, s.length - 1) + (s.length ? 2 : 0)) + BAND_BUTTON
  let segs = all
  for (const drop of ['others', 'running', 'stale'] as const) if (width(segs) > columns) segs = segs.filter(s => s.kind !== drop)
  if (width(segs) <= columns) return segs
  const keep = new Set<BandSeg['kind']>()
  for (const kind of ['blocked', 'karar'] as const) {
    const s = segs.find(x => x.kind === kind)
    if (s && width(segs.filter(x => keep.has(x.kind) || x === s)) <= columns) keep.add(kind)
  }
  return segs.filter(s => keep.has(s.kind))
}

// The roles drawn running, in file order (tasks, then roles in a task), and the word the engine's spinner line shows for them:
// "<short name> · <state>" of the first, " +n" for the others, cut to 40 cells ("QA · GPT-6 Astra", "inceliyor" -> "QA · inceliyor").
export const runningRoles = (s: Status | null | undefined) => s?.tasks.flatMap(t => t.roles.filter(r => r.status === 'running')) ?? []
export function spinnerWord(s: Status | null | undefined): string | undefined {
  const [first, ...rest] = runningRoles(s)
  if (!first) return undefined
  return clip([[first.name.split(' · ')[0], first.state].filter(Boolean).join(' · '), rest.length && ` +${rest.length}`].filter(Boolean).join(''), 40)
}

// ---- Evidence files (the reader). The status file is model-written, so a path in it is untrusted data: every rule below fails closed. ----
// The most a file may be, what a detail row reads of it (4 KiB), what the reader reads (80 KiB), and the most characters of one body in the tree (the engine draws
// 100 000 characters in all, and the reader's buttons come after the body).
export const EV_MAX = 1_048_576
export const EV_HEAD = 4096
export const EV_BODY = 81_920
export const EV_CHARS = 96_000
const ZW = '\u200b'
// Characters that draw as nothing or reorder text (bidi marks and overrides, zero width, BOM, tag characters): never drawn. U+200D stays (emoji joiner).
const INVISIBLE = /[\u061c\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0000}-\u{e007f}]/gu
// With the u flag this matches a lone surrogate only (a pair is one code point).
const LONE = /[\ud800-\udfff]/gu
// ESC, NUL, BEL, DEL and the C1 controls make the engine refuse the whole pane tree (measured), so each is made visible; tab and line feed pass.
const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g
const BAD_PATH = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u061c\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0000}-\u{e007f}\ud800-\udfff]/u

// Text read from a file, made safe to draw: line breaks to \n, controls to U+FFFD, invisible characters out, lone surrogates to U+FFFD.
export const clean = (s: string) =>
  s.replace(/\r\n|[\r\u2028\u2029]/g, '\n').replace(CTRL, '�').replace(INVISIBLE, '').replace(LONE, '�')

// A label, path or title as one drawn line.
export const one = (s: string) => flat(s).replace(/\t/g, ' ').replace(INVISIBLE, '').replace(LONE, '�')

// An absolute path of clean segments: no empty, `.` or `..` segment, no backslash, no control or invisible character.
export const okPath = (p: string) => p.startsWith('/') && !p.includes('\\') && !BAD_PATH.test(p) && p.slice(1).split('/').every(s => s !== '' && s !== '.' && s !== '..')

// The home as the evidence rules read it ('' when it is not absolute), and the evidence root: the option, `~` expanded, '' when it needs a home there is none of.
export const evHomeOf = (home: string) => (home.startsWith('/') ? trimSlash(home) : '')
export const evRootOf = (option: string, home: string) => (option.startsWith('~') && home === '' ? '' : trimSlash(expandHome(option, home)))

export const REFUSED = {
  root: 'kanıt kökü okunamadı',
  bad: 'geçersiz yol: gösterilmiyor',
  outside: 'kanıt kökünün dışında: gösterilmiyor',
  link: 'sembolik bağ ya da farklı yazım: gösterilmiyor',
  notFile: 'dosya değil: gösterilmiyor',
  missing: 'dosya bulunamadı',
  unread: 'okunamadı',
  changed: 'okunurken değişti: gösterilmiyor',
  notText: 'metin değil: gösterilmiyor',
} as const

// R0-R2, from spellings alone (no fs call, so a path outside the root is never even stat'ed): the path to look at, or the line that says why not.
export function evCheck(root: string, home: string, path: string): { p: string } | { line: string } {
  if (!okPath(root) || root === '/') return { line: REFUSED.root }
  if (path.startsWith('~') && home === '') return { line: REFUSED.bad }
  const p = trimSlash(expandHome(path, home))
  if (!okPath(p)) return { line: REFUSED.bad }
  return p.startsWith(`${root}/`) ? { p } : { line: REFUSED.outside }
}

// "3,8 KB": base 1024, one decimal, a Turkish comma; a KB value that would print 1024,0 prints 1,0 MB.
export const fmtSize = (n: number) => {
  const kb = (n / 1024).toFixed(1)
  const text = n < 1024 ? `${n} B` : kb === '1024.0' || n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${kb} KB`
  return text.replace('.', ',')
}

export const isMdPath = (p: string) => /\.(?:md|markdown)$/i.test(p.split('/').pop() ?? '')
export const evExt = (p: string) => {
  const seg = p.split('/').pop() ?? ''
  const i = seg.lastIndexOf('.')
  const ext = i > 0 ? seg.slice(i + 1).toLowerCase() : ''
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'dosya'
}

// What a desktop Markdown element may be given: after clean(), nothing that can become a link, an image, HTML or a character reference (each mark gets a
// zero width space after it), cut to EV_CHARS (never inside a surrogate pair).
export const mdRaw = (text: string) =>
  text
    .replace(/&(?=[#A-Za-z])/g, `&${ZW}`)
    .replace(/<(?=[A-Za-z0-9/!?])/g, `<${ZW}`)
    .replace(/!\[/g, `!${ZW}[`)
    .replace(/\]\(/g, `]${ZW}(`)
    .replace(/\]:/g, `]${ZW}:`)
    .replace(/:\//g, `:${ZW}/`)
    .replace(/www\./gi, m => `${m.slice(0, 3)}${ZW}.`)
export const mdCut = (s: string) => (s.length <= EV_CHARS ? s : s.slice(0, /[\ud800-\udbff]/.test(s[EV_CHARS - 1]!) ? EV_CHARS - 1 : EV_CHARS))
export const md = (text: string) => mdCut(mdRaw(text))

// The first lines of a file for a detail row. `text` is clean(); `partial`: it is the start of a longer file, so its last line may be cut (the text after the last
// line break goes; with no break it stays). Markdown: marks stripped, a report's `VERDICT: GO` / `GÖREV x: NO-GO` among the first 8 lines becomes a chip.
const HEX = /\b[0-9a-fA-F]{12,64}\b/g
const strip = (l: string) =>
  cut(
    l.trim().replace(/^(?:>\s*)+/, '').replace(/^#{1,6}\s+/, '').replace(/^(?:[-*+]|\d+[.)])\s+/, '').replace(/^\[[ xX]\]\s+/, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__|~~|`/g, '').trim(),
    200,
  )
const skipped = (l: string) => {
  const t = l.trim()
  return !t || /^(?:```|~~~|<!--)/.test(t) || /^([-*_])(?:\s*\1){2,}$/.test(t) || (/^[|:\s-]+$/.test(t) && t.includes('-')) || !strip(l)
}
const VERDICT = /^(?:VERDICT:|GÖREV\s+[^:]{1,80}:)\s*(NO-GO|GO)(?![\w|-])/
export function evPreview(text: string, isMd: boolean, partial: boolean): Preview {
  const at = partial ? text.lastIndexOf('\n') : -1
  const lines = (at >= 0 ? text.slice(0, at) : text).split('\n')
  if (!isMd) {
    const [l1, l2] = lines.map(l => l.trim()).filter(Boolean).map(l => cut(l, 200))
    return { ...(l1 && { l1 }), ...(l2 && { l2 }) }
  }
  const hit = lines.slice(0, 8).findIndex(l => VERDICT.test(strip(l)))
  const kept = lines.flatMap((l, i) => (i === hit || skipped(l) ? [] : [strip(l)]))
  if (hit < 0) {
    const [l1, l2] = kept
    return { ...(l1 && { l1 }), ...(l2 && { l2 }) }
  }
  const s = strip(lines[hit]!)
  const m = VERDICT.exec(s)!
  const chip = m[1] as 'GO' | 'NO-GO'
  const summary = cut(s.slice(m[0].length).replace(/^[\s·:—.(-]+/, '').replace(HEX, m => clip(m, 7)), 200)
  return { chip, ...(summary && { summary }), ...(kept[0] && { l2: kept[0] }) }
}

// An evidence file read for the pane: R3-R9, in order, the first that fails decides. `fs` is $.fs; `root` the evidence root as written, `rootReal` where it lands, `p`
// the path (evCheck passed), `len` how much to read (EV_HEAD for a row, EV_BODY for the reader). Never a whole read, never a read of anything the stat did not call
// a regular file inside the root with no link on the way; the second stat must equal the first (the API has no file handle), twice running or nothing is kept.
export type EvFs = {
  stat(p: string, o: { resolve: true }): Promise<EvStat>
  read(p: string, o: { offset: number; length: number }): Promise<unknown>
}
export const sameStat = (a: EvStat | null, b: EvStat | null) =>
  a === b || (!!a && !!b && a.kind === b.kind && a.isLink === b.isLink && a.realPath === b.realPath && a.size === b.size && a.mtimeMs === b.mtimeMs)
const refusal = (s: EvStat, root: string, rootReal: string, p: string) =>
  s.kind !== 'file'
    ? REFUSED.notFile
    : s.isLink !== false || typeof s.realPath !== 'string' || s.realPath.normalize('NFC') !== (rootReal + p.slice(root.length)).normalize('NFC')
      ? REFUSED.link
      : !Number.isFinite(s.size) || s.size < 0
        ? REFUSED.notFile
        : s.size > EV_MAX
          ? `çok büyük (${fmtSize(s.size)}): gösterilmiyor`
          : undefined

export async function evLoad(fs: EvFs, root: string, rootReal: string, p: string, len: number): Promise<EvRec> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let s: EvStat
    try {
      s = await fs.stat(p, { resolve: true })
    } catch {
      return { stat: null, state: 'refused', line: REFUSED.missing }
    }
    const line = refusal(s, root, rootReal, p)
    if (line) return { stat: s, state: 'refused', line }
    if (s.size === 0) return { stat: s, state: 'empty', size: 0, mtimeMs: s.mtimeMs }
    let raw: string
    try {
      const got = await fs.read(p, { offset: 0, length: len })
      raw = typeof got === 'string' ? got : ''
    } catch {
      return { stat: s, state: 'refused', line: REFUSED.unread }
    }
    const again = await fs.stat(p, { resolve: true }).catch(() => null)
    if (!sameStat(s, again)) continue
    // A cut character at the end of a range is U+FFFD (types:3863): that one goes.
    if (s.size > len && raw.endsWith('�')) raw = raw.slice(0, -1)
    if (raw.includes('\u0000') || (raw.match(/�/g)?.length ?? 0) * 10 > raw.length * 3) return { stat: s, state: 'refused', line: REFUSED.notText }
    const text = clean(raw)
    const isMd = isMdPath(p)
    // A reader read holds more than a row's read: the preview is made from its first EV_HEAD characters.
    const lead = text.length > EV_HEAD ? text.slice(0, EV_HEAD) : text
    const preview = evPreview(lead, isMd, lead !== text || s.size > len)
    return { stat: s, state: 'ok', size: s.size, mtimeMs: s.mtimeMs, preview, ...(len > EV_HEAD && { body: text, more: s.size > len }) }
  }
  return { state: 'refused', line: REFUSED.changed }
}

// The distinct paths of a task's evidence, first appearance first: a path is one reader target and one cache entry, however many rows name it.
export const evPaths = (t: Task) => [...new Set((t.evidence ?? []).map(e => e.path))]

// Where the pane goes with the reader: its top (no `back`), or back to the row `ev-<back>` (moved the least that shows it); a negative `back`: nowhere.
export const readerScroll = (pane: string, back?: number) =>
  back === undefined ? ({ in: pane, to: 'start' } as const) : back >= 0 ? ({ in: pane, to: { key: `ev-${back}` }, block: 'nearest' } as const) : undefined

// ---- The terminal reader's rows ----
// Wrap width: the pane's columns less the box and padding, never under 12 (so every wrapping pass ends); 48 when the columns are not a number.
export const evWidth = (columns: number) => Math.max(12, (Number.isFinite(columns) ? Math.floor(columns) : 48) - 4)

// One source line cut into rows of at most W code points: at the last space within reach (that space goes), else hard at W; a continuation row starts with `hang`.
export function wrapLine(line: string, W: number, hang = ''): string[] {
  let rest = Array.from(line)
  const rows: string[] = []
  for (let prefix = ''; ; prefix = hang) {
    const room = W - prefix.length
    if (rest.length <= room) return [...rows, prefix + rest.join('')]
    const i = rest.lastIndexOf(' ', room)
    rows.push(prefix + rest.slice(0, i < 1 ? room : i).join(''))
    rest = rest.slice(i < 1 ? room : i + 1)
  }
}

// A Markdown file's lines as the terminal draws them (owner Q3: light clean-up): the first block rule that matches wins (fence, rule, table separator, heading,
// quote, bullet), then the inline marks go. A code line is kept as written. Presentation only: no safety rule depends on it.
export type TLine = { t: string; bold?: true; hang?: string }
const inline = (s: string) => s.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, '$1 ($2)').replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1 ($2)').replace(/\*\*|__|~~|`/g, '')
export function termText(lines: readonly string[], W: number): TLine[] {
  let code = false
  return lines.flatMap((line): TLine[] => {
    if (/^\s*(?:```|~~~)/.test(line)) return ((code = !code), [])
    if (code) return [{ t: line }]
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) return [{ t: '─'.repeat(W) }]
    if (/^[|:\s-]+$/.test(line) && line.includes('|') && line.includes('-')) return []
    const h = /^ {0,3}#{1,6}\s+(.*)$/.exec(line)
    if (h) return [{ t: inline(h[1]!.replace(/\s+#+\s*$/, '')), bold: true }]
    const q = /^(?: {0,3}> ?)+/.exec(line)
    if (q) return [{ t: '│ '.repeat(q[0].split('>').length - 1) + inline(line.slice(q[0].length)) }]
    const b = /^( *)([-*+])\s+(.*)$/.exec(line)
    if (!b) return [{ t: inline(line) }]
    const pad = ' '.repeat(Math.min(b[1]!.length, Math.floor(W / 2) - 2))
    return [{ t: `${pad}${b[1]!.length < 2 ? '•' : '◦'} ${inline(b[3]!)}`, hang: `${pad}  ` }]
  })
}

// The source lines of a text (a final empty one is no line), and the rows the terminal draws for it: tabs are two spaces, an empty line is one space row.
export const evLines = (text: string) => {
  const src = text.split('\n')
  if (src.at(-1) === '') src.pop()
  return src
}
export const evRows = (text: string, isMd: boolean, W: number) => {
  const src = evLines(text).map(l => l.replace(/\t/g, '  '))
  return (isMd ? termText(src, W) : src.map((t): TLine => ({ t }))).flatMap(l => wrapLine(l.t, W, l.hang).map(t => ({ t: t || ' ', ...(l.bold && { bold: true as const }) })))
}

// "md · 3,8 KB · 4 satır · 12 dk önce": the extension always; the size and age only of a file that passed the size rule (ok or empty: a refused file's stat may be a link's
// target's); the line count only with a body (`reader`: `N+` when the file is longer than the text read); the age only with a clock reading `now`.
export function evMeta(r: Pick<EvRow, 'ext' | 'state' | 'size' | 'mtimeMs' | 'body' | 'more'>, o: { reader?: boolean; now?: number } = {}) {
  const sized = r.state === 'ok' || r.state === 'empty'
  const n = r.state === 'empty' ? 0 : r.body !== undefined ? evLines(r.body).length : undefined
  const ms = o.now !== undefined && r.mtimeMs !== undefined ? o.now - r.mtimeMs : Number.NaN
  return [r.ext, sized && r.size !== undefined && fmtSize(r.size), !!o.reader && n !== undefined && `${n}${r.more ? '+' : ''} satır`, sized && ms >= 0 && Number.isFinite(ms) && `${ago(ms)} önce`]
    .filter(Boolean)
    .join(' · ')
}
