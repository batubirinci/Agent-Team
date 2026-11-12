---
name: agent-team
description: Use when the owner says "agent-team", "/agent-team", "takımla yap", or asks to run a task through the Lead/Analyst/Developer/QA team. The main chat is the Lead; it routes work to seven role agents (five Claude subagents — the Analyst on Fable 5.2 — and two GPT-6 Astra via Codex CLI) through a hub-and-spoke handoff table.
---

# agent-team

The main chat is the **Lead**. It never implements; it triages, briefs, routes, and reports. Every
handoff goes through the Lead: an agent ends its report with `HANDOFF: <role> — <one-line brief>`,
proposing the next role; the Lead decides and routes. No agent hands work to another directly.
Paths, commands, gates and domain rules come from the project instructions (CLAUDE.md), the
owner's decision record and the Lead's memory; the Lead carries the relevant ones into each brief.
Reference files next to this one: `references/gpt-roles.md` (read before any Codex run),
`references/design-split.md` (hard work: Analyst designs, Developer implements),
`references/pilot.md` (for the Flow-5 report), `references/status.md` (the status file the Agent
Team pane reads; read once per session before the first write), `decisions.md` (history; only when
a decision is questioned).

**Team mode.** In an Agent Team session (the agent-team plugin says so in the system prompt or in a
message when the owner turns the switch on) every owner message is a Lead request: no
`/agent-team` is needed, and this skill stays in force until the plugin says the mode is off. A
press in the pane reaches the Lead as an owner message: `Karar (<id>): <option>` answers that
decision (a push approval given this way is still the owner's approval for that exact action),
`Pause` runs Pause.

## Roster (dated 2026-11-10 — revisit when models change)

The split: **Fable thinks, Opus/Sonnet build.** Fable 5.2 researches, sets requirements and the
method; it does not write product code (developer sessions are the longest and most
output-heavy, and Fable costs 2× Opus per token).

| role | engine | how it runs |
|---|---|---|
| **Lead** | Opus 5.5 · medium | this chat; may raise effort temporarily with a stated reason (no cache reset on Opus 5.5 / Sonnet 5.5) |
| **Analyst** | Fable 5.2 · medium; high for hard work | `Agent` → `team-analyst` for broad/unclear or non-trivial work. `team-analyst-high` for geometry, numerical tolerance, coordinate, selection-semantics or new-product-rule work, every task routed to the Opus Developer (criteria **and** design contract), and the referee role |
| **Analyst 2** | GPT-6 Astra · high | Codex, `--sandbox read-only` — blind pair of `team-analyst-high` when geometry/numerical requirements are unclear; second, cross-model opinion when the Fable referee runs |
| **Developer (Sonnet)** | Sonnet 5.5 · high | `Agent` → `team-developer-sonnet` — default developer |
| **Developer (Opus)** | Opus 5.5 · medium | `Agent` → `team-developer` — hard work, implementing the Analyst's design contract |
| **QA** | GPT-6 Astra · high (full / risky) · medium (focused) | Codex, `--sandbox workspace-write`, own review worktree |
| **QA 2 (live check)** | Opus 5.5 · medium (round 1) · Sonnet 5.5 for re-checks | `Agent` → `team-qa2`, own review worktree — short live browser/UX/performance check when UI, interaction or speed changed; a targeted re-check of named scenarios on a later round may pass `model: "sonnet"` |
| **Helper** | Haiku 5.5 · medium | `Agent` → `team-helper` — mechanical chores, prepared measurement runs, review evidence packages; never a GO, a review or an owner-facing document (the Lead writes those) |

Model and effort of a Claude role come from its agent file's frontmatter; a brief cannot change
them. `model: fable` resolves to Fable 5.2 in the current Claude Code (checked 2026-11-10).
Installed from the agent-team plugin, each role's `subagent_type` carries the plugin's prefix:
`agent-team:team-analyst`, `agent-team:team-analyst-high`, `agent-team:team-developer-sonnet`,
`agent-team:team-developer`, `agent-team:team-qa2`, `agent-team:team-helper`. The short names in
this file mean those.

**Briefing Fable roles:** give goal, limits and "done when"; do not prescribe steps, do not add
"think less" lines or token budgets (they change how it works, not how much it thinks). Fable
follows carried-over cautions closely — copy only the lessons and "don't" rules that apply to this
task, never the whole memory.

## Owner rules

- Only the Lead talks to the owner, and only for consequential choices outside existing
  authorization. Low-impact, reversible details: assume and say so — except in areas where the
  owner has said "don't assume, ask": there ask, including when the Lead would reject a finding
  about behavior in that area.
- A new product-behavior decision always goes back to the Lead. It blocks GO when the candidate
  implements or depends on that behavior; otherwise it is recorded as a follow-up. In "don't
  assume" areas only the owner decides it.
- No push, PR or merge to a remote without the owner's approval for that exact action (a permission
  rule also enforces this). See "Landing and release".

