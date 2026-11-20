import type { EngineInterface } from 'claude-code'

import type { BandSeg, Child, Decision, Forward, Other, Outbox, Role, RoleStatus, SessionLine, Task, TaskState } from '../types'
import { STAGE_LABELS, clip, cut, decisionTask, isBlocking, isPush, isStuck, kidCaption, pickedAt } from './status'

// The terminal drawing of the pane and the footer (approved design "Terminal arayüzü · şimdi ve öneri"):
// text and theme colors only, no card fill, no Svg; state is a glyph, never a color alone; every press has a key.
export type UI = Pick<ReturnType<EngineInterface['ui']['resolve']>, 'Box' | 'Button' | 'Text'>

export const TBOX = { flexDirection: 'column', borderStyle: 'single', borderColor: 'subtle', paddingX: 1 } as const
export const ROUND = { ...TBOX, borderStyle: 'round' } as const
// A press that goes through the outbox (the box could not be filled, or the desktop): the card says when the Lead reads it.
export const QUEUED = 'Sırada · Lead sıradaki adımda okuyacak'
export const QUEUED_PUSH = 'Sırada · Lead işini bitirince okuyacak'
export const hk = (key: string) => ({ plain: true, hotkey: key }) as const
// Not b l p s t (back, pause, ask, pane are the pane's own); "o" last, as pane-team-on takes it.
const TASK_KEYS = 'acdefghijkmno'

// A running role's glyph turns through these once per second (the `tick` atom); every other glyph is still.
export const FRAMES = ['◐', '◓', '◑', '◒']
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

// Two fixed rows: the title with the Pause / Devam button, then the dim sub line cut to one row, so a note ("sırada", "gönderildi") or the reopen day
// never wraps the header (a wrapping row's gap would add blank rows). `note`: what follows the label ("sırada", "gönderildi", or nothing).
export function termHeader({ Box, Button, Text }: UI, sub: string, paused: boolean | undefined, note: string, say: (t: string) => void) {
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" alignItems="center" gap={2}>
        <Text color="claude" weight="bold">AGENT TEAM</Text>
        {paused === undefined ? null : paused ? (
          <Button key="resume" label={note ? `Devam · ${note}` : 'Devam'} onPress={() => say('Devam et')} {...hk('p')} />
        ) : (
          <Button key="pause" label={note ? `Pause · ${note}` : 'Pause'} onPress={() => say('Pause')} {...hk('p')} />
        )}
      </Box>
      <Text dimColor wrap="truncate-end">{sub}</Text>
    </Box>
  )
}

