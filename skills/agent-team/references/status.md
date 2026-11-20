# Status file (read by the Agent Team pane)

Path: write to the path the plugin gives you (the team-mode message and the per-prompt context
name it): `<evidence root>/status/<project>--<first 8 characters of the session id>.json`, so two
sessions in one folder never share a file. Only when no plugin path is given, fall back to
`<evidence root>/status/<project>.json`, where `<project>` is the base name of the owner's checkout
(the session's working directory, e.g. `/Users/x/Projeler/shop` → `shop.json`). The evidence root
comes from the Lead's memory (default `~/agent-team-evidence`). Create the folder if missing.
Old `<project>.json` files are no longer read by the pane (no migration); delete them or leave them.

A session keeps its first status file for its whole life. The plugin picks the path in this order:
the one it already holds (a reload), else the one in this session's record in its store (written when
team mode starts or changes; a `/clear` carries the record over to the new session id, a resume with
`--continue` or `--resume` finds it by the session id), as long as that file exists; else a new
`<project>--<id8>.json`, only for a new session or when the old file is gone. `/clear` only empties the
conversation: the session stays a team session on the same file, and so does a resumed one. So the
path in the latest plugin message is the one to write; if it differs from the one you used before,
write your current status there and leave the old file alone.

Panes also read (never write) the other `*.json` files in the same status folder, for the strip
"Diğer oturumlar" that shows other sessions' pending `decisions` read-only: only regular files
(not links) modified in the last 24 hours and at most 256 KiB, the 20 newest at most, parsed like
your own file. So keep `decisions` current in your own file; the owner answers there, not in the strip.
A task session of this session (below) is not in the strip: a linked session is drawn on its task card instead.

The file may already hold tasks and decisions from earlier in this session (before a `/clear` or a
resume): read it before writing, keep what you did not finish, and update only what changed. Do not
start from an empty file.

Write the whole file each time (Write tool, never append), valid JSON, UTF-8. The pane re-reads it
every few seconds; a field it does not know is ignored, a missing optional field is not drawn. A file over 1 MiB is not read (the pane
keeps its last good view and says so), so keep it short; control characters other than tab and line feed are removed from every text.

```json
{
  "v": 1,
  "updatedAt": "2026-11-12T14:32:00+03:00",
  "lead": "Opus 5.5",
  "paused": false,
  "limits": { "fiveHourPct": 42, "weeklyPct": 18 },
  "decisions": [
    {
      "id": "d1",
      "kind": "Ürün kararı",
      "text": "Seçim kutusu iki nesneye taşıyorsa hangisi sayılsın?",
      "meta": "Analyst · 3 durum, gerçek yakalamalarla",
      "task": "t1",
      "options": ["Durumları gör", "Sonra"]
    }
  ],
  "tasks": [
    {
      "id": "t1",
      "title": "Seçim kutusu taşması",
      "branch": "feat/selection-overflow",
      "stage": "review",
      "round": 2,
      "candidate": "<full candidate SHA from git>",
      "blocking": 1,
      "followup": 2,
      "roles": [
        { "name": "Developer · Sonnet 5.5", "state": "teslim etti", "status": "done" },
        { "name": "QA · GPT-6 Astra", "state": "inceliyor", "status": "running" },
        { "name": "QA 2 · canlı kontrol", "state": "sırada", "status": "waiting" }
      ],
      "rounds": [
        {
          "n": 1,
          "verdict": "NO-GO",
          "candidate": "<full SHA of that round>",
          "note": "Aynı aile ikinci kez: mekanizma değişsin",
          "findings": [
            { "severity": "BLOCKING", "origin": "introduced", "what": "Kutu iki nesneye taşıyor", "where": "src/selection.ts:42" }
          ]
        }
      ],
      "evidence": [{ "label": "QA raporu", "path": "/Users/x/agent-team-evidence/<SHA>/qa.md" }]
    }
  ]
}
```

