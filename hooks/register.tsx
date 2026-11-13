import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Decision, DirEntry, Mode, Other, RoleStatus, StatusView, Task, TaskState } from '../types'
import { ANNOUNCE, OPEN_ROW, STAGE_LABELS, announcedFile, baseName, clockOf, countStates, decisionTask, expandHome, isInside, otherFiles, otherSession, parseFolders, parseStatus, trimSlash } from './status'
import { AMBER, BAD, CLAY, MUTED, OK, dotSvg, meterSvg, stagesSvg } from './svg'
import { TBOX, hk, termDecisions, termFooter, termHeader, termDetail, termHint, termOthers, termTasks, termUsage } from './terminal'

const PANE = 'agent-team'
const PANE_OPEN = { id: PANE, title: 'Agent Team', columns: 48 } as const
const POLL_MS = 3000

// Change a tag when that value's fields change: it declines what an earlier version stored.
const mode = atom({ plugin: 'agent-team', key: 'mode' } as const, { isOn: false, source: 'off' } as Mode, {
  shape: 'mode-1',
})
const status = atom(
  { plugin: 'agent-team', key: 'status' } as const,
  { file: '', mtime: 0, data: null, error: null } as StatusView,
  { shape: 'status-3' },
)
// The task whose detail view the pane shows (null: the list). Session state, not in the file.
const detail = atom({ plugin: 'agent-team', key: 'detail' } as const, null as string | null, { shape: 'detail-1' })
// Other team sessions' pending decisions (read-only strip) and whether it is open. Session state, starts collapsed.
const others = atom({ plugin: 'agent-team', key: 'others' } as const, [] as Other[], { shape: 'others-2' })
const othersOpen = atom({ plugin: 'agent-team', key: 'othersOpen' } as const, false, { shape: 'others-open-1' })

// Raw colors that read on a light and a dark pane alike (a theme key has no card fill).
const CARD = {
  flexDirection: 'column',
  gap: 'sm',
  padding: 'sm',
  borderStyle: 'round',
  borderColor: 'rgba(128,128,128,0.28)',
  backgroundColor: 'rgba(128,128,128,0.10)',
} as const
// The empty pane (approved design "Boş pane").
const EXAMPLES = ['Bir hatayı düzelt: ', 'Yeni özellik ekle: ', 'Şu değişikliği incelet: ']
const STEPS = [
  'Analyst neyin "bitti" sayılacağını yazar.',
  'Developer kendi dalında yazar, tek aday SHA teslim eder.',
  "QA (Astra) inceler; GO olunca main'e birleşir.",
  'Karar gerekince burada "Senin sıran" çıkar.',
]
const ROSTER = [
  ['Analyst', 'Fable 5.2'],
  ['Analyst 2', 'GPT-6 Astra'],
  ['Developer', 'Sonnet 5.5'],
  ['Developer (zor iş)', 'Opus 5.5'],
  ['QA', 'GPT-6 Astra'],
  ['QA 2 · canlı', 'Opus 5.5'],
  ['Helper', 'Haiku 5.5'],
] as const
// Task state chips and the blocked edge (approved design "Takıldı / bekliyor durumları").
const STATE_CHIP: Record<TaskState, [string, string, string]> = {
  running: ['◐ Çalışıyor', 'rgba(217,119,87,0.18)', '#F0B9A5'],
  blocked: ['✗ Takıldı', 'rgba(224,108,108,0.22)', '#F2A3A3'],
  waiting: ['⏸ Bekliyor', 'rgba(229,192,123,0.18)', '#E5CC7A'],
}
const BLOCKED_EDGE = 'rgba(224,108,108,0.45)'
const BLOCKED_INK = '#F2A3A3'
const CHIP_BLOCKING = 'rgba(224,108,108,0.18)'
const CHIP = 'rgba(128,128,128,0.2)'

const DOT_HEX: Record<RoleStatus, string> = { running: CLAY, done: OK, blocked: BAD, waiting: MUTED, idle: MUTED }
const DOT_ALT: Record<RoleStatus, string> = {
  running: 'çalışıyor',
  done: 'bitti',
  blocked: 'takıldı',
  waiting: 'sırada',
  idle: 'boşta',
}

