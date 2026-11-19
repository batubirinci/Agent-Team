import type { Decision, DirEntry, Evidence, Finding, Mode, Other, Role, Round, RoleStatus, SessionRecord, Status, Task, TaskState } from '../types'

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
const written = (x: unknown, taken: Set<string>) => {
  const id = str(x)
  return id && ID.test(id) && !taken.has(id) ? (taken.add(id), id) : undefined
}
const num = (x: unknown): number | undefined =>
  typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.round(x) : undefined
const list = (x: unknown): Obj[] => (Array.isArray(x) ? x.filter(isObj) : [])

// A kind as the two rules below read it: trimmed, lower case (Turkish rules), ı as i, and no U+0307 an İ lowered without Turkish rules, or in NFD, is i + U+0307).
const kindOf = (kind?: string) => (kind ?? '').trim().toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/\u0307/g, '')

// A decision kind that says the work is stuck ("Takıldı ...", any case, also "takildi"): one rule for the parser and the strip.
export const isStuck = (kind?: string) => kindOf(kind).startsWith('takildi')

// A decision whose kind says it approves an irreversible action ("Push onayı ...", any case, also "push onayi"): never carried by a tool result.
export const isPush = (kind?: string) => kindOf(kind).startsWith('push onayi')

// A finding that blocks, "BLOCKING" in any letter case: one rule for the parser's cap order and for both drawings.
export const isBlocking = (f: Finding) => f.severity?.toLowerCase() === 'blocking'

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
    return [{ id: written(d.id, decisionIds) ?? `#${i + 1}`, kind: str(d.kind), text: t, meta: str(d.meta), task: str(d.task), options }]
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
    const state: TaskState =
      blocked || asked.some(d => isStuck(d.kind)) ? 'blocked' : roles.some(r => r.status === 'running') ? 'running' : 'waiting'
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
  let w = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(iso!) ? new Date(iso!) : new Date(NaN)
  if (Number.isNaN(w.getTime())) w = new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!)
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
})

// The task a decision names (if it is in the file): its title joins the kind line, a blocked one draws the card in error.
export function decisionTask(d: Decision, tasks: readonly Task[]) {
  const t = d.task ? tasks.find(x => x.id === d.task && !x.generatedId) : undefined
  return { kind: [d.kind, t?.title].filter(Boolean).join(' · ') || undefined, blocked: t?.state === 'blocked' }
}

// A decision answer is one line of the owner's draft, "Karar (<id>): <option>". The id and the option are model-written:
// a line break in them would start another line, so it becomes a space.
export const KARAR = 'Karar ('
export const flat = (s: string) => s.replace(/\r\n|[\r\n]/g, ' ')
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
export const pickedAt = (lines: readonly string[], d: Decision) => d.options.findIndex(o => lines.includes(kararLine(d.id, o)))

// The sentence that tells the Lead the status path (register.tsx leadText) and the prefix of the row that carries it.
export const ANNOUNCE = "Pane'in okuduğu durum dosyası:"
export const OPEN_ROW = '[Agent Team modu açıldı] '

const MODE_SOURCES: readonly string[] = ['folder', 'switch', 'off']

// A store record is data on disk: it counts only if it is well formed and its file is directly in <statusDir>/ and ends in .json.
export function parseRecord(raw: unknown, statusDir: string): SessionRecord | undefined {
  if (!isObj(raw) || typeof raw.file !== 'string' || typeof raw.at !== 'string' || !isObj(raw.mode)) return undefined
  const { file, at, mode, announced } = raw
  if (typeof mode.isOn !== 'boolean' || !MODE_SOURCES.includes(String(mode.source))) return undefined
  if (!file.endsWith('.json') || !file.startsWith(`${statusDir}/`) || file.slice(statusDir.length + 1).includes('/')) return undefined
  return { file, mode: { isOn: mode.isOn, source: mode.source as Mode['source'] }, at, ...(typeof announced === 'string' && { announced }) }
}

// Other team sessions' files in the status folder (the pane's read-only strip): a regular .json file that is not this
// session's own, written in the last 24 h (exactly 24 h old is out), at most 256 KiB; the newest 20 of them.
const OTHER_DAY_MS = 86_400_000
const OTHER_MAX_BYTES = 256 * 1024
const OTHER_MAX_FILES = 20

export const otherFiles = (entries: readonly DirEntry[], dir: string, own: string, now: number) =>
  entries
    .filter(e => e.kind === 'file' && !e.isLink && e.name.endsWith('.json') && `${dir}/${e.name}` !== own && now - e.mtimeMs < OTHER_DAY_MS && e.size <= OTHER_MAX_BYTES)
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name))
    .slice(0, OTHER_MAX_FILES)

// The file is untrusted and the result goes in a state atom (4 MiB limit) and on the pane: cut what is drawn.
const OTHER_KIND = 120
const OTHER_TEXT = 400
const OTHER_OPTION = 60
const OTHER_DECISIONS = 10
const cut = (x: string, n: number) => (Array.from(x).length > n ? `${clip(x, n - 1)}…` : x)

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
    stuckCount: all.filter(a => a.blocked || isStuck(a.x.kind)).length,
    decisions: all.slice(0, OTHER_DECISIONS).map(({ x, kind, blocked }) => ({
      kind: kind && cut(kind, OTHER_KIND),
      text: cut(x.text, OTHER_TEXT),
      options: x.options.map(o => cut(o, OTHER_OPTION)),
      stuck: blocked || isStuck(x.kind),
    })),
  }
}

// Where the pane scrolls once a detail opens (its top) or closes (the card that was left, moved the least that shows it).
export const detailScroll = (pane: string, open: string | null, left?: string) =>
  open ? ({ in: pane, to: 'start' } as const) : ({ in: pane, to: { key: `t-${left}` }, block: 'nearest' } as const)