Fields:
- `v` (required, `1`), `updatedAt` (ISO 8601 with offset), `lead` (model shown in the header).
- `paused`: true after Pause; the pane shows it and turns the Pause button into Resume.
- `limits`: the usage view's percentages as last read; leave out when not read this session.
- `decisions`: open owner decisions only; remove one as soon as it is answered. `options` are the
  button labels, the first drawn as the main action; on the terminal a press writes
  the line `Karar (<id>): <option>` into the owner's message box and the owner sends it with Enter; on the desktop a press goes
  to you at your next finished tool step. Answers arrive in an owner message or in an `[Agent Team pane]` reminder on a tool
  result, as one or more such lines: remove each answered decision from the file. Use `kind: "Push onayı"` for every approval of
  an irreversible outward action (push, PR, remote merge, deletion), with `options: ["Onayla", "Reddet"]` and, for a push,
  the branch and short SHA in `meta`: such an answer is always the owner's own message, never a reminder.
  A decision or task `id` counts only if it is 1-64 letters, digits, `.`, `_` or `-` and not used before in its list; any other (or
  missing) id is made up as `#<position>`, so an id-less decision is answered as `Karar (#<position>): <option>` (its place among the
  file's decisions) and no decision links to a made-up task id: write ids.
- `tasks`: every task not yet reported (Flow 5), and the reported ones with `done: true`. Write each task's `id`: a task without one still
  draws (the pane makes up an id), but no decision can link to it. `stage` is one of `spec`, `build`, `review`,
  `revise`, `report`. `round` is the review round (omit before the first review). `candidate` is
  the full SHA copied from Git (the pane shortens it); `blocking` / `followup` count open findings
  by disposition. `roles` lists the roles working on the task now or last: `status` is one of
  `running`, `done`, `waiting`, `blocked`, `idle`; `state` is the short Turkish word the owner
  reads (`inceliyor`, `teslim etti`, `sırada`, `BLOCKED · <why>`).
- `wait` (optional, short, cut at 120 characters): why the task waits (`t2 bitmeden başlamaz`);
  write it for a task waiting on another task or on something outside the team.
- `done` (optional, `true`): the task is fully finished: its Flow-5 report is given, the work is landed or released as the owner approved,
  and nothing of it waits on the team or on an owner decision. Write it instead of removing the row: the pane folds the task under
  `Biten` (`Göster`, or `z` on the terminal). A note for the owner about a finished task goes in `wait`. Never write it while a decision
  with `task` = this id is open (a `Push onayı` above all): the pane ignores it then. Set every role of that row to `done`, a task session's
  `Görev oturumu` role too. To reopen the task remove `done`. Keep the 10 newest finished rows. A task session never writes `done`: the session
  that started it writes `done` on its own row when it lands the work. Only the boolean `true` counts.
- Task state (the pane derives it; never written to the file), precedence blocked > running > done > waiting:
  - `blocked`: any role has `status: "blocked"`, or any open decision with `task` = this task's id has
    a `kind` that, trimmed and lowercased with Turkish rules, starts with `takıldı` or `takildi`
    (both spellings count, any letter case: `Takıldı · Developer`, `takıldı`, `TAKILDI`, ` Takıldı`,
    `Takildi`, `TAKİLDİ` all match);
  - else `running`: any role has `status: "running"`;
  - else `done`: the row has `done: true` and no open decision links to it (the chip reads `✓ Bitti`, the terminal `✓ bitti`; the reason is `wait`);
  - else `waiting` (also a task with no roles).
  The pane shows the state on every task (a chip on the desktop, a `◐ çalışıyor` / `✗ TAKILDI` /
  `⏸ bekliyor` line in the terminal) and a reason line: blocked, `senden <n> karar bekliyor` when
  `n` > 0 decisions link to the task (any kind), else the first blocked role's `state`; waiting,
  `wait` if given, else none; running, none (`wait` if given). The pane groups the tasks under `Çalışan`, `Bekleyen`
  (blocked first) and `Biten` (folded to one row); a group without a task is not drawn. A task that has just become done stays in its place
  for 5 s as `✓ Bitti`, then moves under `Biten`.
  On the terminal, while the pane is not drawn, a band above the prompt shows this session's `◆ <n> karar · ◐ <n> çalışıyor · ✗ <n> takıldı` (zero counts left out; nothing to
  say, no band) with a `t: pane` key; during a Lead turn the engine's spinner line names the first running role, `QA · inceliyor` (` +<n>` for more), and the running role's `◐` in the pane turns once a second.