const DOT: Record<RoleStatus, string> = {
  running: 'claude',
  done: 'success',
  blocked: 'error',
  waiting: 'inactive',
  idle: 'inactive',
}

const leadText = (file: string) =>
  [
    "Bu oturum bir Agent Team oturumu (agent-team plugin'i). Sen Lead'sin:",
    "sahibin her mesajını agent-team skill'inin akışıyla ele al; /agent-team yazılması gerekmez.",
    "Skill bu oturumda henüz yüklenmediyse önce Skill aracıyla agent-team skill'ini yükle.",
    `${ANNOUNCE} ${file} (biçimi skill'in references/status.md dosyasında).`,
  ].join(' ')

// A press in the pane reaches the Lead as the owner's own message.
async function say($: EngineInterface, text: string) {
  await $.prompt.submit({ text, asUser: true })
}

const openRow = (file: string) => `${OPEN_ROW}${leadText(file)}`

// The row that tells the Lead (and, later, a resumed session) the status path.
// The system prompt of a running thread does not change mid-session: tell the model in a row.
const announce = ($: EngineInterface, file: string) =>
  $.session.append({
    message: { type: 'user', content: [{ type: 'text', text: openRow(file) }] },
  })

// The one place the status view changes: an open detail whose task is not in the new view is closed
// (file deleted, task removed), so the same id coming back does not reopen it by itself.
async function setView($: EngineInterface, view: StatusView) {
  await update($, status, () => view)
  const open = await read($, detail)
  if (open && !view.data?.tasks.some(t => t.id === open)) await update($, detail, () => null)
}

async function refresh($: EngineInterface, file: string) {
  const prev = await read($, status)
  if (!(await $.fs.exists(file))) {
    if (prev.file !== file || prev.data || prev.error) await setView($, { file, mtime: 0, data: null, error: null })
    return
  }
  const { mtimeMs } = await $.fs.stat(file)
  if (prev.file === file && prev.mtime === mtimeMs) return
  try {
    const text = await $.fs.read(file)
    await setView($, { file, mtime: mtimeMs, data: parseStatus(typeof text === 'string' ? text : ''), error: null })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await setView($, { file, mtime: mtimeMs, data: prev.data, error })
  }
}

// The other files of the status folder (see otherFiles): untrusted data, read-only; what fails to list, read or parse is skipped.
// `seen` keeps the parse of a file by its size and mtime, so a quiet poll is one listing and no reads.
type Seen = Map<string, { size: number; mtimeMs: number; other?: Other }>
async function scanOthers($: EngineInterface, dir: string, own: string, seen: Seen) {
  const one = async (e: DirEntry) => {
    const hit = seen.get(e.name)
    if (hit && hit.size === e.size && hit.mtimeMs === e.mtimeMs) return hit.other
    let text: unknown
    try {
      text = await $.fs.read(`${dir}/${e.name}`)
    } catch {
      return undefined
    }
    let other: Other | undefined
    try {
      other = otherSession(e, parseStatus(typeof text === 'string' ? text : ''))
    } catch {}
    seen.set(e.name, { size: e.size, mtimeMs: e.mtimeMs, other })
    return other
  }
  // Nothing in here may throw out: another session's file must not stop this session's poll or start.
  let next: Other[] = []
  try {
    const files = otherFiles(await $.fs.list(dir), dir, own, await $.clock.now())
    const names = new Set(files.map(f => f.name))
    for (const name of seen.keys()) if (!names.has(name)) seen.delete(name)
    next = (await Promise.all(files.map(one))).filter((o): o is Other => !!o)
  } catch {}
  try {
    if (JSON.stringify(await read($, others)) !== JSON.stringify(next)) await update($, others, () => next)
  } catch {}
}