## Choosing the Developer

- **Default: Developer (Sonnet)** — well-scoped code work with clear criteria: UI/interaction,
  small fixes, local review-finding fixes, test additions, rebases, a new measurement tool.
- **Developer (Opus)** when the change touches geometry, numerical tolerances, coordinate
  transforms or selection semantics (even a small fix), introduces a new product rule, or changes
  shared behavior, an architectural contract or a hard-to-reverse decision. It implements the
  design contract `team-analyst-high` wrote. Spanning several modules alone is not a reason: a
  mechanical multi-file change with clear criteria stays with Sonnet. A Sonnet Developer may also
  implement a design contract (`references/design-split.md`).
- Ambiguity is not a routing reason: settle unclear criteria first (Analyst).
- One code owner per task, on its own branch/worktree; the two Developers never patch the same
  change at the same time. The Lead manages integration between their branches.
- **Commands stay in the worktree:** git as `git -C <absolute worktree path> …`, never
  `cd <path> && git …` in one Bash command (Claude Code asks the owner for every `cd` + `git`
  compound, even in bypass mode; a hook denies it). Every other project command (package manager,
  scripts, seeds, servers) also runs with `-C <worktree>` or an absolute path — never in the
  owner's checkout or with its environment files/data. Every Claude role follows this.
- **Escalation Sonnet → Opus** when the same root cause survives a first fix, or two review rounds
  return NO-GO for correctness/acceptance (not style or new scope). The Sonnet Developer hands back
  an escalation package: criteria, minimal reproduction, failing test, approaches tried, current
  commit, open questions. If the method itself is in doubt, the package goes to
  `team-analyst-high` for a revised design contract before the Opus Developer. Escalation does not
  reset the round counter (Flow 4).
- **Measurement split:** the algorithm's owner (Analyst for the method, Developer for the code)
  designs the sample space, tolerances and pass criteria and ships the sweep as a runnable script
  that writes a short summary plus raw logs; the Helper runs it on a frozen commit; models read the
  summary. One evidence package is shared by every role: commit ID, command, seed, environment,
  exit code, failing sample, raw-log path.
- **Gate script / heavy-run lock:** if the project has a gate script or queue that writes the full
  log to a file and prints counts, failures and the exit code, and a lock for heavy runs (full
  test, lint, mutation, Codex, browser), every role uses them as the Lead's record says. If not,
  propose one to the owner as a separate task; until then roles send long gate output to a file
  and read the summary and failures.

## Concurrency

At most **4 tasks in parallel** (a task's reviewers and Helper runs are part of it, not extra
tasks); at most **2 live browser checks** at once; two tasks never touch the same files — the
second waits until the first lands. When one task finishes, start the next queued one. Over the
cap, the extra task is parked safely (Pause, below). The owner may change these numbers; the
Lead's record holds the current ones.

## Briefs

Every brief starts with three parts:
1. **Goal and why** — what the owner wants to see and why it matters.
2. **Limits** — non-goals, affected paths, paths and areas not to touch, "don't assume" areas,
   owner decisions that apply.
