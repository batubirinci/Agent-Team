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
  // A live task session carries this: its roles are that session's, so a reopen never draws them as stopped.
  session?: { name: string }
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

// What a session keeps in $.store under `session:<id>` (kept across /clear, which changes the id, and across a resume):
// its status file, its team mode, when it was written (ISO time), and the path the Lead was last told (once per path).
export type SessionRecord = { file: string; mode: Mode; at: string; announced?: string }

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

// A pane press on its way to the Lead: its line, the decision it answers (id, option) and whether it is an approval of an irreversible action.
export type Press = { line: string; id?: string; option?: string; push?: boolean }

// `queue`: presses not yet delivered, in press order; `sent`: [decision id, option] of decisions whose line was delivered;
// `said`: lines with no decision (Pause, Devam) submitted as the owner, until the status file is read again.
export type Outbox = { queue: Press[]; sent: [string, string][]; said: string[] }

// A resumed session: when it started (the pane warns while the status file is older; 0: not reopened) and whether its first prompt still owes
// the Lead the reopen line. An atom, so a hot reload keeps both and /clear resets them.
export type Reopen = { since: number; line: boolean }

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
      karar: Shaped<string[]>
      outbox: Shaped<Outbox>
      reopen: Shaped<Reopen>
    }
  }
}