async function setMode($: EngineInterface, isOn: boolean) {
  const was = await read($, mode)
  if (was.isOn === isOn) return
  await update($, mode, () => ({ isOn, source: isOn ? 'switch' : 'off' }))
  const { file } = await read($, status)
  if (isOn) await announce($, file)
  else
    await $.session.append({
      message: {
        type: 'user',
        content: [{ type: 'text', text: '[Agent Team modu kapandı] Bu oturum artık normal bir Claude oturumu; agent-team akışını bırak.' }],
      },
    })
  if (isOn) await $.ui.open(PANE_OPEN)
  else await $.ui.close({ id: PANE })
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'team', description: 'Agent Team modunu aç ya da kapat' })
    await $.command.register({ name: 'team-pane', description: "Agent Team pane'ini aç" })

    const home = (await $.env.get('HOME')) ?? ''
    const root = trimSlash(expandHome(String(options.evidenceRoot || '~/agent-team-evidence'), home))
    // One file per session: sessions in one folder (the SSH server's home) must not share a status.
    // A session keeps its first file whatever its id becomes: the one the atom holds (a reload), else the
    // last one this plugin announced in the history (a resume under a new id), if it is on disk; else a new
    // one. No usable id (the call fails or answers empty): the old <project>.json.
    const dir = `${root}/status`
    const held = (await read($, status)).file
    const rows = await $.session.messages().catch(() => [])
    const said = announcedFile(rows.filter(m => m.role === 'user').map(m => m.text), dir, openRow)
    let file = ''
    for (const old of [held, said]) if (!file && old && (await $.fs.exists(old))) file = old
    if (!file) {
      const sid = String(await $.session.id().catch(() => '')).slice(0, 8)
      file = `${dir}/${baseName(e.cwd)}${sid ? `--${sid}` : ''}.json`
    }
    const seen: Seen = new Map()
    // Independent: one failing stops neither the other nor the clock.
    const poll = () => Promise.allSettled([refresh($, file), scanOthers($, dir, file, seen)])
    await poll()
    $.clock.every(POLL_MS, poll)

    const current = await read($, mode)
    if (!current.isOn && isInside(e.cwd, parseFolders(options.teamFolders, home))) {
      await update($, mode, () => ({ isOn: true, source: 'folder' }))
    }
    if ((await read($, mode)).isOn) {
      void $.ui.open(PANE_OPEN)
      // Team mode by folder writes no switch row: tell the Lead the path once per path, so a resume finds it.
      if (said !== file) await announce($, file).catch(() => undefined)
    }

    return next(e)
  })

  // Every owner prompt in team mode carries the Lead role beside it, unseen by the owner. Not a
  // system-prompt section: another plugin may pass prompt.compose on past this one, and a running
  // thread's system prompt does not change.
  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta || !(await read($, mode)).isOn) return next(e)
    const { file } = await read($, status)
    return next({ ...e, context: [...(e.context ?? []), leadText(file)] })
  })

  on('command.run', { command: 'team' }, async $ => {
    const isOn = !(await read($, mode)).isOn
    await setMode($, isOn)
    return { text: isOn ? "Agent Team açık: bu oturumda her mesaj Lead'e gider." : 'Agent Team kapandı.' }
  })

  on('command.run', { command: 'team-pane' }, async $ => {
    await $.ui.open(PANE_OPEN)
    return { text: "Agent Team pane'i açıldı." }
  })

  // A chip left of the footer's mode labels turns team mode on and off, a Pane button next to it opens the pane; nothing is drawn above the prompt.
  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const { isOn } = await read($, mode)
    if (e.surface === 'terminal') return termFooter($.ui.resolve(e), isOn, e.props.modes, () => void setMode($, !isOn), () => void $.ui.open(PANE_OPEN))
    return (
      <Box flexDirection="row" alignItems="center" gap="sm">
        {/* Desktop draws this slot dim and ignores text colors (seen live): the variant is what shows the state. */}
        <Button
          key="team-mode"
          variant={isOn ? 'primary' : 'secondary'}
          label={isOn ? '● Agent Team' : '○ Agent Team'}
          onPress={() => void setMode($, !isOn)}
        />
        <Button key="team-pane-open" variant="secondary" label="Pane" onPress={() => void $.ui.open(PANE_OPEN)} />
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')}</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    // The terminal draws no Svg (its table may still name one): there the bars stay text.
    const term = e.surface === 'terminal'
    const Svg = !term && 'Svg' in ui ? ui.Svg : undefined
    // On the terminal every Button is plain with its key; a card is a single-line box in a theme color.
    const key = (k: string) => (term ? hk(k) : {})
    const card = term ? TBOX : CARD
    const dot = (hex: string, themeKey: string, alt: string) =>
      Svg ? <Svg source={dotSvg(hex)} alt={alt} width={8} height={8} /> : <Text color={themeKey}>●</Text>
    const m = await read($, mode)
    const other = await read($, others)
    const otherOpen = await read($, othersOpen)
    const otherTotal = other.reduce((n, o) => n + o.count, 0)
    const { file, data, error } = await read($, status)
    const openId = await read($, detail)
    const open = openId ? data?.tasks.find(t => t.id === openId) : undefined

    const errorLine = error && <Text color="error" size="caption">Durum dosyası okunamadı: {error}</Text>

    const decisionCard = (d: Decision) => {
      const { kind, blocked } = decisionTask(d, data?.tasks ?? [])
      return (
      <Box key={`d-${d.id}`} {...CARD} borderColor={blocked ? BLOCKED_EDGE : CARD.borderColor}>
        <Box flexDirection="column">
          {kind && <Text size="caption" weight="medium" color={blocked ? BLOCKED_INK : 'claude'}>{kind}</Text>}
          <Text>{d.text}</Text>
          {d.meta && <Text size="caption" mono dimColor>{d.meta}</Text>}
        </Box>
        {d.options.length > 0 && (
          <Box flexDirection="row" gap="xs" flexWrap="wrap">
            {d.options.map((o, i) => (
              <Button
                key={`d-${d.id}-${i}`}
                label={o}
                variant={i === 0 ? 'primary' : 'secondary'}
                onPress={() => void say($, `Karar (${d.id}): ${o}`)}
              />
            ))}
          </Box>
        )}
      </Box>
      )
    }

    // Other sessions' decisions, read-only: options are text, nothing here sends or fills (the owner answers in that session).
    const toggleOthers = () => void update($, othersOpen, v => !v)
    const othersDesktop = () => {
      const counts = other.map(o => `${o.project} · ${o.count} karar${o.stuckCount ? ` (${o.stuckCount} takıldı)` : ''}`).join(' · ')
      return otherOpen ? (
        <Box flexDirection="column" gap="sm">
          <Box flexDirection="row" alignItems="center" justifyContent="space-between">
            <Box flexDirection="row" alignItems="center" gap="xs">
              {dot(AMBER, 'warning', 'diğer oturumlarda karar bekliyor')}
              <Text weight="semibold">Diğer oturumlar</Text>
              <Text dimColor size="caption">{`${otherTotal} karar`}</Text>
            </Box>
            <Button key="others-toggle" label="Gizle" onPress={toggleOthers} />
          </Box>
          {other.map(o => (
            <Box key={`other-${o.file}`} {...CARD} borderColor={o.stuckCount ? BLOCKED_EDGE : CARD.borderColor}>
              <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
                <Text weight="semibold" wrap="truncate-end">{o.name}</Text>
                <Text size="caption" dimColor>{`son yazım ${o.when}`}</Text>
              </Box>
              {o.decisions.map((d, i) => (
                <Box key={`odec-${o.file}-${i}`} flexDirection="column">
                  {d.kind && <Text size="caption" weight="medium" color={d.stuck ? BLOCKED_INK : 'claude'}>{d.kind}</Text>}
                  <Text>{d.text}</Text>
                  {d.options.length > 0 && <Text size="caption" dimColor>{d.options.join(' · ')}</Text>}
                </Box>
              ))}
              {o.count > o.decisions.length && <Text size="caption" dimColor>{`+${o.count - o.decisions.length} karar daha`}</Text>}
            </Box>
          ))}
          <Text size="caption" dimColor>Cevabı o oturumda ver; seçenekler buradan gönderilemez. 24 saattir güncellenmeyen dosyalar sayılmaz.</Text>
        </Box>
      ) : (
        <Box {...CARD} flexDirection="row" alignItems="center" borderColor="rgba(229,192,123,0.40)" backgroundColor="rgba(229,192,123,0.08)">
          {dot(AMBER, 'warning', 'diğer oturumlarda karar bekliyor')}
          <Box flexDirection="column" flexGrow={1}>
            <Text weight="semibold">{`Diğer oturumlarda ${otherTotal} karar bekliyor`}</Text>
            <Text size="caption" dimColor>{counts}</Text>
          </Box>
          <Button key="others-toggle" label="Göster" onPress={toggleOthers} />
        </Box>
      )
    }

    const stateChip = (t: Task) => (
      <Box key={`chip-state-${t.id}`} backgroundColor={STATE_CHIP[t.state][1]} paddingX="xs">
        <Text size="caption" weight="medium" color={STATE_CHIP[t.state][2]}>{STATE_CHIP[t.state][0]}</Text>
      </Box>
    )
    const reason = (t: Task) =>
      t.reason && <Text size="caption" color={t.state === 'blocked' ? BLOCKED_INK : undefined} dimColor={t.state !== 'blocked'}>{t.reason}</Text>

    const taskCard = (t: Task) => (
      <Box key={`t-${t.id}`} {...CARD} borderColor={t.state === 'blocked' ? BLOCKED_EDGE : CARD.borderColor}>
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
            <Text weight="semibold" wrap="truncate-end">{t.title}</Text>
            <Box flexDirection="row" alignItems="center" gap="xs">
              {t.round !== undefined && <Text size="caption" dimColor>Tur {t.round}</Text>}
              {stateChip(t)}
            </Box>
          </Box>
          {reason(t)}
          {t.branch && <Text size="caption" mono dimColor wrap="truncate-end">{t.branch}</Text>}
        </Box>
        <Box flexDirection="column">
          {Svg ? (
            <Svg source={stagesSvg(t.stage, 5, t.state === 'blocked')} alt={`${STAGE_LABELS[t.stage]}, 5 aşamanın ${t.stage + 1}.`} />
          ) : (
            <Text size="caption">
              {STAGE_LABELS.map((_, i) => (
                <Text color={i < t.stage ? 'text' : i === t.stage ? 'claude' : 'inactive'}>━━━ </Text>
              ))}
            </Text>
          )}
          <Text size="caption" dimColor>{`${STAGE_LABELS[t.stage]} · ${t.stage + 1}/5`}</Text>
        </Box>
        {t.roles.length > 0 && (
          <Box flexDirection="column" gap="xs">
            {t.roles.map((r, i) => (
              <Box key={`t-${t.id}-r-${i}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
                <Box flexDirection="row" alignItems="center" gap="xs">
                  {dot(DOT_HEX[r.status], DOT[r.status], DOT_ALT[r.status])}
                  <Text wrap="truncate-end">{r.name}</Text>
                </Box>
                <Text size="caption" color={r.status === 'blocked' ? 'error' : undefined} dimColor={r.status !== 'blocked'}>{r.state}</Text>
              </Box>
            ))}
          </Box>
        )}
        {t.candidate && (
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
            <Text size="caption" mono dimColor>aday {t.candidate.slice(0, 7)}</Text>
            <Box flexDirection="row" gap="xs">
              {!!t.blocking && (
                <Box key={`chip-blocking-${t.id}`} backgroundColor={CHIP_BLOCKING} paddingX="xs">
                  <Text size="caption" color="error" weight="medium">{`${t.blocking} blocking`}</Text>
                </Box>
              )}
              {!!t.followup && (
                <Box key={`chip-followup-${t.id}`} backgroundColor={CHIP} paddingX="xs">
                  <Text size="caption">{`${t.followup} follow-up`}</Text>
                </Box>
              )}
            </Box>
          </Box>
        )}
        <Button key={`detail-${t.id}`} label="Ayrıntı ›" onPress={() => void update($, detail, () => t.id)} />
      </Box>
    )

    const detailView = (t: Task) => {
      const last = t.rounds?.at(-1)
      return (
        <Box flexDirection="column" gap="md" padding="sm">
          <Button key="detail-back" label="‹ Görevler" {...key('b')} onPress={() => void update($, detail, () => null)} />
          {errorLine}
          <Box flexDirection="column">
            <Text size="heading" weight="semibold">{t.title}</Text>
            <Box flexDirection="row" alignItems="center" gap="xs">
              {stateChip(t)}
              {reason(t)}
            </Box>
            {t.branch && <Text size="caption" mono dimColor wrap="truncate-end">{t.branch}</Text>}
            {t.candidate && <Text size="caption" mono dimColor>{t.candidate.slice(0, 7)}</Text>}
            {last && <Text size="caption" dimColor>{`${last.verdict} · ${last.n} tur`}</Text>}
          </Box>
          {t.rounds && (
            <Box flexDirection="column" gap="sm">
              <Text weight="semibold">Turlar</Text>
              {t.rounds.map((r, i) => (
                <Box key={`round-${i}`} {...card}>
                  <Box flexDirection="row" justifyContent="space-between" gap="sm">
                    <Text weight="semibold" color={r.verdict === 'GO' ? 'success' : r.verdict.startsWith('NO') ? 'error' : undefined}>{`Tur ${r.n} · ${r.verdict}`}</Text>
                    {r.candidate && <Text size="caption" mono dimColor>{r.candidate.slice(0, 7)}</Text>}
                  </Box>
                  {r.findings.map((f, j) => {
                    const tag = [f.severity, f.origin].filter(Boolean).join(' · ')
                    return (
                    <Box key={`round-${i}-f-${j}`} flexDirection="column">
                      {!!tag && <Text size="caption" weight="medium" color={f.severity === 'BLOCKING' ? 'error' : undefined}>{tag}</Text>}
                      <Text>{f.what}</Text>
                      {f.where && <Text size="caption" mono dimColor>{f.where}</Text>}
                    </Box>
                    )
                  })}
                  {r.note && <Text size="caption" dimColor>{r.note}</Text>}
                </Box>
              ))}
            </Box>
          )}
          {t.evidence && (
            <Box flexDirection="column" gap="xs">
              <Text weight="semibold">Kanıt</Text>
              {t.evidence.map((e, i) => (
                <Box key={`ev-${i}`} flexDirection="column">
                  <Text>{e.label}</Text>
                  {/* Not a Link: the desktop surface draws a non-https href as plain text (engine report in the test), so the path is mono text. */}
                  <Text size="caption" mono dimColor wrap="truncate-middle">{e.path}</Text>
                </Box>
              ))}
            </Box>
          )}
          <Button key="detail-ask" label="Lead'e sor" {...key('s')} onPress={() => void $.prompt.fill({ text: `${t.title} hakkında: `, mode: 'replace' })} />
        </Box>
      )
    }

    if (open && term) {
      return (
        <Box flexDirection="column" padding="sm">
          {errorLine}
          {termDetail(
            ui,
            open,
            () => void update($, detail, () => null),
            () => void $.prompt.fill({ text: `${open.title} hakkında: `, mode: 'replace' }),
          )}
        </Box>
      )
    }
    if (open) return detailView(open)

    const updated = clockOf(data?.updatedAt)
    const lim = data?.limits
    const usage = (
      [
        ['5 saatlik', lim?.fiveHourPct],
        ['Haftalık', lim?.weeklyPct],
      ] as const
    ).filter((u): u is readonly [typeof u[0], number] => u[1] !== undefined)
    const n = countStates(data?.tasks ?? [])
    const showOn = !!data && !m.isOn

    return (
      <Box flexDirection="column" gap="md" padding="sm">
        {term ? (
          termHeader(
            ui,
            [data?.lead && `Lead · ${data.lead}`, updated && updated, !m.isOn && 'mod kapalı'].filter(Boolean).join(' · ') || 'Lead',
            data ? !!data.paused : undefined,
            t => void say($, t),
          )
        ) : (
        <Box flexDirection="row" justifyContent="space-between" alignItems="flex-start" gap="sm">
          <Box flexDirection="column">
            <Text size="title">Agent Team</Text>
            <Text size="caption" dimColor>
              {[data?.lead && `Lead · ${data.lead}`, updated && `${updated}'de güncellendi`, !m.isOn && 'mod kapalı']
                .filter(Boolean)
                .join(' · ') || 'Lead'}
            </Text>
          </Box>
          {data &&
            (data.paused ? (
              <Button key="resume" label="Devam" onPress={() => void say($, 'Devam et')} />
            ) : (
              <Button key="pause" label="Pause" onPress={() => void say($, 'Pause')} />
            ))}
        </Box>
        )}

        {otherTotal > 0 && (term ? termOthers(ui, other, otherOpen, toggleOthers) : othersDesktop())}

        {showOn && <Button key="pane-team-on" variant="primary" label="Bu oturumda Agent Team'i aç" {...key('o')} onPress={() => void setMode($, true)} />}

        {errorLine}

        {!data && !error && (
          <Box flexDirection="column" gap="md">
            <Box flexDirection="column" gap="xs">
              <Text size="heading" weight="semibold">{m.isOn ? 'Takım hazır' : 'Agent Team kapalı'}</Text>
              <Text size="caption" dimColor>
                {m.isOn
                  ? 'Görevi sohbete düz cümleyle yaz. Lead işi rollere dağıtır, sen yalnızca karar gerekince devreye girersin.'
                  : 'Açınca bu sohbet Lead olur ve her mesajın takıma gider. Alt satırdaki Agent Team hapı da aynı işi yapar.'}
              </Text>
            </Box>
            {m.isOn ? (
              <Box flexDirection="column" gap="xs">
                {EXAMPLES.map((x, i) => (
                  <Button key={`ex-${i}`} label={`${x}…`} {...key(String(i + 1))} onPress={() => void $.prompt.fill({ text: x, mode: 'replace' })} />
                ))}
              </Box>
            ) : (
              <Button key="pane-team-on" variant="primary" label="Bu sohbette aç" {...key('o')} onPress={() => void setMode($, true)} />
            )}
            <Box flexDirection="column" gap="xs">
              <Text weight="semibold">Nasıl işler</Text>
              {STEPS.map((s, i) => (
                <Text size="caption" dimColor>{`${i + 1}. ${s}`}</Text>
              ))}
            </Box>
            <Box {...card} gap="xs">
              <Box flexDirection="row" justifyContent="space-between">
                <Text weight="semibold">Takım</Text>
                <Text size="caption" dimColor>{`${ROSTER.length} rol hazır`}</Text>
              </Box>
              {ROSTER.map(([name, model]) => (
                <Box key={`roster-${name}`} flexDirection="row" justifyContent="space-between" gap="sm">
                  <Text>{name}</Text>
                  <Text size="caption" dimColor>{model}</Text>
                </Box>
              ))}
            </Box>
            <Text size="caption" mono dimColor wrap="truncate-middle">{file}</Text>
          </Box>
        )}

        {term && termUsage(ui, usage.map(([label, pct]) => [label === '5 saatlik' ? '5 sa' : 'hafta', pct] as const))}

        {!term && usage.length > 0 &&
          (Svg ? (
            <Box flexDirection="row" gap="md">
              {usage.map(([label, pct]) => (
                <Box key={`lim-${label}`} flexDirection="column" gap="xs" flexGrow={1}>
                  <Box flexDirection="row" justifyContent="space-between">
                    <Text size="caption" dimColor>{label}</Text>
                    <Text size="caption" tabular>{`%${pct}`}</Text>
                  </Box>
                  <Svg source={meterSvg(pct)} alt={`${label} kullanım %${pct}`} />
                </Box>
              ))}
            </Box>
          ) : (
            <Text size="caption" dimColor tabular>
              {usage.map(([label, pct]) => `${label} %${pct}`).join('   ·   ')}
            </Text>
          ))}

        {term && data && data.decisions.length > 0 && termDecisions(ui, data.decisions, data.tasks, t => void say($, t))}

        {term && data && data.tasks.length > 0 && termTasks(ui, data.tasks, n, showOn, id => void update($, detail, () => id))}

        {term && data && termHint(ui, otherTotal > 0)}

        {!term && data && data.decisions.length > 0 && (
          <Box flexDirection="column" gap="sm">
            <Box flexDirection="row" alignItems="center" gap="xs">
              {dot(CLAY, 'claude', 'karar bekliyor')}
              <Text weight="semibold">Senin sıran</Text>
              <Text dimColor size="caption">{`${data.decisions.length} karar`}</Text>
            </Box>
            {data.decisions.map(decisionCard)}
          </Box>
        )}

        {!term && data && data.tasks.length > 0 && (
          <Box flexDirection="column" gap="sm">
            <Box flexDirection="row" justifyContent="space-between">
              <Text weight="semibold">Görevler</Text>
              <Text size="caption" dimColor>{`${n.running} çalışıyor${n.blocked ? ` · ${n.blocked} takıldı` : ''}${n.waiting ? ` · ${n.waiting} bekliyor` : ''} · ${data.tasks.length} görev`}</Text>
            </Box>
            {data.tasks.map(taskCard)}
          </Box>
        )}
      </Box>
    )
  })
}