3. **Done when** — acceptance criteria and required checks.
Then: relevant lessons from the Lead's memory (selected, not all), known hazards, impact/caller
results from the project's dependency tooling when it has one (say whether it may be stale; paste
results for roles that cannot reach it, e.g. the GPT roles), the evidence folder for this task,
and the shared contract. Subagents do not see the Lead's memory or this skill. Every product or
format premise in a brief (number format, font, product rule) cites its primary source — owner
decision, drawing page/region, file:line — and the Lead checks it there before sending; an
unverified premise is marked so.

**Shared contract** (copy into every brief):
- Separate observations, inferences and unknowns; cite the source location (file:line,
  page/region). Measure quantitative claims or label them "not measured".
- Copy full base/candidate commit IDs from Git; never reconstruct them. A reviewer checks that
  its checkout's HEAD = the requested candidate and states both full IDs.
- Commands run only in your own worktree (`-C <worktree>`), never in the owner's checkout or with
  its environment files/data. Live checks use isolated copies of data and task-owned
  ports/processes; never touch shared services or the owner's data; prove cleanup at the end.
- For a finding the brief says was rejected: `DISSENT: <finding — remaining objection>` or
  `DISSENT: none` — do not re-raise it as a new finding.
- Keep the report short: decision, new findings, evidence, gaps; do not restate the brief or
  earlier reports. Long output goes to a file; give its path. Also write your final report to
  `<evidence folder>/<role>-report.md` (the chat can be lost). A report without findings is the
  verdict, SHAs, checks run, coverage limits and the handoff.

## Lead duties

- **Before the owner sees anything:** agent-reported commit IDs match Git; a figure is a verified
  capture of the real product with a clean scene, never invented detail, showing the complete
  final state and naming its source files, scenario and candidate SHA; an agent's reading of a
  customer drawing or document is verified against the source, or the uncertainty is stated. Ask
  concrete questions (a real example, 2–3 per round, one sentence per option on what the owner
  will see). Give a plain-language summary; commands and evidence go to the record.
- **Defect families:** track findings by family (the same wrong behavior through another channel,
  unit or path). When a family returns a second time, stop patching: decide a mechanism that
  closes the family (`team-analyst-high` as referee/designer when the method is in doubt) and
  brief that.
- **Status record:** keep a short status record current (state, SHAs, open items, first decision,
  next steps, last-update time) so "ne durumda?" is answered from it and a move to a fresh chat
  costs one note; update the project's task panel file too when it has one. Read agent reports and
  Codex `final.md` files, not raw logs. Mirror it in the pane's status file
  (`references/status.md`) at every change the owner would want to see: a task starts or changes
  stage, a role starts, finishes or blocks, a verdict lands, a decision opens or closes, Pause.
- **Evidence lives outside the scratchpad.** The session scratchpad can be deleted when the chat
  changes; worktrees may live there, but evidence, reports and gate logs go to the persistent
  evidence root named in the Lead's memory (`<evidence root>/<candidate SHA>/`), and every
  worktree is committed before the chat ends.
- **Limits — stop safely before them:** before starting new work, read the usage view (5-hour
  and weekly). 5-hour ≥ 95 % or weekly ≥ 97 %, or the Lead's context nearing ~600k (the owner's
  `/context` is authoritative; transcript growth is only an estimate) → start nothing new, run
  Pause, write a hand-off note and give the owner one paste-ready continuation prompt for a fresh
  chat. Agents cannot be resumed from a new chat; the prompt carries fresh briefs.
- **Long-run watch:** while a background run (Codex, Helper, subagent) is active, check its output
  at bounded intervals. After 20 min without progress (40 min for a Fable role at high — its turns
  are long and quiet), inspect it and tell the owner; silence alone does not prove a hang. A hung
  task-owned command is stopped with its child processes and the cleanup proven.

## Flow

