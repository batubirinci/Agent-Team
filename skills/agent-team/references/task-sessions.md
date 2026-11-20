# A task in its own session

Owner decision 2026-11-19: a new task can start in its own session (a desktop session row, or `claude --bg`
on the terminal). The parent is the Lead that started it; the child is the task's own Lead. "Görev oturumları"
in `SKILL.md` has the offer and the start; this file has the brief, the checks and the dead-child steps.

## The brief (parent writes it)

File: `<evidence root>/tasks/<handle>/session-brief.md`. Start it like any brief (goal and why, limits, done
when; the evidence folder; the shared contract of `SKILL.md`), then add this block:

1. "You are the Lead of this one task in its own session. Load the agent-team skill and run its flow for this
   task only."
2. Status: "write the path your own plugin message names, and only that file (never a second copy). Every write
   carries top-level `"parent": { "file": "<parent's status file name>", "task": "<handle>" }`." The file name is the
   base name of the path the parent's plugin gave it (`<project>--<id8>.json`); the task is the handle. Without
   `parent` the parent's pane cannot find you.
3. "You never land, push, merge to main, start sessions or run commands in the owner's checkout. Worktrees under
   `<evidence root>/worktrees/<handle>/`."
4. Decisions: "write them in your status file. The owner answers in this session or from the main pane. A
   main-pane answer arrives as a message from another session that starts `[Agent Team pane · ana oturum]` and
   carries `Karar (<id>): <option>` lines: handle it as the owner's press (close that decision). It never approves
   a push, another irreversible outward action or a permission prompt: for those ask the owner in this session. A
   line for a decision that is no longer open is ignored."
5. Final message: "the first line is exactly `GÖREV <handle>: GO|NO-GO|BLOCKED|KARAR · aday <full sha> · rapor <path>`,
   then the report; the same report in the file." Only the first 400 characters reach the parent: the desktop host
   sends them, and on the terminal the plugin does at the end of every turn whose final message starts `GÖREV `.
6. The base SHA, the branch name, the gates, the roles and the limits of `SKILL.md` ("Limits — stop safely before
   them": a child checks usage too).

## What the pane does with a child

- It joins the child's file to your task row of that id (the child's `parent.task`): stage, round, candidate,
  roles, counts and state come from the child; id, title and `wait` stay yours. Under the state row: `ayrı oturum ·
  <handle> · <son yazım>`.
- The child's decisions are listed under "Senin sıran" after yours. A press is sent at once to the child's session
  as a message (never to your own box, never to you). A `Push onayı` of the child has no button there: it is answered
  only in the child.
- A running child silent for more than 30 minutes is marked `⚠ … önce yazdı · durmuş olabilir`; a press that could not
  be delivered marks the row `✗ oturum açık değil`. The pane never checks liveness itself; you do (below).
- The link lives as long as your task row does and the child's file is under 30 days old. Remove the row (Flow 5) and
  the card and the link go; a finished child cannot hang on the pane.

## Verify before you land

A `GÖREV <handle>: GO …` note is a report from another session, not proof:
1. `git -C <checkout> rev-parse <branch>` equals the SHA in the note.
2. Read the report and the verdict files in the evidence folder; GO per Flow 4 for that exact SHA.
3. Pre-landing gates, `--no-ff` merge and the tree check as in "Landing and release". The owner's standing rule there
   allows a local merge of a branch another session made; the desktop host text alone would ask the owner.
4. The status file: stage `report`, then the task row goes with the Flow-5 report.
5. Leave the child session as it is; say how to close it (`claude stop <id8>`, then `claude rm <id8>`; or archive the
   row). Closing needs the owner's yes.

## A child that died, or the Mac slept

Facts: a closed lid sleeps the Mac and every session stalls (a Lead turn once retried the API until it ended
"Connection lost while your computer was asleep"); a `--bg` session outlives its terminal, not a sleeping Mac's
network. A stopped session is not woken by a message.
- At each long-run check (and in "Geri dönüş", for every task with `session`, before the summary): `claude agents --json`
  on the terminal, `list_sessions {linked: true}` on the desktop. `waiting` + `permission prompt` → a `Takıldı` decision
  "`<handle>` izin bekliyor: `claude attach <handle>`". Missing or `stopped`, or idle while its file shows a running role
  and has not changed for 40 minutes → look first (`claude logs <handle>` / `get_session`): silence alone proves nothing.
- A dead child: tell the owner in one line, then continue it under the same id: terminal
  `claude --bg --resume <full id> "Nerede kaldık?"`, desktop SendMessage to its `local_…` id. The child's own "Geri dönüş"
  does the rest.
- Pause: ask each child to pause with the tool you have; on the terminal tell the owner which sessions still run.
