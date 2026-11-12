# Pilot, trials and team eval

Read this when writing the Flow-5 report or summarizing pilot rows.

**Pilot row (every task, short):** task, phase, mode (Sonnet / Opus / design → implement), review
rounds (+ owner-approved extra rounds), verdicts, resumed vs fresh Developer, tokens per role
(subagents from task notifications, Codex `tokens used`, the Lead's from the session usage view when
available) and the **total for the finished task** — failed runs, escalations and required reruns
included, end-to-end wall-clock, findings later confirmed vs rejected (false alarms), defects found
after GO (missed). A missing value is written `unknown`, never estimated. At Flow 5 the Helper
compiles the row from notifications, logs and the record; the Lead checks it. BLOCKED tasks get a
row too. List-price dollar figures are an estimate, never presented as subscription usage or a
bill. No savings figure is stated before evidence. After a few tasks the Lead summarizes the rows
for the owner; the split and the open trials are revised on that evidence.

**Phases:** a change of model, effort, role prompt or harness version opens a new phase; never
compare totals across phases as if conditions were the same. This list is the only phase
timeline (rationale in decisions.md):
- P1 2026-10-01 — Opus roles medium, Sonnet Developer medium, Codex GPT-6 Astra.
- P2 2026-10-02 — Analyst and Opus Developer high; later Sonnet Developer high, report-length and
  evidence-package rules; Codex Fast on.
- P3 2026-10-03 — Codex roles on GPT-6 Astra (Fast on).
- P4 2026-10-04 — Codex roles back on GPT-6 Astra (Fast on).
- P5 2026-10-05 — Opus Developer medium; Codex Fast off.
- P6 2026-10-07 — Analyst medium (every Opus role medium).
- P7 2026-10-07 (later) — finding origin/disposition, edge-case inventory, round brake, evidence
  folder, closure by evidence, short pilot row.
- P8 2026-10-07 (latest) — Helper on Haiku 5.5 · medium; geometry specs by `team-analyst-high`
  (Opus high); edge cases → acceptance tests; fresh Lead chat per task.
- P9 2026-11-10 — Analyst on Fable 5.2 (medium; high for hard work + design contract + referee),
  Analyst runs for every non-trivial task; Opus/Sonnet implement the Analyst's design contract;
  evidence outside the scratchpad; Lead limits ~600k context / 5-hour 95 % / weekly 97 %; extra
  rounds without asking; 4 parallel tasks. Watch: Fable share of weekly usage, Developer NO-GO
  rounds, contract revisions, criteria later found wrong.
A model switch inside a session (e.g. Opus → Fable → Opus) is noted in the row.

**Open trials (inside the pilot, never as a silent default change):** Helper at `low` effort; QA 2
at Opus `low` for the short live check; QA round 1 at `medium`; Lead on Fable 5.2 · medium; explicit
`tools:` lists for the roles that inherit every tool (measure a fresh subagent's first-turn input
with and without the list before changing it). Each trial compares like tasks against the current
setting with the columns above, one change at a time; a trial that misses a defect the current
setting caught is rejected.

**Team eval (once enough records exist):** turn about 20 past real tasks into a replay set, weighted
like real work: routine Sonnet work, geometry/tolerance work, UI live checks, a wrong expected value
in a test, clean changes (no real defect), known false alarms and an incomplete report. Score with
code where possible, otherwise a fixed checklist against verified references; record the spread
between two runs of the same setup before trusting a difference. Keep a held-out part that is not
used while tuning. A change that keeps the total score but regresses a critical category is not
adopted. A cheaper setting (review or other role) becomes the default only if it finds every
confirmed finding in the held-out part, adds no new false alarms, and uses fewer tokens per finished
task. Re-run when a model or the harness changes.