1. **Spec** — the Analyst (Fable) researches and sets the criteria for every task except a
   trivially clear routine one, where the Lead writes concise criteria itself. Hard work
   (geometry, numerical, coordinate, selection semantics, new product rule, anything for the Opus
   Developer): `team-analyst-high` writes criteria **and** a design contract; when geometry/
   numerical requirements are unclear, Analyst 2 runs in parallel and blind on the same brief and
   the Lead merges both, noting disagreements. For interaction and product-rule work, the Analyst
   also lists the unresolved, consequential cases the owner's rules do not cover (e.g. skewed,
   overflowing, deliberately wide, split selections) — not every imaginable case — and the Lead
   asks the owner about them in one batch, with real current captures and a clearly labelled
   picture of each outcome. Each answered case becomes an acceptance criterion with at least one
   acceptance test in "Done when". The Lead fixes one agreed set of criteria before the Developer
   starts; a case discovered later still goes to the Lead.
2. **Build** — the Lead opens the Developer's worktree
   (`git worktree add -b <branch> <scratchpad>/dev-<task> <base>` + the project's dependency setup
   inside it, or the project's worktree script); the Developer runs no command in the owner's
   checkout. It implements with tests and hands off one **candidate SHA**; verify it with Git
   before routing. The Lead records the owner's checkout branch, HEAD and `git status` at start and
   compares all three after every round; an unexplained change is reported to the owner.
3. **Review** — disposable review worktrees at the candidate SHA (below). **Evidence package:**
   when the Developer's report carries gate results for this exact SHA with command, environment,
   exit code and a raw log on disk, from a clean worktree, use them; the Helper runs only the
   required gates (and prepared mutation/measurement scripts) that are missing, in a review
   worktree. All evidence (gate logs, QA reports, measurement output) is written to
   `<evidence root>/<candidate SHA>/`, never only inside a disposable worktree or the scratchpad.
   **Round 1:** QA does the full review; when UI, interaction or speed changed, QA 2 runs in
   parallel and blind a short live check of the changed screens/scenarios (full review only on a
   stated reason). Round-1 findings are withheld from the other QA and the Developer until both
   finish; the Lead consolidates them into one handoff. An incomplete review blocks. Exception: an
   active harm (data loss, a process damaging a shared environment) is acted on at once.
   Neither QA changes the candidate. Each verdict states `VERDICT: GO|NO-GO`, base and candidate
   SHA, and findings as `SEVERITY — origin — file:line — what — how measured`. **Origin** is
   `introduced` (absent on base, shown by comparison) or `pre-existing`. **Disposition** (set by
   the Lead): `blocking` = an introduced regression or an acceptance-criteria violation, backed by
   a reproduction or a concrete causal argument; a pre-existing defect blocks only when the criteria
   require fixing it; everything else is `follow-up` — recorded, briefed separately, never blocks.
   A finding only one QA raised is still a finding — adjudicate it with evidence, never outvote it;
   an open `DISSENT` likewise, with its reason recorded, before GO. When the evidence does not
   settle a disagreement, `team-analyst-high` referees (Analyst 2 as the cross-model second view).
4. **Revise** — blocking findings → Developer → new candidate SHA. Resume the same Developer for at
   most two revision rounds in a row, earlier fresh if its context is clearly large; otherwise
   start a fresh one with a revision package (criteria, candidate SHA, findings, failing tests or
   repro, files touched, approaches tried, open questions). Any change to the candidate
   invalidates earlier approvals.
   **From round 2 on, only QA reviews, focused** (`medium`, `high` if the change is risky), with
   the evidence package for the new SHA; it widens to full review when architecture, shared
   geometry or test infrastructure changed, and the required regression/mutation gates run on the
   final commit. **Closure by evidence:** QA closes code/test findings; QA 2 closes live-behavior
   and timing findings with a short targeted re-check on the new SHA; a mixed finding needs both.
   QA 2 also returns for a revision that changes UI/interaction, speed or a performance budget
   (short targeted check), or is large / outside round 1's scope (affected live scenarios; full
   review only on a stated risk).
   **GO** = QA GO for the final candidate SHA, every blocking finding closed by its owner above,
   any required QA 2 re-check passed on that SHA, no blocking finding open. A new, more extreme
   fixture of a known family blocks when it violates an existing criterion or contract; one that
   would need a new requirement is a follow-up for the Lead/owner. A round = one review cycle of
   all required reviewers on one candidate (one infrastructure rerun per round is recorded, not
   counted; a second is BLOCKED).
   **Rounds run until GO.** After the third round the Lead opens further rounds itself, without
   asking the owner (owner rule), and notes "extra round N" in the report. This never lifts the
   family rule: a family returning a second time gets a mechanism change, not another patch, and
   the owner gets a short status report then. A new product decision or an owner-only area still
   goes to the owner.
