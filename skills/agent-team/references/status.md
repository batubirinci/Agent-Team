# Status file (read by the Agent Team pane)

Path: `<evidence root>/status/<project>.json`, where `<project>` is the base name of the owner's
checkout (the session's working directory, e.g. `/Users/x/Projeler/shop` → `shop.json`). The
evidence root comes from the Lead's memory (default `~/agent-team-evidence`). Create the folder if
missing.

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
      ]
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
- `tasks`: every task not yet reported (Flow 5). `stage` is one of `spec`, `build`, `review`,
  `revise`, `report`. `round` is the review round (omit before the first review). `candidate` is
  the full SHA copied from Git (the pane shortens it); `blocking` / `followup` count open findings
  by disposition. `roles` lists the roles working on the task now or last: `status` is one of
  `running`, `done`, `waiting`, `blocked`, `idle`; `state` is the short Turkish word the owner
  reads (`inceliyor`, `teslim etti`, `sırada`, `BLOCKED · <why>`).

Keep the texts short (one line each in a 380 px pane). Never put secrets, tokens or file contents
in the file.
