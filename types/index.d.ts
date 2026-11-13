export type Mode = { isOn: boolean; source: 'folder' | 'switch' | 'off' }

export type RoleStatus = 'running' | 'done' | 'waiting' | 'blocked' | 'idle'

export type Role = { name: string; state: string; status: RoleStatus }

export type Finding = { severity?: string; origin?: string; what: string; where?: string }

export type Round = { n: number; verdict: string; candidate?: string; note?: string; findings: Finding[] }

export type Evidence = { label: string; path: string }

// Derived by the parser, never read from the file: blocked > running > waiting.
export type TaskState = 'running' | 'blocked' | 'waiting'

export type Task = {
  id: string
  // The id was made up by the parser (none in the file): no decision links to it.
  generatedId?: true
  title: string
  branch?: string
  stage: number
  round?: number
  candidate?: string
  blocking?: number
  followup?: number
  wait?: string
  state: TaskState
  reason?: string
  roles: Role[]
  rounds?: Round[]
  evidence?: Evidence[]
}

export type Decision = {
  id: string
  kind?: string
  text: string
  meta?: string
  task?: string
  options: string[]
}

export type Status = {
  updatedAt?: string
  lead?: string
  paused: boolean
  limits?: { fiveHourPct?: number; weeklyPct?: number }
  decisions: Decision[]
  tasks: Task[]
}

export type StatusView = {
  file: string
  mtime: number
  data: Status | null
  error: string | null
}

// Another team session's pending decisions (read from its status file, shown read-only).
export type OtherDecision = { kind?: string; text: string; options: string[]; stuck: boolean }

// `count` and `stuckCount` count all the file's decisions; `decisions` keeps the first few, cut.
export type Other = { file: string; project: string; name: string; when: string; count: number; stuckCount: number; decisions: OtherDecision[] }

// One entry of $.fs.list.
export type DirEntry = { name: string; kind: string; size: number; mtimeMs: number; isLink: boolean }

declare module 'claude-code' {
  interface PluginState {
    'agent-team': {
      mode: Shaped<Mode>
      status: Shaped<StatusView>
      detail: Shaped<string | null>
      others: Shaped<Other[]>
      othersOpen: Shaped<boolean>
    }
  }
}
