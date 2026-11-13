# Status file (read by the Agent Team pane)

Path: write to the path the plugin gives you (the team-mode message and the per-prompt context
name it): `<evidence root>/status/<project>--<first 8 characters of the session id>.json`, so two
sessions in one folder never share a file. Only when no plugin path is given, fall back to
`<evidence root>/status/<project>.json`, where `<project>` is the base name of the owner's checkout
(the session's working directory, e.g. `/Users/x/Projeler/shop` → `shop.json`). The evidence root
comes from the Lead's memory (default `~/agent-team-evidence`). Create the folder if missing.
Old `<project>.json` files are no longer read by the pane (no migration); delete them or leave them.

A session keeps its first status file for its whole life: the plugin reuses the path it already
gave (a reload, a `/clear`, or a resume under a new session id) as long as that file exists, and
computes a new `<project>--<id8>.json` only for a new session or when the old file is gone. So the
path in the latest plugin message is the one to write; if it differs from the one you used before,
write your current status there and leave the old file alone.

Write the whole file each time (Write tool, never append), valid JSON, UTF-8. The pane re-reads it
every few seconds; a field it does not know is ignored, a missing optional field is not drawn.

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
  button labels, the first drawn as the main action; a press sends the Lead
  `Karar (<id>): <option>`. A push approval is `kind: "Push onayı"` with
  `options: ["Onayla", "Reddet"]` and the branch and short SHA in `meta`.
- `tasks`: every task not yet reported (Flow 5). Write each task's `id`: a task without one still
  draws (the pane makes up an id), but no decision can link to it. `stage` is one of `spec`, `build`, `review`,
  `revise`, `report`. `round` is the review round (omit before the first review). `candidate` is
  the full SHA copied from Git (the pane shortens it); `blocking` / `followup` count open findings
  by disposition. `roles` lists the roles working on the task now or last: `status` is one of
  `running`, `done`, `waiting`, `blocked`, `idle`; `state` is the short Turkish word the owner
  reads (`inceliyor`, `teslim etti`, `sırada`, `BLOCKED · <why>`).
- `wait` (optional, short, cut at 120 characters): why the task waits (`t2 bitmeden başlamaz`);
  write it for a task waiting on another task or on something outside the team.
- Task state (the pane derives it; never written to the file), precedence blocked > running > waiting:
  - `blocked`: any role has `status: "blocked"`, or any open decision with `task` = this task's id has
    a `kind` that, trimmed and lowercased with Turkish rules, starts with `takıldı` or `takildi`
    (both spellings count, any letter case: `Takıldı · Developer`, `takıldı`, `TAKILDI`, ` Takıldı`,
    `Takildi`, `TAKİLDİ` all match);
  - else `running`: any role has `status: "running"`;
  - else `waiting` (also a task with no roles).
  The pane shows the state on every task (a chip on the desktop, a `◐ çalışıyor` / `✗ TAKILDI` /
  `⏸ bekliyor` line in the terminal) and a reason line: blocked, `senden <n> karar bekliyor` when
  `n` > 0 decisions link to the task (any kind), else the first blocked role's `state`; waiting,
  `wait` if given, else none; running, none (`wait` if given). The task section's header counts the
  states: `<r> çalışıyor · <b> takıldı · <w> bekliyor`; `takıldı` and `bekliyor` are left out at zero,
  `çalışıyor` is always shown.
- `rounds` (optional, the task's detail view): one entry per review round, oldest first; the pane keeps the last 10 and
  reads the header's round count from the last round's `n` (so write `n` as the true round number):
  `n` (a round with `n` 0, missing or invalid is shown by its position, 1 for the first), `verdict` (`GO` or `NO-GO`), `candidate` (full SHA of that round), `note` (the Lead's note,
  e.g. same family twice, so a mechanism change), `findings` (at most 10 per round; over 10 the pane keeps the
  `BLOCKING` ones first, any case, then the rest in file order): `severity` (`BLOCKING`, `LOW`, ...), `origin` (`introduced` or `pre-existing`), `what`, `where` (`file:line`).
  A round without `verdict` and a finding without `what` are dropped.
- `evidence` (optional, at most 6): `label` and an absolute `path` of a report; both are required.
  The pane shows the path as text. Long texts are cut (a finding 300 characters, a note 400).
- Pressing `Ayrıntı ›` on a task card opens its detail view: rounds, findings, notes and evidence.
  A task without `rounds` still opens, just without the Turlar section.

Keep the texts short (one line each in a 380 px pane). Never put secrets, tokens or file contents
in the file.
