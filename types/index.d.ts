export type Mode = { isOn: boolean; source: 'folder' | 'switch' | 'off' }

export type RoleStatus = 'running' | 'done' | 'waiting' | 'blocked' | 'idle'

export type Role = { name: string; state: string; status: RoleStatus }

export type Finding = { severity?: string; origin?: string; what: string; where?: string }

export type Round = { n: number; verdict: string; candidate?: string; note?: string; findings: Finding[] }

export type Evidence = { label: string; path: string }

// Derived by the parser, never read from the file: blocked > running > done > waiting.
export type TaskState = 'running' | 'blocked' | 'done' | 'waiting'

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
  // The effective `done: true` of the task's own row: the boolean true with no open decision linked to it. Absent = not done (an older stored value has none).
  done?: true
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
// `i`: the 1-based index of the option, `option` its label as drawn; `at`: when it was pressed (a `sent` answer goes when a parse of its file no longer lists it with that label, or after 24 h while its file is not parsed with it).
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

// A task that has just finished in this session's own file (its state before, `from`, and when, ms): it stays in the section it left for 5 s.
export type Fresh = { id: string; at: number; from: Exclude<TaskState, 'done'> }

// One entry of $.fs.list.
export type DirEntry = { name: string; kind: string; size: number; mtimeMs: number; isLink: boolean }

// The evidence reader (design B): `task` and `path` say which file of which open detail is read (`path` null: the detail is drawn); `page` is the terminal's
// page; `enter` / `left.at` are the desktop clock readings the one-shot motion is a function of (null: static; 0 is a real clock value); `rev` counts the redraws a
// load asked for. Never a file's content: that lives in a module cache (the status file is untrusted data, a file it names is display only).
export type Reader = { task: string | null; path: string | null; page: number; enter: number | null; left: { path: string; at: number | null } | null; rev: number }

// What $.fs.stat answers with `{ resolve: true }`.
export type EvStat = { kind: string; size: number; mtimeMs: number; isLink: boolean; realPath?: string }

// A file's first lines for a detail row: a verdict chip with its summary and a second line, or two lines.
export type Preview = { chip?: 'GO' | 'NO-GO'; summary?: string; l1?: string; l2?: string }

// One evidence file as last loaded: `stat` is what the load saw (null: the stat rejected; absent: the file changed under the read, so the next step loads again).
export type EvRec = {
  stat?: EvStat | null
  state: 'ok' | 'empty' | 'refused'
  line?: string
  size?: number
  mtimeMs?: number
  preview?: Preview
  // The cleaned text of the first bytes of a read for the reader (absent: a preview read).
  body?: string
  // The file is longer than what was read.
  more?: boolean
}

// One evidence entry as a row draws it: what the cache holds for its path (`loading`: nothing yet), or the line a refusal by spelling gives.
export type EvRow = { label: string; ext: string; state: EvRec['state'] | 'loading'; line?: string; size?: number; mtimeMs?: number; preview?: Preview; body?: string; more?: boolean; rec?: EvRec }

// The terminal's evidence views take strings that are already cleaned (one(), clean()) and cut: they only lay them out. Nothing here is a file's raw text.
// One KANIT row of the terminal detail. `label`: the entry's label, cut to 20 code points. `pressable`: state ok (the row has a Button, hotkey = its 1-based index).
// `chip`: a report's verdict (GO success, NO-GO error). `text`: the verdict's summary (may be ''), else the file's first line, else a status line ('boş dosya',
// 'okunuyor…', a refusal line); `dim`: `text` is a status line (drawn dim).
export type TermEvRow = { label: string; pressable: boolean; chip?: 'GO' | 'NO-GO'; text: string; dim: boolean }

// The terminal reader screen. `label`, `path`: header rows 1 and 2 (cleaned). `meta`: header row 3 without the page part (`<ext> · <size> · <N> satır`, or `<ext>`
// alone for a refused file; the view appends ` · sayfa <x>/<y>`). `rows`: every row of the body, already wrapped to the width (a refusal line, `okunuyor…`, `boş dosya`
// or the cut notice are rows too; `bold`: a heading, `dim`: a status or notice row); the view draws 14 of them. `page`: the stored page (0-based; the view clamps it).
// `nav`: two or more distinct evidence paths (the k / o Buttons exist).
export type TermReaderView = { label: string; path: string; meta: string; rows: { t: string; bold?: boolean; dim?: boolean }[]; page: number; nav: boolean }

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
      fresh: Shaped<Fresh[]>
      doneOpen: Shaped<boolean>
      tab: Shaped<'running' | 'waiting' | 'done' | null>
      karar: Shaped<string[]>
      outbox: Shaped<Outbox>
      reopen: Shaped<Reopen>
      placed: Shaped<boolean>
      tick: Shaped<number>
      reader: Shaped<Reader>
    }
  }
}
