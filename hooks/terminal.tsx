import type { EngineInterface } from 'claude-code'

import type { Decision, RoleStatus, Task } from '../types'
import { STAGE_LABELS } from './status'

// The terminal drawing of the pane and the footer (approved design "Terminal arayüzü · şimdi ve öneri"):
// text and theme colors only, no card fill, no Svg; state is a glyph, never a color alone; every press has a key.
export type UI = Pick<ReturnType<EngineInterface['ui']['resolve']>, 'Box' | 'Button' | 'Text'>

export const TBOX = { flexDirection: 'column', borderStyle: 'single', borderColor: 'subtle', paddingX: 1 } as const
export const hk = (key: string) => ({ plain: true, hotkey: key }) as const
// Not b l p s t (back, pause, ask, pane are the pane's own); "o" last, as pane-team-on takes it.
const TASK_KEYS = 'acdefghijkmno'

const GLYPH: Record<RoleStatus, [string, string]> = {
  running: ['◐', 'claude'],
  done: ['✓', 'success'],
  waiting: ['·', 'inactive'],
  blocked: ['✗', 'error'],
  idle: ['○', 'inactive'],
}

// 10 cells of 8 eighths: floor(pct * 80 / 100) eighths filled, ▏▎▍▌▋▊▉ for a part cell.
export function bar(pct: number) {
  const eighths = Math.floor((Math.min(100, Math.max(0, pct)) * 80) / 100)
  const part = eighths % 8
  const full = (eighths - part) / 8
  return { fill: '█'.repeat(full) + (part ? ' ▏▎▍▌▋▊▉'[part] : ''), rest: '░'.repeat(10 - full - (part ? 1 : 0)) }
}

export function termHeader({ Box, Button, Text }: UI, sub: string, paused: boolean | undefined, say: (t: string) => void) {
  return (
    <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap={2}>
      <Text color="claude" weight="bold">AGENT TEAM</Text>
      <Text dimColor>{sub}</Text>
      {paused === undefined ? null : paused ? (
        <Button key="resume" label="Devam" onPress={() => say('Devam et')} {...hk('p')} />
      ) : (
        <Button key="pause" label="Pause" onPress={() => say('Pause')} {...hk('p')} />
      )}
    </Box>
  )
}

export function termUsage({ Text }: UI, rows: readonly (readonly [string, number])[]) {
  if (!rows.length) return null
  return (
    <Text>
      {rows.map(([label, pct], i) => {
        const { fill, rest } = bar(pct)
        return [
          i ? '   ' : '',
          <Text dimColor>{label.padEnd(6)}</Text>,
          <Text color={pct >= 80 ? 'claude' : 'text'}>{fill}</Text>,
          <Text color="subtle">{rest}</Text>,
          ` ${pct}%`,
        ]
      })}
    </Text>
  )
}

export function termDecisions({ Box, Button, Text }: UI, decisions: Decision[], say: (t: string) => void) {
  let n = 0
  return (
    <Box flexDirection="column" gap={1}>
      <Text color="claude">{`◆ ${'Senin sıran'.toLocaleUpperCase('tr')} · ${decisions.length} karar`}</Text>
      {decisions.map(d => (
        <Box key={`d-${d.id}`} {...TBOX}>
          {d.kind && <Text color="claude">{d.kind}</Text>}
          <Text>{d.text}</Text>
          {d.meta && <Text dimColor>{d.meta}</Text>}
          {d.options.length > 0 && (
            <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
              {d.options.map((o, i) => (
                <Button key={`d-${d.id}-${i}`} label={o} onPress={() => say(`Karar (${d.id}): ${o}`)} {...(n < 9 ? hk(String(++n)) : { plain: true as const })} />
              ))}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  )
}

// hasOn: pane-team-on is drawn and owns "o", so no task takes it.
export function termTasks({ Box, Button, Text }: UI, tasks: Task[], running: number, hasOn: boolean, open: (id: string) => void) {
  const keys = hasOn ? TASK_KEYS.slice(0, -1) : TASK_KEYS
  return (
    <Box flexDirection="column" gap={1}>
      <Text weight="bold">{`${'Görevler'.toLocaleUpperCase('tr')} · ${running} çalışıyor`}</Text>
      {tasks.map((t, ti) => {
        const bits: (string | JSX.Element)[] = []
        if (t.blocking) bits.push(<Text color="error" weight="bold">{`${t.blocking} blocking`}</Text>)
        if (t.followup) bits.push(...(bits.length ? [' · '] : []), <Text>{`${t.followup} follow-up`}</Text>)
        return (
          <Box key={`t-${t.id}`} flexDirection="column">
            <Box flexDirection="row" justifyContent="space-between" gap={2}>
              <Button key={`detail-${t.id}`} label={t.title} onPress={() => open(t.id)} {...(keys[ti] ? hk(keys[ti]) : { plain: true as const })} />
              {t.round !== undefined && <Text dimColor>{`Tur ${t.round}`}</Text>}
            </Box>
            <Text>
              {STAGE_LABELS.flatMap((l, i) => {
                const label = l.toLowerCase()
                const part =
                  i < t.stage ? <Text dimColor>{`✓ ${label}`}</Text>
                  : i === t.stage ? <Text color="claude" weight="bold">{`◉ ${label}`}</Text>
                  : <Text color="inactive">{`○ ${label}`}</Text>
                return i ? ['  ', part] : [part]
              })}
            </Text>
            {t.roles.length > 0 && (
              <Box flexDirection="column" marginLeft={2}>
                {t.roles.map((r, i) => (
                  <Box key={`t-${t.id}-r-${i}`} flexDirection="row" gap={1}>
                    <Text color={GLYPH[r.status][1]}>{GLYPH[r.status][0]}</Text>
                    <Text wrap="truncate-end">{r.name}</Text>
                    {r.state && <Text color={r.status === 'blocked' ? 'error' : undefined} dimColor={r.status !== 'blocked'}>{r.state}</Text>}
                  </Box>
                ))}
              </Box>
            )}
            {t.candidate && <Text><Text dimColor>{t.candidate.slice(0, 7)}</Text>{bits.length > 0 && '   '}{bits}</Text>}
          </Box>
        )
      })}
    </Box>
  )
}

export function termHint({ Text }: UI) {
  const k = (s: string) => <Text color="claude">{s}</Text>
  return <Text dimColor>{k('a-o')} ayrıntı  {k('1-9')} karar  {k('p')} pause  {k('esc')} çık</Text>
}

export function termFooter({ Box, Button, Text }: UI, isOn: boolean, modes: readonly string[], toggle: () => void, openPane: () => void) {
  return (
    <Box flexDirection="row" alignItems="center" gap={2}>
      <Button key="team-mode" plain label={isOn ? '◉ agent team' : '○ agent team'} onPress={toggle} />
      <Button key="team-pane-open" label="pane" onPress={openPane} {...hk('t')} />
      {modes.length > 0 && <Text dimColor>{modes.join(' & ')}</Text>}
    </Box>
  )
}
