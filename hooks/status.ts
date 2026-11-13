import type { Decision, Evidence, Role, Round, RoleStatus, Status, Task, TaskState } from '../types'

export const STAGES = ['spec', 'build', 'review', 'revise', 'report'] as const
export const STAGE_LABELS = ['Spec', 'Build', 'Review', 'Revise', 'Rapor'] as const
const ROLE_STATUSES: readonly RoleStatus[] = ['running', 'done', 'waiting', 'blocked', 'idle']

type Obj = Record<string, unknown>

const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x)
const str = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() ? x : undefined)
// A string cut to n characters: the file is model-written, a pane line is not a place for an essay.
const short = (x: unknown, n: number): string | undefined => str(x)?.trim().slice(0, n)
const num = (x: unknown): number | undefined =>
  typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.round(x) : undefined
const list = (x: unknown): Obj[] => (Array.isArray(x) ? x.filter(isObj) : [])

// The file is written by the Lead (a model): read it as untrusted data, keep what is well formed.
export function parseStatus(text: string): Status {
  const raw: unknown = JSON.parse(text)
  if (!isObj(raw) || raw.v !== 1) throw new Error('durum dosyası v:1 değil')

  const decisions: Decision[] = list(raw.decisions).flatMap((d, i) => {
    const t = str(d.text)
    if (!t) return []
    const options = Array.isArray(d.options) ? d.options.filter((o): o is string => !!str(o)).slice(0, 4) : []
    return [{ id: str(d.id) ?? `d${i + 1}`, kind: str(d.kind), text: t, meta: str(d.meta), task: str(d.task), options }]
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
      const findings = list(r.findings)
        .flatMap(f => {
          const what = short(f.what, 300)
          return what ? [{ severity: short(f.severity, 20), origin: short(f.origin, 20), what, where: short(f.where, 200) }] : []
        })
        .slice(0, 10)
      return [{ n: num(r.n) ?? j + 1, verdict, candidate: short(r.candidate, 64), note: short(r.note, 400), findings }]
    }).slice(-10)
    const evidence: Evidence[] = list(t.evidence)
      .flatMap(e => {
        const label = short(e.label, 60)
        const path = short(e.path, 300)
        return label && path ? [{ label, path }] : []
      })
      .slice(0, 6)
    const id = str(t.id) ?? `t${i + 1}`
    const wait = short(t.wait, 120)
    const asked = decisions.filter(d => d.task === id)
    const blocked = roles.find(r => r.status === 'blocked')
    const state: TaskState =
      blocked || asked.some(d => d.kind?.trim().toLocaleLowerCase('tr').startsWith('takıldı')) ? 'blocked' : roles.some(r => r.status === 'running') ? 'running' : 'waiting'
    const reason =
      state === 'blocked' ? (asked.length ? `senden ${asked.length} karar bekliyor` : blocked?.state || undefined) : wait
    return [{
      id,
      title,
      branch: str(t.branch),
      stage: stage < 0 ? 0 : stage,
      round: num(t.round),
      candidate: str(t.candidate),
      blocking: num(t.blocking),
      followup: num(t.followup),
      wait,
      state,
      reason,
      roles,
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

export function summary(s: Status | null): string {
  if (!s) return 'durum dosyası henüz yok'
  if (s.paused) return 'duraklatıldı'
  const parts: string[] = []
  if (s.decisions.length) parts.push(`${s.decisions.length} karar bekliyor`)
  const running = s.tasks.flatMap(t => t.roles.filter(r => r.status === 'running').map(r => `${r.name.split(' · ')[0]} ${r.state}`))
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
  const t = d.task ? tasks.find(x => x.id === d.task) : undefined
  return { kind: [d.kind, t?.title].filter(Boolean).join(' · ') || undefined, blocked: t?.state === 'blocked' }
}