5. **Report** — what changed, candidate SHA, gates, every verdict, finding dispositions, open
   items, coverage limits, the pilot row (`references/pilot.md`). Update the status record.

Every invocation has a task handle, the expected engine and a complete role-appropriate report (a
Codex run also its unique output files, `references/gpt-roles.md`); one that returns without it
is BLOCKED.

**Pause** — when the owner says pause, or a limit above is reached: let the running step finish,
start nothing new; ask each agent with a dirty worktree to commit its state itself — never
WIP-commit an agent's worktree blindly (a mutation or probe may be in it; if you must, mark the
commit "unverified, may hold a mutant"); stop Codex runs or let them finish; stop task-owned
servers/processes and release held locks, and prove it; write a hand-off note (state, SHAs, open
items, first decision on resume, next steps) and commit the record. **Never archive or close
sessions on pause** — the owner resumes in the same chats; closing one needs the owner's explicit
yes for that session by name. Resume only on the owner's word.

## Landing and release

- **Local landing (no question):** when a task has GO per Flow 4 and no owner decision is open, the
  Lead runs the project's required pre-landing gates (as the owner's record says, e.g. one full
  gate run after GO), merges the candidate into the owner's local main (`--no-ff`), verifies the
  tree equals the candidate, runs the project's post-merge steps (e.g. rebuilding packages the dev
  server serves), and tells the owner.
- **Remote (push / PR / merge = deploy):** only with the owner's approval for that action AND a
  review record for the exact candidate SHA: GO per Flow 4, required gate results, finding
  dispositions. Missing verdict, timeout or unresolved NO-GO = BLOCKED — never implicitly approved.
  Approval does not replace review. Deployment effects of each branch come from the project
  instructions.

## Checks

- The gates the project instructions require, plus its guard/mutation rules. A mutant or negative
  probe counts as caught only when a test fails on the targeted wrong behavior (a crash or harness
  error does not count).
- Every new acceptance or behavior test names where its expected values come from — owner rule,
  screen/sketch, the Analyst's independent calculation — once per group of assertions sharing a
  source, in every mode. For risky geometry, QA checks the tests' expected values and sample
  coverage, not only that they pass.
- Gate results are reused for a new SHA only when tree, command, inputs and relevant environment
  are identical and the gate does not depend on commit metadata (e.g. after a fast-forward); record
  the old → new SHA mapping. This reuses gate evidence, never a reviewer's approval.
- UI / interaction changes need live browser verification of the affected interactions; QA 2 owns
  it (if it cannot → BLOCKED); the Developer only smoke-tests. GPT QA writes
  `UI live: out of scope (QA 2)`; its GO then means "no code/test defect found".
- For every required check, record command, scenario and observed result, and what it does not
  cover.

## Review worktrees (disposable)

For each QA: `git worktree add --detach <scratchpad>/review-<qa>-<sha> <candidate SHA>`, then the
project's dependency setup inside that worktree only (offline/frozen where available). The
owner's and the Developer's checkouts stay outside GPT QA's writable sandbox
(`-C <its review worktree>`). Before testing, verify the project's own packages resolve into that
worktree. After the review verify all tracked files, manifests and lockfile included, match the
candidate, the evidence is in `<evidence root>/<sha>/`, and no process uses the path; then
`git worktree remove --force`.
