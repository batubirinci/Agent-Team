# agent-team — decision record

History and rationale moved out of SKILL.md (2026-10-01 review: dated notes in the prompt are
read as instructions on every run). The Lead reads this only when a decision is questioned.

- 2026-09-28 — Helper role on Sonnet 5.5 · medium, mechanical chores only.
- 2026-09-29 — QA engine: GPT-6 Astra.
- 2026-10-01 — All Opus roles default to medium. Source: Anthropic, Opus 5.5 at its default
  medium matches or beats Opus 5 at high on coding and knowledge work (prompting-claude-opus-5-5).
  Raise per task only with a stated reason.
- 2026-10-01 — Analyst only for broad/unclear work; routine criteria are written by the Lead.
- 2026-10-01 — Analyst 2 / referee: GPT-6 Astra · high instead of the more expensive GPT-6 Astra.
- 2026-10-01 — Developer split: Sonnet 5.5 default, Opus 5.5 for geometry / numerical / tolerance /
  coordinate / selection semantics, new product rules, multi-module work, escalations. Design
  checked with GPT-6 Astra · medium.
- 2026-10-01 — QA medium for focused re-review of a non-risky fix.
- 2026-10-01 — QA 2 runs a short live check by default (one full review instead of two).
- 2026-10-01 — Round 2+: only Codex QA, focused (usage saving).
- 2026-10-01 — Measurement split: Developer designs and scripts the sweep, Helper runs it. GPT-6
  Luna was considered as runner and NOT chosen (owner: "çok ucuz diye aptal bir model ile de
  ilerlemeyelim"; Luna ~20× cheaper per token but trails on tool use and coding indexes) — the
  saving comes from the script, not from the runner's model.
- 2026-10-01 — Pilot: owner asked "kesin daha az usage mı?" — not known until measured. Pre-evidence
  guess (routine work ~30–50 % less) removed from the skill as unmeasured.
- 2026-10-01 — Lead context proxy calibration: a 38 MB transcript = 450k / 1M context (owner's
  `/context`). One data point; used as an alarm only, not as a percentage.
- 2026-10-01 — Review by Claude Opus 5.5 + GPT-6 Astra · medium (blind) against Anthropic's cost
  blog, eval/hillclimb blog, Sonnet 5.5 and Opus 5.5 prompting guides. Applied: contradiction
  fixes (Sonnet design-contract exception, Analyst 2 trigger, VERDICT check scope, QA 2 body),
  evidence package for reviews, fresh Developer per revision round, Codex `-o` final message,
  removed "keep working until…" sentence (Sonnet guide: it lengthens sessions at low/medium —
  restore it if pilot rows show early check-in stops), dated notes moved here, pilot quality
  columns. Deferred to pilot evidence: Helper at low effort, QA 2 at Opus low, QA round 1 at
  medium, design → implement split (3 trial tasks, remove if no gain). Originals: backup
  `yedek-2026-10-01/` in the review folder.
- 2026-10-01 (later) — Owner removed ponytail entirely (plugin disabled in ~/.claude/settings.json;
  developer files keep a one-line "shortest correct diff" rule). Push / `gh pr create|merge|ready`
  now need owner approval in every permission mode: `permissions.ask` rules plus a PreToolUse hook
  (`~/.claude/hooks/guard-push.sh`) for spellings like `git -C dir push`. Second blind review by
  GPT-6 Astra · medium (video on short prompts) applied: brief = goal and why / limits / done
  when; QA brief asks for anything that would make the candidate wrong, also outside the
  criteria; resume-vs-fresh Developer made conditional (cache TTL is not certain to have expired);
  Developer gate evidence reused when it covers the exact SHA; Codex done-check reads `final.md`
  (a whole-log grep for "usage limit" gave a false alarm when Codex read SKILL.md); Codex recipe,
  design split and pilot moved to `references/`; handoff table folded into one paragraph; TDD
  scoped to behavior changes. SKILL.md 346 → ~180 lines.
- 2026-10-02 — Analyst and Developer (Opus) raised to Opus 5.5 · high (owner). Reason: usage fell
  well after the 2026-10-01 changes, and most of the saving is structural (Sonnet default
  developer, Analyst only for broad work, short QA 2, Codex-only rounds 2+), not the effort level.
  Sonnet Developer, QA 2, Helper and Lead stay medium. Pilot rows from this date are a new phase:
  do not compare Opus Developer / Analyst usage across the boundary as if nothing changed.
- 2026-10-02 (later) — Owner reviewed two Anthropic decks ("Claude 5.5 family" cost/effort talk and
  Ben Lehrburger, "Building with the Claude 5.5 family"); blind double review by Claude Opus 5.5 and
  GPT-6 Astra · max. Applied: Sonnet Developer → `high` (Sonnet 5.5's API default is high; on the
  decks' Terminal-Bench chart medium 28.8 % vs high 43.0 %, still cheaper per attempt than Opus
  medium; the decks' case study picked Sonnet 5.5 high — caveat: that chart is the most
  effort-sensitive of four, the companion slide was missing); `team-developer-high` and
  `team-developer-sonnet-high` deleted (identical to the base files); Developer report = evidence
  package matching Flow 3 (environment, raw-log path, clean worktree were missing, so gates got
  re-run); short-report rule for every role and the shared contract (Opus 5.5 writes long; reports
  are re-read by the Lead every turn); spanning several modules alone no longer routes to Opus;
  Developer without criteria states its assumed criteria instead of silently deriving them; Lead
  effort chosen at session start (an effort change resets the message cache); pilot measures the
  total per finished task including the Lead, phases, and a ~20-task team eval. Not applied: Batch
  API and per-turn effort (API features, not this CLI flow), all work on Opus, many parallel
  Sonnets, the deck's 93 % bar as a release gate, lowering Analyst / Opus Developer again. Review
  files: scratchpad `deck/claude-notes.md`, `deck/codex/final.md`; backup `yedek-2026-10-02/`.
- 2026-10-02 — TEMPORARY: Codex Fast on (`service_tier = "fast"` in `~/.codex/config.toml`; sends
  `service_tier: priority`, "2x speed, increased usage") until the Codex subscription ends
  (~2026-10-04). Owner: use the remaining usage faster. Revert to `"default"` afterwards. Pilot rows
  in this window are a separate phase for Codex wall-clock and usage.
- 2026-10-03 — TEMPORARY: Codex roles (QA, Analyst 2) on GPT-6 Astra instead of GPT-6 Astra until the
  Codex subscription ends (~2026-10-04; owner: 1.5 days left, one reset + 100 % usage to spend).
  Efforts unchanged: QA high (full / risky) · medium (focused), Analyst 2 high — OpenAI recommends
  medium for agentic coding, high for complex debugging, xhigh only when evals show value; a
  third-party review test found Astra high no better than low and max slower (one PR, not our
  work). Astra costs ~5× Astra per token in Codex credits (third-party figure, not measured here),
  Fast still on — watch the remaining usage; a limit hit mid-run = BLOCKED. Revert to
  `gpt-6-astra` (SKILL.md roster + description, references/gpt-roles.md command). Pilot rows in this
  window are a separate phase.
- 2026-10-04 — Owner: Astra Codex limit is used up; Codex roles (QA, Analyst 2) back on GPT-6 Astra,
  Fast stays on (`service_tier = "fast"` in `~/.codex/config.toml`). Astra is not used. Efforts
  unchanged (QA high full/risky · medium focused, Analyst 2 high). Updated: SKILL.md description +
  roster, references/gpt-roles.md command (`-m gpt-6-astra`). Pilot rows from here are a new phase.
- 2026-10-05 — Owner: Developer (Opus) back to Opus 5.5 · medium (Analyst stays high). Reason: the
  long Opus developer sessions are the larger cost; Analyst runs rarely and its errors enter both
  code and tests unseen by QA, so its effort is kept. Watch pilot rows (Opus Developer NO-GO rounds,
  repeated root causes); return to high if they rise. Same day: Codex Fast off
  (`service_tier = "default"` in `~/.codex/config.toml`); Codex roles stay GPT-6 Astra, efforts
  unchanged. Pilot rows from here are a new phase.
- 2026-10-07 — Owner: Analyst to Opus 5.5 · medium. Every Opus role now runs at medium (Lead,
  Analyst, Developer (Opus), QA 2). Watch pilot rows for criteria later found wrong by QA or the
  owner; return the Analyst to high if they appear. New pilot phase.
- 2026-10-07 — Owner: removed agent files `team-developer-max` (Opus max exception),
  `ctd-alt-ajan-opus-medium`, `ctd-alt-ajan-opus-xhigh`, `derin-danisman-fable`. Moved (not deleted)
  to `~/.claude/agents-yedek-2026-10-07/`. No skill referenced them. Kept: `dev-loop-reviewer*`
  (used by dev-loop / adversarial-co-review) and the dev-loop / dev-loop2 / adversarial-co-review skills.
- 2026-10-07 (later) — Three-way review: Claude Opus 5.5 and GPT-6 Astra · high (blind), then the
  Lead chat that runs the skill (from its records: dudak 5 rounds driven by uncovered edge cases;
  pre-existing bug flagged MAJOR; brief premise "30,00" spread to two roles; developer tests locked
  in its own bugs 3×; Helper hung 1.5 h; gates re-run on an identical tree; Developer resumed to
  550k; pilot rows not kept). Plan checked by Codex (apply with changes). Applied: finding origin
  (`introduced | pre-existing`) + Lead disposition (`blocking | follow-up`), "anything that worries
  you" removed; edge-case inventory (unresolved consequential cases only) asked in one batch before
  development; expected-value provenance in every mode, brief premises cite primary source; round
  cap counted across escalation, owner extra round one at a time for a new rule or one named
  finding; extreme fixtures block only when they break an existing criterion/contract; closure by
  evidence (QA 2 for live/timing, incl. speed/perf-budget revisions); evidence folder
  `<scratchpad>/evidence/<sha>/`; gate reuse on identical tree; resume Developer at most two rounds
  in a row; long-run watch (20 min); owner figure shows complete final state + sources; short
  Helper-compiled pilot row, phase list only in pilot.md; Codex recipe `or die`, absolute
  per-attempt paths, no `&`; design-split recurrence goes back to Opus; push hook rewritten
  shell-aware (36 fixtures in `~/.claude/hooks/guard-push.test.sh`, unparsable → ask, read-only
  `gh api` GET no longer asks). Not applied: a numeric context limit (~300k) — cumulative tokens are
  not current context. Backup: `yedek-2026-10-07/` in the review folder. New pilot phase P7.

## 2026-10-07 — QA 2 model split (owner)
Blind comparison on CTD tek-yol faz 1: on the round-3 re-check (no defect present) Sonnet 5.5 and Opus 5.5
both returned GO, Sonnet with wider sweeps but a cluttered owner figure and no overlap count. On the
round-1 candidate (known owner case: dragging one label re-placed the other automatic labels) Opus measured
all 21 labels and found it; Sonnet measured 3 and missed it. Owner approved: round-1 / first live check stays
Opus; targeted re-checks of named scenarios may run on Sonnet (`model: "sonnet"`).
- 2026-10-07 (video review) — Effort change no longer resets the cache on Opus 5.5 / Sonnet 5.5
  (code.claude.com/docs/en/prompt-caching; the 2026-10-02 "pick effort at session start" reason is
  obsolete): Lead default medium, may raise temporarily with a stated reason. Both Developer files:
  never change or weaken an existing test or acceptance criterion to make it pass (video: an Opus
  run changed the rules to pass; Lead records: tests locked in developer bugs). Not applied: Sonnet
  Developer medium trial (no pilot rows yet to measure it), "try two approaches" rule.
- 2026-10-07 (model research) — Three reports compared (Claude deep research, ChatGPT, Claude.ai;
  report: review folder `reports/Claude ve Sol model eşlemesi.md`). Owner approved: Helper → Haiku
  5.5 · medium (Anthropic's intended use; all three agree; never GO/review/owner documents — the
  Lead writes those; Haiku hallucinates more than other current Claude models, so every Helper
  result must be observed command output; revert to Sonnet if a Helper report proves wrong). Claude
  Analyst at Opus high for geometry / tolerance / selection specs via new `team-analyst-high` (spec
  gaps drove the long rounds; partly reverses the same-day medium decision; other work stays
  medium). Analyst 2 (Codex Astra high) unchanged, still parallel and blind. Each answered edge case →
  acceptance test. Lead proposes a fresh chat after every task; transcript alarm 25 → 15 MB
  (estimate). Not applied: Sonnet Developer medium (AA coding high 43.9 vs medium 29.8 — measure
  first), Lead on Sonnet, QA 2 on Sonnet, QA round 1 medium (open trial), Codex JSON schema output.
  Pilot phase P8.
- 2026-10-21 — Owner: approval prompts in bypass mode on Bash calls like `cd <worktree> && git …`.
  Cause (read from the Claude Code 2.1.296 binary, then tested live): the `cd-git-compound` check
  asks for any command holding both `cd` and `git`, unless the `cd` target resolves to the shell's
  current directory; it is not skipped by bypass mode, and a worktree inside the repo would not
  avoid it. `git -C <path>` does not trigger it. Rule added to SKILL.md and the Developer (both),
  QA 2 and Helper agent files: git in a worktree runs as `git -C <absolute path> …`. Push/PR still
  asks by design (`guard-push.sh`). Backup: `yedek-2026-10-21/` in the review folder.
- 2026-10-21 (later) — `guard-push.sh` false positive: a heredoc body (prose with an unbalanced
  apostrophe that mentioned `guard-push.sh`) made the parse fail, and the unparsable fallback matched
  "push". Fix: heredoc bodies are dropped before parsing; a body fed to sh/bash/zsh/dash/ssh/eval is
  still checked, `$(...)` inside any body is still checked, an unterminated heredoc is parsed as
  before. 10 new fixtures (46 total); the old hook fails the 3 data-body cases, the new one passes all.
- 2026-10-21 (later) — Owner: enforce the `git -C` rule instead of relying on instructions. New
  PreToolUse hook `~/.claude/hooks/guard-cd-git.sh` (wired in ~/.claude/settings.json after
  guard-push): a Bash command holding both `cd` and `git` is denied with a rewrite hint, so Claude
  retries with `git -C` and the owner sees no prompt. Same exemption as Claude Code (one literal
  `cd` to the current directory); heredoc bodies ignored; unparsable input passes (not a guard).
  27 fixtures in `guard-cd-git.test.sh`; live test denied `cd ~ && git --version`. Applies to every
  session, not only agent-team. Backup of settings.json in `yedek-2026-10-21/`.
- 2026-11-10 — Owner: Fable 5.2 joins as the thinking role. Analyst (`team-analyst`, `team-analyst-high`)
  → Fable 5.2 (medium; high for geometry / numerical / selection / new product rule, every task for
  the Opus Developer, and the referee role). The Analyst now runs for every non-trivial task and
  writes the design contract for hard work; the Opus Developer stays on Opus 5.5 · medium and
  implements it (owner: "Opus yolu fikri aldıktan sonra yeterli iş çıkarır"; Fable on the developer
  would cost too much usage — developer sessions are the longest and most output-heavy, Fable is
  2× Opus per token: $8/$40 vs $4/$20, cache reads both $0.20). Codex Analyst 2 stays as the blind
  cross-model pair and second opinion. `model: fable` resolves to `claude-fable-5-2` in Claude Code
  2.1.321 (checked in the binary). Sources: anthropic.com/claude-fable-and-mythos-5-2 (Fable high
  ≈ Opus 5.5 best on FrontierCode at ~half cost per task; most gain arrives by `high`, above it
  uneven) and the claude-api migration notes (Fable follows carried-over cautions closely; remove
  "think less" lines; finish-the-task and self-standing-report text added to the Analyst files).
  Same review also folded in owner rules that lived only in the Lead's memory and contradicted the
  skill: evidence outside the scratchpad (it is deleted on chat change); rounds continue past 3
  without asking (owner 4.11), family rule kept; Lead limits ~600k context, 5-hour 95 %, weekly
  97 % (replaces the 15 MB transcript alarm); 4 parallel tasks, 2 live checks; every project
  command in the worktree, never the owner's checkout (30.10 DB incident); GO → local main without
  asking + post-merge steps; pause never archives sessions or blind-WIP-commits an agent worktree.
  Design → implement split is now the default for hard work (no longer a trial). Backup:
  `~/.claude/skills-yedek/agent-team-2026-11-10/`. New pilot phase P9.
