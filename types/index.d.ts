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
  // A joined task session's roles past the 12 drawn.
  moreRoles?: number
}

export type Decision = {
  id: string
  kind?: string
  text: string
  meta?: string
  task?: string
  options: string[]
  // Classified once, at parse time, from the whole kind (never from a cut or drawn copy): an approval of an irreversible action (a push: no button, never
  // carried to another session) and a "stuck" report. Every consumer reads these.
  push: boolean
  stuck: boolean
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
// A parent's `kids`: per task handle, the one-time code it started that task's session with (`at`: when, ms), and `to` when the owner bound a session by
// hand. A task session's `bound`: the task, the code it presented and the token the parent's presses must carry.
export type Kid = { code: string; at: number; to?: string }
export type Bound = { task: string; code: string; token: string }
export type SessionRecord = { file: string; mode: Mode; at: string; announced?: string; kids?: Record<string, Kid>; bound?: Bound }

// A task of this session's `kids` as the store resolves it: bound (one file presents the code: its session ids, newest first, at most 3, and the token of the
// newest), unbound (none) or conflict (two or more files). `by`: the start code, or the owner's hand.
export type Link = { task: string; state: 'bound' | 'unbound' | 'conflict'; file?: string; ids: string[]; token?: string; by: 'code' | 'owner'; at: number }

// The bind view of a task ("Bağla"): the store records the owner may bind (`rows`, the newest 9; `more` the rest) and a failed bind's line.
export type Candidate = { sid: string; name: string; when?: string }
export type BindView = { task: string; rows: Candidate[]; more: number; error?: string }

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

// A task session (a child) linked to one of this session's tasks, from its own status file: `card` is its task of that id (else its first), `more` its
// other tasks, `decisions` its first 10 (cut), `count` all of them.
export type Child = { file: string; task: string; name: string; mtimeMs: number; updatedAt?: string; card?: Task; more: number; decisions: Decision[]; count: number }

// A main-pane press on a child's decision: delivered (`sent`) or not (`failed`, until the child's file changes: `mtimeMs` is its mtime then).
// `i`: the 1-based index of the option, `option` its label as drawn; `at`: when it was pressed (a `sent` answer goes 24 h later at the latest).
export type Forward = { file: string; id: string; i: number; option: string; state: 'sent' | 'failed'; mtimeMs: number; at: number }

// One row under a joined task's state row, or a child decision card's caption; no `color` is dim.
export type SessionLine = { text: string; color?: 'warning' | 'error' | 'success' }

// A pane press on its way to the Lead: its line, the decision it answers (id, option) and whether it is an approval of an irreversible action.
export type Press = { line: string; id?: string; option?: string; push?: boolean }

// `queue`: presses not yet delivered, in press order; `sent`: [decision id, option] of decisions whose line was delivered;
// `said`: lines with no decision (Pause, Devam) submitted as the owner, until the status file is read again.
export type Outbox = { queue: Press[]; sent: [string, string][]; said: string[] }

// A resumed session: when it started (the pane warns while the status file is older; 0: not reopened) and whether its first prompt still owes
// the Lead the reopen line. An atom, so a hot reload keeps both and /clear resets them.
export type Reopen = { since: number; line: boolean }

// The band above the prompt (terminal, pane not drawn): what it counts, and the segments it draws, in order (`kind` picks the color).
export type BandCounts = { stale: boolean; decisions: number; running: number; blocked: number; others: number }
export type BandSeg = { kind: 'stale' | 'karar' | 'running' | 'blocked' | 'others'; text: string }

// One entry of $.fs.list.
export type DirEntry = { name: string; kind: string; size: number; mtimeMs: number; isLink: boolean }

declare module 'claude-code' {
  interface PluginState {
    'agent-team': {
      mode: Shaped<Mode>
      status: Shaped<StatusView>
      detail: Shaped<string | null>
      others: Shaped<Other[]>
      children: Shaped<Child[]>
      forwards: Shaped<Forward[]>
      links: Shaped<Link[]>
      bind: Shaped<BindView | null>
      othersOpen: Shaped<boolean>
      karar: Shaped<string[]>
      outbox: Shaped<Outbox>
      reopen: Shaped<Reopen>
      placed: Shaped<boolean>
      tick: Shaped<number>
    }
  }
}