- `rounds` (optional, the task's detail view): one entry per review round, oldest first; the pane keeps the last 10 and
  reads the header's round count from the last round's `n` (so write `n` as the true round number):
  `n` (a round with `n` 0, missing or invalid is shown by its position, 1 for the first), `verdict` (`GO` or `NO-GO`), `candidate` (full SHA of that round), `note` (the Lead's note,
  e.g. same family twice, so a mechanism change), `findings` (at most 10 per round; over 10 the pane keeps the
  `BLOCKING` ones first, any case, then the rest in file order): `severity` (`BLOCKING`, `LOW`, ...), `origin` (`introduced` or `pre-existing`), `what`, `where` (`file:line`).
  A round without `verdict` and a finding without `what` are dropped.
- `evidence` (optional, at most 6): `label` and an absolute `path` of a report; both are required.
  The pane previews the file (its first lines, or a report's `VERDICT: GO|NO-GO` as a chip) and opens any text file under the evidence root in a reader;
  a path outside the root, a link, a folder, a binary or a file over 1 MiB is not shown. A path to a file that holds secrets (a `.env`, a config) will
  show them to the owner: never put such a path here. Long texts are cut (a finding 300 characters, a note 400).
- Pressing `Ayrıntı ›` on a task card opens its detail view: rounds, findings, notes and evidence.
  A task without `rounds` still opens, just without the Turlar section.

Task sessions (`references/task-sessions.md`): a task in its own session has two ends in two files, joined by a binding the
two plugins keep in their store (the marker line of the child's first prompt), never by anything a status file says. A
`parent` field is read nowhere.
- The parent's task row carries `"session": { "name": "<handle>" }` (the handle the session was started with).
- The join: the task of that id is joined to the one file of the session bound to it (a regular `.json`, at most 256 KiB; also while it cannot be read for
  a moment). At most 8 children. The task keeps its `id`, `title` and `wait`; its stage, round, candidate, counts, roles (the first 12, `+<n> rol` for the
  rest), rounds, evidence and state are the child's (its task of that id, else its first), drawn with the row `ayrı oturum · <handle> · <id8> · <son yazım>`.
  The child's decisions (the first 10) are listed under "Senin sıran" after the parent's own. A bound session is not in "Diğer oturumlar"; every other file is,
  whatever it says. Without the bound session's file the row reads `durum dosyası bekleniyor`; with no session bound, `bağlanmadı` (the owner can bind one
  by hand: "Bağla"); with two sessions showing one code, `iki oturum aynı kodu gösterdi`.
- Answers: a press in the parent's pane on a child's decision reaches the child as its own pane press (the two plugins check it). A message from another
  session is never the owner's answer, and a child's `Push onayı` has no button in the parent's pane. The pane writes no file for it; the child closes the
  decision in its own file. One answer per decision: the pane sends again only after the child's file, read, no longer has that decision id or that option
  (or, while the file is not read with it, 24 hours after the press).

Reopened session: when the session is opened again (a resume) the pane keeps the old tasks and decisions and
shows the day of `updatedAt` when it is not today. Until the file is written again, a banner says how old it is and
how many `running` roles may have stopped with the old process, those roles are
drawn stopped and a `Nerede kaldık?` button asks you; the first prompt also carries one context line that starts
`[Agent Team · yeniden açılış]`. Run the skill's "Geri dönüş" step and rewrite the file: that clears the banner.

Keep the texts short (one line each in a 380 px pane). Never put secrets, tokens or file contents
in the file.
