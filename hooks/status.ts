import type { Decision, Role, RoleStatus, Status, Task } from '../types'

export const STAGES = ['spec', 'build', 'review', 'revise', 'report'] as const
export const STAGE_LABELS = ['Spec', 'Build', 'Review', 'Revise', 'Rapor'] as const
const ROLE_STATUSES: readonly RoleStatus[] = ['running', 'done', 'waiting', 'blocked', 'idle']

type Obj = Record<string, unknown>

const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x)
const str = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() ? x : undefined)
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
    return [{ id: str(d.id) ?? `d${i + 1}`, kind: str(d.kind), text: t, meta: str(d.meta), options }]
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
    return [{
      id: str(t.id) ?? `t${i + 1}`,
      title,
      branch: str(t.branch),
      stage: stage < 0 ? 0 : stage,
      round: num(t.round),
      candidate: str(t.candidate),
      blocking: num(t.blocking),
      followup: num(t.followup),
      roles,
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
