import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Decision, Mode, RoleStatus, StatusView, Task } from '../types'
import { STAGE_LABELS, baseName, clockOf, expandHome, isInside, parseFolders, parseStatus, trimSlash } from './status'
import { BAD, CLAY, MUTED, OK, dotSvg, meterSvg, stagesSvg } from './svg'

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
  { shape: 'status-2' },
)

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
    `Pane'in okuduğu durum dosyası: ${file} (biçimi skill'in references/status.md dosyasında).`,
  ].join(' ')

// A press in the pane reaches the Lead as the owner's own message.
async function say($: EngineInterface, text: string) {
  await $.prompt.submit({ text, asUser: true })
}

async function refresh($: EngineInterface, file: string) {
  const prev = await read($, status)
  if (!(await $.fs.exists(file))) {
    if (prev.file !== file || prev.data || prev.error) {
      await update($, status, () => ({ file, mtime: 0, data: null, error: null }))
    }
    return
  }
  const { mtimeMs } = await $.fs.stat(file)
  if (prev.file === file && prev.mtime === mtimeMs) return
  try {
    const text = await $.fs.read(file)
    const data = parseStatus(typeof text === 'string' ? text : '')
    await update($, status, () => ({ file, mtime: mtimeMs, data, error: null }))
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await update($, status, () => ({ file, mtime: mtimeMs, data: prev.data, error }))
  }
}

async function setMode($: EngineInterface, isOn: boolean) {
  const was = await read($, mode)
  if (was.isOn === isOn) return
  await update($, mode, () => ({ isOn, source: isOn ? 'switch' : 'off' }))
  const { file } = await read($, status)
  // The system prompt of a running thread does not change mid-session: tell the model in a row.
  await $.session.append({
    message: {
      type: 'user',
      content: [
        {
          type: 'text',
          text: isOn
            ? `[Agent Team modu açıldı] ${leadText(file)}`
            : '[Agent Team modu kapandı] Bu oturum artık normal bir Claude oturumu; agent-team akışını bırak.',
        },
      ],
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
    const file = `${root}/status/${baseName(e.cwd)}.json`
    await refresh($, file)
    $.clock.every(POLL_MS, () => refresh($, file))

    const current = await read($, mode)
    if (!current.isOn && isInside(e.cwd, parseFolders(options.teamFolders, home))) {
      await update($, mode, () => ({ isOn: true, source: 'folder' }))
    }
    if ((await read($, mode)).isOn) void $.ui.open(PANE_OPEN)

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
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : undefined
    const dot = (hex: string, themeKey: string, alt: string) =>
      Svg ? <Svg source={dotSvg(hex)} alt={alt} width={8} height={8} /> : <Text color={themeKey}>●</Text>
    const m = await read($, mode)
    const { file, data, error } = await read($, status)

    const decisionCard = (d: Decision) => (
      <Box key={`d-${d.id}`} {...CARD}>
        <Box flexDirection="column">
          {d.kind && <Text size="caption" weight="medium" color="claude">{d.kind}</Text>}
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

    const taskCard = (t: Task) => (
      <Box key={`t-${t.id}`} {...CARD}>
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" gap="sm">
            <Text weight="semibold" wrap="truncate-end">{t.title}</Text>
            {t.round !== undefined && <Text size="caption" dimColor>Tur {t.round}</Text>}
          </Box>
          {t.branch && <Text size="caption" mono dimColor wrap="truncate-end">{t.branch}</Text>}
        </Box>
        <Box flexDirection="column">
          {Svg ? (
            <Svg source={stagesSvg(t.stage)} alt={`${STAGE_LABELS[t.stage]}, 5 aşamanın ${t.stage + 1}.`} />
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
      </Box>
    )

    const updated = clockOf(data?.updatedAt)
    const lim = data?.limits
    const usage = (
      [
        ['5 saatlik', lim?.fiveHourPct],
        ['Haftalık', lim?.weeklyPct],
      ] as const
    ).filter((u): u is readonly [typeof u[0], number] => u[1] !== undefined)
    const running = data ? data.tasks.filter(t => t.roles.some(r => r.status === 'running')).length : 0

    return (
      <Box flexDirection="column" gap="md" padding="sm">
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

        {data && !m.isOn && <Button key="pane-team-on" variant="primary" label="Bu oturumda Agent Team'i aç" onPress={() => void setMode($, true)} />}

        {error && <Text color="error" size="caption">Durum dosyası okunamadı: {error}</Text>}

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
                  <Button key={`ex-${i}`} label={`${x}…`} onPress={() => void $.prompt.fill({ text: x, mode: 'replace' })} />
                ))}
              </Box>
            ) : (
              <Button key="pane-team-on" variant="primary" label="Bu sohbette aç" onPress={() => void setMode($, true)} />
            )}
            <Box flexDirection="column" gap="xs">
              <Text weight="semibold">Nasıl işler</Text>
              {STEPS.map((s, i) => (
                <Text size="caption" dimColor>{`${i + 1}. ${s}`}</Text>
              ))}
            </Box>
            <Box {...CARD} gap="xs">
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

        {usage.length > 0 &&
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

        {data && data.decisions.length > 0 && (
          <Box flexDirection="column" gap="sm">
            <Box flexDirection="row" alignItems="center" gap="xs">
              {dot(CLAY, 'claude', 'karar bekliyor')}
              <Text weight="semibold">Senin sıran</Text>
              <Text dimColor size="caption">{`${data.decisions.length} karar`}</Text>
            </Box>
            {data.decisions.map(decisionCard)}
          </Box>
        )}

        {data && data.tasks.length > 0 && (
          <Box flexDirection="column" gap="sm">
            <Box flexDirection="row" justifyContent="space-between">
              <Text weight="semibold">Görevler</Text>
              <Text size="caption" dimColor>{`${running} çalışıyor · ${data.tasks.length} görev`}</Text>
            </Box>
            {data.tasks.map(taskCard)}
          </Box>
        )}
      </Box>
    )
  })
}