// The band above the prompt (pane not drawn): the segments from `bandSegments`, two spaces, the one Button (key t, only after ctrl+x tab; never a digit).
const BAND_COLOR: Record<BandSeg['kind'], [string, boolean]> = {
  stale: ['warning', false],
  karar: ['claude', true],
  running: ['claude', false],
  blocked: ['error', true],
  others: ['warning', false],
}
export function termBand({ Box, Button, Text }: UI, segs: readonly BandSeg[], open: () => void) {
  return (
    <Box flexDirection="row" gap={2}>
      {segs.length > 0 && (
        <Text>
          {segs.map((s, i) => [i ? ' · ' : '', <Text color={BAND_COLOR[s.kind][0]} weight={BAND_COLOR[s.kind][1] ? 'bold' : undefined}>{s.text}</Text>])}
        </Text>
      )}
      <Button key="band-pane" label="pane" onPress={open} {...hk('t')} />
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

// A press writes the decision's line into the prompt box (`lines`: the decision lines now in it); `out`: what went through the outbox instead.
// A task session's decisions (`kids`, each with its task's title and the answers forwarded to it): after the own ones, digits run on, a push takes none;
// a press is `pressKid` (sent at once to that session).
export type KidView = { child: Child; title?: string; fwd: readonly Forward[] }
export function termDecisions({ Box, Button, Text }: UI, decisions: Decision[], tasks: Task[], press: (d: Decision, o: string) => void, lines: readonly string[], out: Outbox, kids: readonly KidView[] = [], pressKid: (c: Child, d: Decision, o: string) => void = () => undefined) {
  let n = 0
  return (
    <Box flexDirection="column" gap={1}>
      <Text color="claude">{`◆ ${'Senin sıran'.toLocaleUpperCase('tr')} · ${decisions.length + kids.reduce((t, k) => t + k.child.count, 0)} karar`}</Text>
      {decisions.map(d => {
        const { kind, blocked } = decisionTask(d, tasks)
        const at = pickedAt(lines, d)
        const queued = out.queue.find(q => q.id === d.id)
        const sentTo = out.sent.find(([id]) => id === d.id)?.[1]
        return (
        <Box key={`d-${d.id}`} {...TBOX} borderColor={blocked ? 'error' : TBOX.borderColor}>
          {kind && <Text color={blocked ? 'error' : 'claude'}>{kind}</Text>}
          <Text>{d.text}</Text>
          {d.meta && <Text dimColor>{d.meta}</Text>}
          {d.options.length > 0 && (
            <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
              {d.options.map((o, i) => {
                const key = n < 9 ? hk(String(++n)) : { plain: true as const }
                return i === at ? (
                  <Button key={`d-${d.id}-${i}`} label={o} onPress={() => press(d, o)} {...key}>
                    <Text color="success" weight="bold">{o}</Text>
                  </Button>
                ) : (
                  <Button key={`d-${d.id}-${i}`} label={o} onPress={() => press(d, o)} {...key} />
                )
              })}
            </Box>
          )}
          {at >= 0 && <Text color="success">{`✓ seçildi: ${d.options[at]} · Enter ile gider`}</Text>}
          {at < 0 && queued && <Text dimColor>{queued.push ? QUEUED_PUSH : QUEUED}</Text>}
          {at < 0 && !queued && sentTo !== undefined && <Text dimColor>{`Gönderildi: ${sentTo}`}</Text>}
          {/* One caption row from the start, so a press changes its text and never the card's height. */}
          {at < 0 && !queued && sentTo === undefined && d.options.length > 0 && <Text dimColor>1-9 ile seç · kutuna yazılır</Text>}
        </Box>
        )
      })}
      {kids.flatMap(({ child: c, title, fwd }) => [
        ...c.decisions.map(d => {
          const stuck = isStuck(d.kind)
          const cap = kidCaption(c, d, fwd.find(x => x.file === c.file && x.id === d.id), true)
          return (
            <Box key={`kd-${c.task}-${d.id}`} {...TBOX} borderColor={stuck ? 'error' : TBOX.borderColor}>
              <Text color={stuck ? 'error' : 'claude'}>{[d.kind, title, `◇ ${c.name}`].filter(Boolean).join(' · ')}</Text>
              <Text>{d.text}</Text>
              {d.meta && <Text dimColor>{d.meta}</Text>}
              {d.options.length > 0 &&
                (isPush(d.kind) ? (
                  <Text dimColor>{d.options.map(o => cut(o, 60)).join(' / ')}</Text>
                ) : (
                  <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
                    {d.options.map((o, i) => (
                      <Button key={`kd-${c.task}-${d.id}-${i}`} label={cut(o, 60)} onPress={() => pressKid(c, d, o)} {...(n < 9 ? hk(String(++n)) : { plain: true as const })} />
                    ))}
                  </Box>
                ))}
              {cap && <Text color={cap.color} dimColor={!cap.color}>{cap.text}</Text>}
            </Box>
          )
        }),
        ...(c.count > c.decisions.length ? [<Text key={`kd-${c.task}-more`} dimColor>{`+${c.count - c.decisions.length} karar daha · o oturumda`}</Text>] : []),
      ])}
    </Box>
  )
}

// The task bits shared by the list box and the detail: stage segments, role rows, counts (approved design "Terminal pane · yeniden tasarım").
const stageLine = ({ Text }: UI, t: Task) => (
  <Text>
    {STAGE_LABELS.map((_, i) =>
      i === t.stage ? <Text color="claude" weight="bold">━━━ </Text> : <Text color={i < t.stage ? 'text' : 'inactive'}>━━━ </Text>,
    )}
  </Text>
)

// "◐ çalışıyor" / "✗ TAKILDI" / "⏸ bekliyor", then the reason (task-state design).
const STATE: Record<TaskState, [string, string]> = {
  running: ['◐ çalışıyor', 'claude'],
  blocked: ['✗ TAKILDI', 'error'],
  waiting: ['⏸ bekliyor', 'warning'],
}

const stateLine = ({ Text }: UI, t: Task) => (
  <Text>
    <Text color={STATE[t.state][1]} weight="bold">{STATE[t.state][0]}</Text>
    {t.reason && <Text color={t.state === 'blocked' ? 'error' : undefined} dimColor={t.state !== 'blocked'}>{` · ${t.reason}`}</Text>}
  </Text>
)

// The rows of a task session under the state row (`sessionLines`).
const sessionRows = ({ Text }: UI, id: string, rows: readonly SessionLine[]) =>
  rows.map((l, i) => <Text key={`${id}-s-${i}`} color={l.color} dimColor={!l.color}>{l.text}</Text>)

const stageName = ({ Text }: UI, t: Task) => <Text dimColor>{`${STAGE_LABELS[t.stage]} · ${t.stage + 1}/5`}</Text>

const roleRows = ({ Box, Text }: UI, id: string, roles: Role[], frame: number) =>
  roles.map((r, i) => (
    <Box key={`${id}-r-${i}`} flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text color={GLYPH[r.status][1]}>{r.status === 'running' ? FRAMES[frame] ?? GLYPH.running[0] : GLYPH[r.status][0]}</Text>
        <Text>{r.name}</Text>
      </Box>
      {r.state && (
        <Box marginLeft={4}>
          <Text color={r.status === 'blocked' ? 'error' : undefined} dimColor={r.status !== 'blocked'}>{r.state}</Text>
        </Box>
      )}
    </Box>
  ))

const counts = ({ Text }: UI, t: Task) =>
  !!(t.blocking || t.followup) && (
    <Text>
      {!!t.blocking && <Text color="error" weight="bold">{`${t.blocking} blocking`}</Text>}
      {!!t.followup && <Text dimColor>{`${t.blocking ? ' · ' : ''}${t.followup} follow-up`}</Text>}
    </Text>
  )

// hasOn: pane-team-on is drawn and owns "o", so no task takes it.
export function termTasks(ui: UI, tasks: Task[], n: { running: number; blocked: number; waiting: number }, hasOn: boolean, open: (id: string) => void, frame = 0, rows: (t: Task) => SessionLine[] = () => []) {
  const { Box, Button, Text } = ui
  const keys = hasOn ? TASK_KEYS.slice(0, -1) : TASK_KEYS
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" gap={2}>
        <Text weight="bold">
          {`${'Görevler'.toLocaleUpperCase('tr')} · ${n.running} çalışıyor`}
          {n.blocked > 0 && <Text color="error" weight="bold">{` · ${n.blocked} takıldı`}</Text>}
          {n.waiting > 0 && ` · ${n.waiting} bekliyor`}
        </Text>
        <Text dimColor>{`${tasks.length} görev`}</Text>
      </Box>
      {tasks.map((t, ti) => {
        const tur = [t.round !== undefined && `Tur ${t.round}`, t.candidate && `aday ${clip(t.candidate, 7)}`].filter(Boolean).join(' · ')
        return (
          <Box key={`t-${t.id}`} {...ROUND} borderColor={t.state === 'blocked' ? 'error' : ROUND.borderColor}>
            <Button key={`detail-${t.id}`} label={t.title} onPress={() => open(t.id)} {...(keys[ti] ? hk(keys[ti]) : { plain: true as const })}>
              <Text weight="bold" wrap="truncate-end">{t.title}</Text>
            </Button>
            {stateLine(ui, t)}
            {sessionRows(ui, `t-${t.id}`, rows(t))}
            {tur && <Text dimColor>{tur}</Text>}
            {stageLine(ui, t)}
            {stageName(ui, t)}
            {roleRows(ui, `t-${t.id}`, t.roles, frame)}
            {counts(ui, t)}
          </Box>
        )
      })}
    </Box>
  )
}

// The detail: back/ask on one row, a summary box, ROLLER, TURLAR (newest first, a box each), KANIT.
export function termDetail(ui: UI, t: Task, back: () => void, ask: () => void, frame = 0, rows: readonly SessionLine[] = []) {
  const { Box, Button, Text } = ui
  const head = (s: string) => <Text weight="bold">{s}</Text>
  const where = [t.branch, t.candidate && `aday ${clip(t.candidate, 7)}`].filter(Boolean).join(' · ')
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between" gap={2}>
        <Button key="detail-back" label="‹ Görevler" onPress={back} {...hk('b')} />
        <Button key="detail-ask" label="Lead'e sor" onPress={ask} {...hk('s')} />
      </Box>
      <Box key="detail-summary" {...ROUND}>
        <Text weight="bold">{t.title}</Text>
        {stateLine(ui, t)}
        {sessionRows(ui, 'detail', rows)}
        {where && <Text dimColor>{where}</Text>}
        <Text>{stageLine(ui, t)}{stageName(ui, t)}</Text>
        {counts(ui, t)}
      </Box>
      {t.roles.length > 0 && (
        <Box flexDirection="column">
          {head('ROLLER')}
          {roleRows(ui, 'detail', t.roles, frame)}
        </Box>
      )}
      <Box flexDirection="column">
        {head('TURLAR')}
        {t.rounds ? (
          t.rounds.map((r, i) => (
            <Box key={`round-${i}`} {...ROUND}>
              <Text weight="bold" color={r.verdict === 'GO' ? 'success' : r.verdict.startsWith('NO') ? 'error' : undefined}>
                {['Tur ' + r.n, r.verdict, r.candidate && clip(r.candidate, 7)].filter(Boolean).join(' · ')}
              </Text>
              {r.findings.map((f, j) => {
                const tag = [f.severity, f.origin].filter(Boolean).join(' · ')
                return (
                <Box key={`round-${i}-f-${j}`} flexDirection="column">
                  {!!tag && <Text color={isBlocking(f) ? 'error' : undefined} dimColor={!isBlocking(f)}>{tag}</Text>}
                  <Text>{f.what}</Text>
                  {f.where && <Text dimColor>{f.where}</Text>}
                </Box>
                )
              })}
              {r.note && <Text color="warning">{`Not: ${r.note}`}</Text>}
            </Box>
          )).reverse()
        ) : (
          <Text dimColor>Henüz review turu yok.</Text>
        )}
      </Box>
      {t.evidence && (
        <Box flexDirection="column">
          {head('KANIT')}
          {t.evidence.map((e, i) => (
            <Box key={`ev-${i}`} flexDirection="column">
              <Text>{e.label}</Text>
              <Text dimColor wrap="truncate-middle">{e.path}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

// A reopened session: what the pane knows, and a button that asks the Lead where things stand (`note`: "sırada", "gönderildi" or nothing).
export function termBanner({ Box, Button, Text }: UI, text: string, note: string, ask: () => void) {
  return (
    <Box {...TBOX} borderColor="warning">
      <Text color="warning">{text}</Text>
      <Button key="reopen-ask" label={note ? `Nerede kaldık? · ${note}` : 'Nerede kaldık?'} onPress={ask} {...hk('r')} />
    </Box>
  )
}

export function termHint({ Text }: UI, hasOthers = false, hasAsk = false) {
  const k = (s: string) => <Text color="claude">{s}</Text>
  return <Text dimColor>{k('a-o')} ayrıntı  {k('1-9')} karar seç  {hasOthers && <Text>{k('v')} diğer  </Text>}{hasAsk && <Text>{k('r')} nerede kaldık  </Text>}{k('p')} pause  {k('esc')} çık</Text>
}

// Other team sessions' decisions, read-only: no number keys, options as dim text; "v" opens and closes (approved design "Diğer oturumların kararları").
export function termOthers({ Box, Button, Text }: UI, others: readonly Other[], open: boolean, toggle: () => void) {
  const total = others.reduce((n, o) => n + o.count, 0)
  const head = (title: JSX.Element, label: string) => (
    <Box flexDirection="row" justifyContent="space-between" gap={2}>
      {title}
      <Button key="others-toggle" label={label} onPress={toggle} {...hk('v')} />
    </Box>
  )
  if (!open)
    return (
      <Box flexDirection="column">
        {head(
          <Text>
            <Text color="warning">◇ </Text>
            <Text color="warning" weight="bold">{`Diğer oturumlarda ${total} karar`}</Text>
          </Text>,
          'göster',
        )}
        <Text dimColor>{`  ${others.map(o => `${o.project} ${o.count}${o.stuckCount ? ` (${o.stuckCount} takıldı)` : ''}`).join(' · ')}`}</Text>
      </Box>
    )
  return (
    <Box flexDirection="column">
      {head(
        <Text>
          <Text color="warning" weight="bold">{`◇ ${'Diğer oturumlar'.toLocaleUpperCase('tr')}`}</Text>
          <Text dimColor>{` · ${total} karar`}</Text>
        </Text>,
        'gizle',
      )}
      {others.map(o => (
        <Box key={`other-${o.file}`} {...TBOX} borderColor={o.stuckCount ? 'error' : TBOX.borderColor}>
          <Box flexDirection="row" justifyContent="space-between" gap={2}>
            <Text weight="bold">{o.name}</Text>
            <Text dimColor>{o.when}</Text>
          </Box>
          <Box flexDirection="column" gap={1}>
            {o.decisions.map((d, i) => (
              <Box key={`odec-${o.file}-${i}`} flexDirection="column">
                <Text color={d.stuck ? 'error' : 'claude'} weight="bold">{`${d.stuck ? '✗' : '◆'} ${d.kind ?? 'Karar'}`}</Text>
                <Text>{d.text}</Text>
                {d.options.length > 0 && <Text dimColor>{`  ${d.options.join(' / ')}`}</Text>}
              </Box>
            ))}
          </Box>
          {o.count > o.decisions.length && <Text dimColor>{`+${o.count - o.decisions.length} karar daha`}</Text>}
        </Box>
      ))}
      <Text dimColor>Cevabı o oturumda ver; buradan gönderilemez.</Text>
    </Box>
  )
}

export function termFooter({ Box, Button, Text }: UI, isOn: boolean, modes: readonly string[], toggle: () => void, openPane: () => void) {
  return (
    <Box flexDirection="row" alignItems="center" gap={2}>
      <Button key="team-mode" plain label={isOn ? '◉ agent team' : '○ agent team'} onPress={toggle} />
      <Button key="team-pane-open" plain label="pane" onPress={openPane} />
      {modes.length > 0 && <Text dimColor>{modes.join(' & ')}</Text>}
    </Box>
  )
}
