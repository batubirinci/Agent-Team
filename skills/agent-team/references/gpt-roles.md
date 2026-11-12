# Running the GPT roles (Analyst 2, QA)

Read this before starting a Codex run. Codex runs take the project's heavy-run lock/queue when it
has one (SKILL.md "Gate script / heavy-run lock").

## Invocation

- One absolute run folder per attempt, so a rerun never overwrites evidence:
  `R=<evidence root>/<task>/codex/<role>-r<round>-a<attempt>` (persistent, not the scratchpad) holding `brief.md`, `final.md`, `log.txt`.
  `mkdir -p "$R"; perl -e 'alarm shift; exec @ARGV or die "exec failed: $!"' 5400 codex exec -m gpt-6-astra -c model_reasoning_effort="<high|medium>" --sandbox <read-only|workspace-write> -C <dir> -o "$R/final.md" - < "$R/brief.md" > "$R/log.txt" 2>&1; echo "CODEX_EXIT=$?" >> "$R/log.txt"`
  (`or die` makes a missing executable exit non-zero instead of 0.)
- Start it only with the Bash tool's `run_in_background: true`, never with `&` (the exit line is
  then lost). The `perl` alarm is the deadline: 5400 s (90 min) kills Codex (macOS
  has no `timeout`/`gtimeout`). `CODEX_EXIT=142` = deadline hit → BLOCKED; the one infrastructure
  rerun per round may use a longer deadline. Never wait with `pgrep` — the pattern matches the
  waiting shell itself and loops forever.
- If the deadline hits, Codex's child processes may survive: check `ps` for processes under the
  run's worktree and stop the task-owned ones one PID at a time before a rerun.
- Done-check (exit 0 is not enough): `final.md` exists and ends with a role-appropriate report —
  for QA a real `VERDICT:` line (not the brief's `GO|NO-GO` template) for the requested base and
  candidate SHAs; for Analyst 2 a real `HANDOFF:` line — and the log has a `tokens used` line.
  Check usage-limit errors only on Codex's own error lines near the end of the log, not by
  grepping the whole log: Codex logs the files it reads, and a file that mentions "usage limit"
  would look like an error.
- Timeout, interruption or malformed output → BLOCKED, never keep polling.
- Every GPT-role brief says: do not install or add dependencies (the review worktree is already
  set up), do not touch dependency folders, manifests or lockfiles; do not commit or push.
  Analyst 2 modifies nothing. QA may make temporary mutations/probes in its review worktree only —
  restore them and verify every tracked file, manifests and lockfile included, matches the
  candidate.
- Separate blind runs are separate reviews, not independent model evidence: never report two
  passes of the same model (or model family) as independent agreement.

## Analyst 2 brief

Analyst 2 is the blind cross-model pair of the Fable Analyst on unclear geometry/numerical
requirements, and the second opinion when the Fable referee runs. Clarify scope, list acceptance
criteria and edge cases. Check the repo for existing patterns. Verify claims in the source, not in comments or handoff notes. Follow the shared contract. Send
proposed criteria and open interpretations to the Lead; do not turn uncertainty into a requirement.
You are read-only. End with `HANDOFF: Developer — <brief>` or `HANDOFF: Lead — <blocker /
disagreement / consequential uncertainty / owner decision>`.

## QA brief

The Lead copies this section verbatim into every GPT QA brief (like the shared contract), then
adds the task-specific parts (goal and why, acceptance criteria, non-goals, evidence package, diff,
impact list, files to read first); parts reused from an earlier task's record never replace it.

Your job is to find whatever would make this candidate wrong for the owner against the acceptance
criteria and the contracts it touches. Mark each finding's origin: `introduced` (absent on base —
check base) or `pre-existing`. A finding you call blocking needs a reproduction or a concrete
causal argument. Concerns outside the criteria, and pre-existing defects, go in a separate
`Follow-up (non-blocking)` list; they do not make the verdict NO-GO.

Review the candidate SHA. Your brief states `review_mode: full` or `review_mode: focused`.
**full** (round 1, or when the brief says so): review the whole change independently — do not
assume QA 2 covers anything, except live browser checks (out of scope for you; write
`UI live: out of scope (QA 2)`). **focused** (round 2+): review the fix diff, the affected callers
and contracts, and confirm each earlier finding is closed; widen to full only if architecture,
shared geometry or test infrastructure changed, and say why. When reviewing a fix, probe the same
defect family through other channels, scales and paths that the criteria and contracts cover —
not only the reported scenario; a more extreme case that would need a new requirement is a
follow-up. Closing live-behavior or timing findings belongs to QA 2. Do not start extra review
rounds of your own.

The brief carries an evidence package (gate commands, exit codes, counts, failing tests, raw-log
paths) produced on this candidate SHA. Use it instead of re-running the same gates; re-run any
gate or test you have a concrete reason to doubt, and say which and why. Reproduce findings by
running code where you can; say which were reproduced vs. read from source. A mutant or negative
probe counts as caught only when a test fails on the targeted wrong behavior; a crash,
type/compile error or harness error does not count. Report missing tests and wrong expected values
in tests (check where each expected value comes from) as findings — do not edit the candidate (temporary probes are allowed, restored
afterwards). Follow the shared contract; list incomplete checks explicitly.

Report findings first: `VERDICT: GO|NO-GO`, base and candidate SHA, findings as
`SEVERITY — origin — file:line — what — how measured`, then the follow-up list, one line per check
you ran or relied on, and the incomplete checks. Write any extra output files to the evidence
folder the brief names, not into the worktree. End with `HANDOFF: Lead — <verdict, gates, unresolved findings>`.
