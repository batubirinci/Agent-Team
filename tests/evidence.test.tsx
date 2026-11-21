import { expect, test } from 'claude-code/testing'

import { EV_BODY, EV_CHARS, EV_HEAD, clean, evCheck, evExt, evHomeOf, evLoad, evPreview, evRootOf, evRows, evWidth, fmtSize, md, one, readerScroll, termText, wrapLine } from '../hooks/status'
import { evBarSvg, evDotSvg } from '../hooks/svg'
import type { EvStat } from '../types'

// Evidence view (design B). Expected values come from <evidence root>/tasks/evidence-view: "A" = analyst-report.md, "F" = spec-fixes.md;
// the section or criterion number is named at each group. Fixture root `/e`, home `/h` (invariant 7: no personal paths).
const ZW = '\u200b'
const LINE = {
  outside: 'kanıt kökünün dışında: gösterilmiyor',
  bad: 'geçersiz yol: gösterilmiyor',
  root: 'kanıt kökü okunamadı',
  link: 'sembolik bağ ya da farklı yazım: gösterilmiyor',
  notFile: 'dosya değil: gösterilmiyor',
  changed: 'okunurken değişti: gösterilmiyor',
  text: 'metin değil: gösterilmiyor',
}

test('criteria 1, 2, 3 (A §2 R1-R2): a path outside the root or malformed is refused by its spelling alone, any file under the root passes', async () => {
  // Source: A §2 R1/R2 table and criteria 1-3 (owner Q2: hidden files and any extension are allowed).
  for (const p of ['/etc/hosts', '/e2/a.md', '/e', '/E/a.md']) expect(evCheck('/e', '/h', p)).toEqual({ line: LINE.outside })
  for (const p of ['/e/../etc/x.md', '/e/a/./b.md', '/e/a//b.md', 'relative/a.md', '/e/a\\b.md', '']) expect(evCheck('/e', '/h', p)).toEqual({ line: LINE.bad })
  for (const p of ['/e/x.json', '/e/noext', '/e/wt/.git/config', '/e/wt/.env', '/e/a.diff', '/e/😀.md']) expect(evCheck('/e', '/h', p)).toEqual({ p })
  expect(evCheck('/e', '/h', '/e/a/')).toEqual({ p: '/e/a' }) // a trailing slash is trimmed; R4 then says dir
  expect(evCheck('/h/e', '/h', '~/e/a.md')).toEqual({ p: '/h/e/a.md' })
})

test('criteria 31, 32 (F R0, R1, okPath): root and home validity, control and invisible characters in a path', async () => {
  // Source: F section B "Inputs", R0, R1; criterion 31 and 32 lists. status.ts:143-145 by hand for expandHome.
  for (const root of ['', '/', 'rel', '/e/../x', '/e\u202e']) for (const p of ['/etc/hosts', '/e/a.md']) expect(evCheck(root, '/h', p)).toEqual({ line: LINE.root })
  expect(evHomeOf('')).toBe('')
  expect(evHomeOf('rel')).toBe('')
  expect(evHomeOf('/h/')).toBe('/h')
  expect(evRootOf('~/agent-team-evidence', evHomeOf(''))).toBe('')
  expect(evRootOf('~/agent-team-evidence', evHomeOf('/h/'))).toBe('/h/agent-team-evidence')
  expect(evRootOf('/e/', '')).toBe('/e')
  expect(evCheck('/e', '', '~/x.md')).toEqual({ line: LINE.bad })
  for (const c of ['\u200b', '\n', '\t', '\u202e', '\u2028', '\ud800', '\u0000', '\u009b']) expect(evCheck('/e', '/h', `/e/a${c}.md`)).toEqual({ line: LINE.bad })
})

test('criteria 14, 15 (A §2 R10): clean() leaves no character the engine refuses and no invisible one', async () => {
  // Source: A §2 R10 steps 1-4 (measured: ESC, NUL, BEL, DEL and C1 make the engine refuse the whole tree).
  expect(clean('a\u001b[31mb\u0007c\u007fd\u009be\rf\r\ng\u2028h\u2029i\u0000j\u000bk\u000cl')).toBe('a\ufffd[31mb\ufffdc\ufffdd\ufffde\nf\ng\nh\ni\ufffdj\ufffdk\ufffdl')
  expect(clean('a\tb\nc')).toBe('a\tb\nc')
  for (let c = 0; c <= 0x9f; c++) if (c < 0x20 ? c !== 9 && c !== 10 : c >= 0x7f) expect(clean(`x${String.fromCharCode(c)}y`)).toMatch(c === 13 ? /^x\ny$/ : /^x\ufffdy$/)
  for (const c of [0x61c, 0x200b, 0x200c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0x2062, 0x2064, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff]) expect(clean(`x${String.fromCharCode(c)}y`)).toBe('xy')
  expect(clean('x\u{e0000}y\u{e0041}z\u{e007f}')).toBe('xyz')
  expect(clean('a\u200db')).toBe('a\u200db') // the emoji joiner stays
  expect(clean('a😀b')).toBe('a😀b')
  expect(clean('a\ud800b\udc00c')).toBe('a\ufffdb\ufffdc')
})

test('criteria 15, 32 (F R10 one()): a label, path or title is one clean line', async () => {
  expect(one('A\nB\tC D')).toBe('A B C D')
  expect(one('a\u2028b\r\nc')).toBe('a b c')
  expect(one('a\u202eb\u200bc')).toBe('abc')
  expect(one('a\ud800b')).toBe('a\ufffdb')
})

test('criterion 16 (F R11 md): every link, image, HTML and bare-URL form is broken before the text reaches the Markdown element', async () => {
  // Source: F criterion 16; exact outputs hand-derived from R11 steps 0-4 (ZW = U+200B).
  expect(md('> [r]: https&#58;//example.com')).toBe(`> [r]${ZW}: https&${ZW}#58;//example.com`)
  expect(md('[a\nb]: file:/etc/passwd')).toBe(`[a\nb]${ZW}: file:${ZW}/etc/passwd`)
  expect(md('WWW.example.com')).toBe(`WWW${ZW}.example.com`)
  expect(md('<1@example.com>')).toBe(`<${ZW}1@example.com>`)
  expect(md('![i](https://example.com/i.png)')).toBe(`!${ZW}[i]${ZW}(https:${ZW}//example.com/i.png)`)
  const hostile = [
    '![i](https://example.com/i.png)', '[l](https://example.com/a)', '<img src=x>', '<https://example.com>', '<1@example.com>', 'https://example.com/b', 'www.example.com', 'WWW.example.com',
    '[r]: https://example.com', '> [r]: https&#58;//example.com', '- [r]: https&colon;//example.com', '[a\nb]: file:/etc/passwd',
  ].join('\n')
  const out = md(hostile)
  for (const re of [/!\[/, /\]\(/, /\]:/, /<[A-Za-z0-9/!?]/, /:\//, /www\./i, /&[#A-Za-z]/]) expect(out).not.toMatch(re)
  // One check per replacement: each input fails its own step when that step is gone.
  expect(md('a&b')).toBe(`a&${ZW}b`) // step 0
  expect(md('a<b')).toBe(`a<${ZW}b`) // step 1
  expect(md('x![y')).toBe(`x!${ZW}[y`) // step 2
  expect(md('x](y')).toBe(`x]${ZW}(y`) // step 3a
  expect(md('x]:y')).toBe(`x]${ZW}:y`) // step 3b
  expect(md('x:/y')).toBe(`x:${ZW}/y`) // step 4a
  expect(md('xWwW.y')).toBe(`xWwW${ZW}.y`) // step 4b
  expect(md('a < b & c')).toBe('a < b & c') // a space after the mark is no tag and no reference
})

test('criterion 19 (F): md() cuts to EV_CHARS characters, never inside a surrogate pair', async () => {
  // Source: F criterion 19 (b): 81 920 / 2 x 3 = 122 880 characters after step 1.
  const out = md('<a'.repeat(40_960))
  expect(out.length).toBe(EV_CHARS)
  expect(EV_CHARS).toBe(96_000)
  // (c) a cut that would land inside a pair ends before it: 'a' x 95 999 then a pair that straddles 96 000.
  const pair = md('a'.repeat(EV_CHARS - 1) + '😀😀')
  expect(pair.length).toBe(EV_CHARS - 1)
  expect(pair.endsWith('a')).toBe(true)
})

test('criterion 25 (A §4, F §B): fmtSize, ext and the preview rows', async () => {
  // Source: A §4 table and examples; F §B section 4 (cut = 199 code points + …, .env is dosya, a.tar.gz is gz, 1024,0 KB prints 1,0 MB).
  expect(fmtSize(3891)).toBe('3,8 KB')
  expect(fmtSize(512)).toBe('512 B')
  expect(fmtSize(0)).toBe('0 B')
  expect(fmtSize(1_048_576)).toBe('1,0 MB')
  expect(fmtSize(1_048_575)).toBe('1,0 MB')
  expect(fmtSize(81_920)).toBe('80,0 KB')
  expect(fmtSize(90_000)).toBe('87,9 KB') // 90 000 / 1024 = 87,89
  expect(fmtSize(7777)).toBe('7,6 KB') // 7 777 / 1024 = 7,59
  expect(evExt('/e/noext')).toBe('dosya')
  expect(evExt('/e/wt/.env')).toBe('dosya')
  expect(evExt('/e/a.tar.gz')).toBe('gz')
  expect(evExt('/e/A.MD')).toBe('md')
  expect(evExt('/e/a.')).toBe('dosya')
  expect(evExt('/e/a.abcdefghi')).toBe('dosya')
  expect(evExt('/e/a.m-d')).toBe('dosya')
  const sha = '22c5915169472b0045389229015ddf2669d00383'
  expect(evPreview('# Başlık\n\nilk satır\nikinci satır', true, false)).toEqual({ l1: 'Başlık', l2: 'ilk satır' })
  expect(evPreview('**VERDICT: NO-GO**\n# QA r1', true, false)).toEqual({ chip: 'NO-GO', l2: 'QA r1' })
  expect(evPreview(`GÖREV hardening: GO · aday ${sha} · rapor x`, true, false)).toEqual({ chip: 'GO', summary: 'aday 22c5915 · rapor x' })
  expect(evPreview('`VERDICT: GO|NO-GO` for these\ntext', true, false)).toEqual({ l1: 'VERDICT: GO|NO-GO for these', l2: 'text' })
  expect(evPreview('---\n```\n   ', true, false)).toEqual({})
  expect(evPreview('   \n  ', true, false)).toEqual({})
  expect(evPreview('\nVERDICT: GO\n# x', false, false)).toEqual({ l1: 'VERDICT: GO', l2: '# x' }) // gates.log: no verdict outside Markdown
  expect(evPreview('x'.repeat(4096), false, true)).toEqual({ l1: `${'x'.repeat(199)}…` })
  // The cut line: a file longer than what was read loses the text after the last line break; one with no break is kept whole.
  expect(evPreview('a\nb\ncc', false, true)).toEqual({ l1: 'a', l2: 'b' })
  expect(evPreview('a\nb\ncc', false, false)).toEqual({ l1: 'a', l2: 'b' })
  expect(evPreview('a\ncc', false, true)).toEqual({ l1: 'a' })
  expect(evPreview('a\ncc', false, false)).toEqual({ l1: 'a', l2: 'cc' })
  // Strip rules.
  expect(evPreview('- [x] done **bold** [link](https://e.x) ![alt](p.png) `c`', true, false)).toEqual({ l1: 'done bold link alt c' })
  expect(evPreview('> ## 1. Başlık', true, false)).toEqual({ l1: 'Başlık' })
  // The verdict: only among the first 8 raw lines, skipped lines count; GO. ends the match; GOOD and GO-ish are none.
  expect(evPreview(`${'\n'.repeat(7)}**VERDICT: GO**`, true, false)).toEqual({ chip: 'GO' })
  expect(evPreview(`${'\n'.repeat(8)}**VERDICT: GO**`, true, false)).toEqual({ l1: 'VERDICT: GO' })
  expect(evPreview('VERDICT: GO.', true, false)).toEqual({ chip: 'GO' })
  expect(evPreview('VERDICT: GOOD', true, false)).toEqual({ l1: 'VERDICT: GOOD' })
  expect(evPreview('VERDICT: GO-ish', true, false)).toEqual({ l1: 'VERDICT: GO-ish' })
  expect(evPreview('verdict: GO', true, false)).toEqual({ l1: 'verdict: GO' })
  expect(evPreview('GÖREV t1: NO-GO · rapor\nikinci', true, false)).toEqual({ chip: 'NO-GO', summary: 'rapor', l2: 'ikinci' })
  expect(evPreview('| a | b |\n|---|---|\n| 1 | 2 |', true, false)).toEqual({ l1: '| a | b |', l2: '| 1 | 2 |' })
})

test('criteria 30, 33 (A §5.4, F §5.3-5.4): the terminal clean-up of Markdown and the wrapping rows', async () => {
  // Source: A criterion 30 and F "30 add" / "33" lists, hand-derived from the rules; W = 44 unless said.
  const W = 44
  const one1 = (l: string, w = W) => termText([l], w)[0]!
  expect(one1('## Başlık ##')).toMatchObject({ t: 'Başlık', bold: true })
  expect(one1('- a')).toMatchObject({ t: '• a', hang: '  ' })
  expect(one1('  - b')).toMatchObject({ t: '  ◦ b', hang: '    ' })
  expect(one1('> q')).toMatchObject({ t: '│ q' })
  expect(one1('---').t).toBe('─'.repeat(W))
  expect(one1('- - -').t).toBe('─'.repeat(W))
  expect(termText(['```', '- x **y**', '```'], W).map(r => r.t)).toEqual(['- x **y**'])
  expect(termText(['~~~', '# h', 'after'], W).map(r => r.t)).toEqual(['# h', 'after']) // an unclosed fence keeps everything after it
  expect(termText(['|a|b|', '|-|-|', '|1|2|'], W).map(r => r.t)).toEqual(['|a|b|', '|1|2|'])
  expect(one1('[t](https://example.com) **b**').t).toBe('t (https://example.com) b')
  expect(one1('## C#')).toMatchObject({ t: 'C#', bold: true })
  expect(one1('## **B** ##')).toMatchObject({ t: 'B', bold: true })
  expect(one1('![a](u) [t](v)').t).toBe('a (u) t (v)')
  expect(one1('> - a').t).toBe('│ - a')
  expect(one1('1. a **b**').t).toBe('1. a b')
  expect(one1(`${' '.repeat(44)}- a b c`).t).toBe(`${' '.repeat(20)}◦ a b c`) // indent min(44, floor(44/2) - 2)
  // Rows: tab = two spaces, empty line = one space row, a .log is shown as it is.
  expect(evRows('a\tb', true, W)).toEqual([{ t: 'a  b' }])
  expect(evRows('a\n\nb\n', false, W).map(r => r.t)).toEqual(['a', ' ', 'b'])
  expect(evRows('## x\n- a\n```\n- y\n```', false, W).map(r => r.t)).toEqual(['## x', '- a', '```', '- y', '```'])
  expect(evRows('', false, W)).toEqual([])
  // 33: widths and wrapping.
  expect(evWidth(48)).toBe(44)
  expect(evWidth(4)).toBe(12)
  expect(evWidth(Number.NaN)).toBe(44)
  expect(wrapLine(` ${'a'.repeat(60)}`, 44)).toEqual([` ${'a'.repeat(43)}`, 'a'.repeat(17)]) // 61 - 44 = 17
  expect(wrapLine('aaaa bbbb cc', 5)).toEqual(['aaaa', 'bbbb', 'cc'])
  expect(wrapLine('aaaaa bbb', 5)).toEqual(['aaaaa', 'bbb'])
  expect(evRows('- aaaa bbbb cccc', true, 12).map(r => r.t)).toEqual(['• aaaa bbbb', '  cccc'])
  expect(evRows('x'.repeat(81_920), false, 44).length).toBe(1862) // ceil(81 920 / 44)
  expect(evRows(`## ${'word '.repeat(20)}`, true, 20).every(r => r.bold === true)).toBe(true)
  expect(evRows(`- a${'x'.repeat(60)}`, true, 12).slice(1).every(r => r.t.startsWith('  '))).toBe(true)
  expect(evRows(`- a${'x'.repeat(60)}`, false, 12).slice(1).every(r => !r.t.startsWith(' '))).toBe(true) // no hang outside Markdown
  expect(evRows('---', true, 12)[0]?.t).toBe('─'.repeat(12))
})

test('criterion 28 (F §5.2): readerScroll names where the pane goes', async () => {
  expect(readerScroll('agent-team')).toEqual({ in: 'agent-team', to: 'start' })
  expect(readerScroll('agent-team', 1)).toEqual({ in: 'agent-team', to: { key: 'ev-1' }, block: 'nearest' })
  expect(readerScroll('agent-team', 0)).toEqual({ in: 'agent-team', to: { key: 'ev-0' }, block: 'nearest' })
  expect(readerScroll('agent-team', -1)).toBeUndefined()
})

const RED = '#D9534F'
const stripStyle = (s: string) => s.replace(/<style>[\s\S]*?<\/style>/g, '')

test('criterion 27 (A §5.2, F 5.1): the bar and the dot are one-shot functions of elapsed time, CSS only, gated by reduced motion', async () => {
  // Source: A §5.2 "The two Svgs": bar fill 280 ms + band 520 ms starting at 120 ms, window 0 <= elapsed < 640; the return flash (moved from the document glyph to the row's dot by evidence-restyle) 700 ms, window 0 <= elapsed < 700.
  const at0 = evBarSvg(0)
  expect(at0).toContain('@keyframes fill')
  expect(at0).toContain('@keyframes band')
  expect(at0).toContain('prefers-reduced-motion: no-preference')
  expect(at0).toMatch(/fill 280ms [^;}]* 0ms 1 both/)
  expect(at0).toMatch(/band 520ms [^;}]* 120ms 1 both/)
  const at300 = evBarSvg(300)
  expect(at300).toMatch(/fill 280ms [^;}]* -300ms 1 both/)
  expect(at300).toMatch(/band 520ms [^;}]* -180ms 1 both/)
  expect(evBarSvg(639)).toContain('animation')
  for (const e of [640, 5000, -1, Number.NaN, undefined]) expect(evBarSvg(e)).not.toMatch(/animation|@keyframes|<style/)
  const still = evBarSvg(Number.NaN)
  expect(stripStyle(at0)).toBe(still)
  expect(stripStyle(at300)).toBe(still)
  expect(still).toMatch(/^<svg [^>]*width="320" height="4"/)
  expect(evDotSvg(RED, 0)).toContain('@keyframes flash')
  expect(evDotSvg(RED, 0)).toMatch(/flash 700ms [^;}]* 0ms 1 both/)
  expect(evDotSvg(RED, 250)).toMatch(/flash 700ms [^;}]* -250ms 1 both/)
  expect(evDotSvg(RED, 699)).toContain('@keyframes flash')
  for (const e of [700, 9999, -1, Number.NaN, undefined]) expect(evDotSvg(RED, e)).not.toMatch(/animation|@keyframes|<style/)
  const dot = evDotSvg(RED, Number.NaN)
  expect(stripStyle(evDotSvg(RED, 10))).toBe(dot)
  expect(dot).toMatch(/^<svg [^>]*width="8" height="8"/)
  for (const s of [at0, at300, dot, evDotSvg(RED, 10)]) {
    expect(s).not.toContain('<animate')
    expect(s.match(/@media/g)?.length ?? 1).toBe(1)
  }
})

// ---- The read path (evLoad), against a scripted fs. Source: A §2 R3-R10 and criteria 4-13, 39, 41; F R5-R9. ----
const FILE: EvStat = { kind: 'file', size: 10, mtimeMs: 5, isLink: false, realPath: '/e/a.md' }
type Reply = EvStat | 'reject'
// `stats` is served in order (the last repeats); `text` answers every read.
const script = (stats: Reply[], text: string | 'reject' = 'hello\nworld') => {
  const calls = { stat: [] as unknown[], read: [] as unknown[] }
  const fs = {
    stat: async (_p: string, o: unknown) => {
      calls.stat.push(o)
      const s = stats[Math.min(calls.stat.length - 1, stats.length - 1)]
      if (s === 'reject' || s === undefined) throw new Error('ENOENT')
      return s
    },
    read: async (_p: string, o: unknown) => {
      calls.read.push(o)
      if (text === 'reject') throw new Error('EIO')
      return text
    },
  }
  return { fs, calls }
}
const load = (stats: Reply[], text?: string | 'reject', o: { p?: string; rootReal?: string; len?: number } = {}) => {
  const s = script(stats, text)
  return evLoad(s.fs, '/e', o.rootReal ?? '/e', o.p ?? '/e/a.md', o.len ?? EV_HEAD).then(rec => ({ rec, calls: s.calls }))
}

test('criteria 4, 5, 6, 7, 41 (A R5, F R5): a link anywhere on the path, a different place or spelling, or no realPath is refused; the root may be a link; NFC spellings are one file', async () => {
  const link = await load([{ ...FILE, isLink: true }])
  expect(link.rec).toMatchObject({ state: 'refused', line: LINE.link })
  expect(link.calls.read.length).toBe(0)
  // A link directory in the middle: isLink is false there (measured); only realPath tells.
  const dir = await load([{ ...FILE, realPath: '/e/outside/secret.md' }], 'x', { p: '/e/dirlink/secret.md' })
  expect(dir.rec).toMatchObject({ state: 'refused', line: LINE.link })
  expect(dir.calls.read.length).toBe(0)
  const none = await load([{ kind: 'file', size: 10, mtimeMs: 5, isLink: false }])
  expect(none.rec).toMatchObject({ state: 'refused', line: LINE.link })
  const inside = await load([{ ...FILE, realPath: '/e/x/a.md' }])
  expect(inside.rec).toMatchObject({ state: 'refused', line: LINE.link })
  // Criterion 7: the root itself resolves through a link; both sides.
  const real = await load([{ ...FILE, realPath: '/real/e/a.md' }], 'hi', { rootReal: '/real/e' })
  expect(real.rec).toMatchObject({ state: 'ok' })
  // Criterion 41: a status file that spells ö in the other form still names the same file; a link to another place differs after NFC.
  const nfd = '/e/o\u0308.md'
  const nfc = '/e/\u00f6.md'
  expect((await load([{ ...FILE, realPath: nfc }], 'hi', { p: nfd })).rec).toMatchObject({ state: 'ok' })
  expect((await load([{ ...FILE, realPath: nfd }], 'hi', { p: nfc })).rec).toMatchObject({ state: 'ok' })
  expect((await load([{ ...FILE, realPath: '/e/x/\u00f6.md' }], 'hi', { p: nfc })).rec).toMatchObject({ state: 'refused', line: LINE.link })
  expect((await load([{ ...FILE, realPath: nfc }], 'hi', { p: nfc })).rec).toMatchObject({ state: 'ok' })
})

test('criterion 8, 9, 10 (A R4, R6, F R6): folders, devices, a too big or odd size, and a missing file are refused before any read', async () => {
  for (const kind of ['dir', 'other']) {
    const r = await load([{ ...FILE, kind }])
    expect(r.rec).toMatchObject({ state: 'refused', line: LINE.notFile })
    expect(r.calls.read.length).toBe(0)
  }
  const big = await load([{ ...FILE, size: 1_048_577 }])
  expect(big.rec).toMatchObject({ state: 'refused', line: 'çok büyük (1,0 MB): gösterilmiyor' })
  expect(big.calls.read.length).toBe(0)
  expect((await load([{ ...FILE, size: 1_048_576 }])).rec.state).toBe('ok')
  for (const size of [-1, Number.NaN]) {
    const r = await load([{ ...FILE, size }])
    expect(r.rec).toMatchObject({ state: 'refused', line: LINE.notFile })
    expect(r.calls.read.length).toBe(0)
  }
  const gone = await load(['reject'])
  expect(gone.rec).toEqual({ stat: null, state: 'refused', line: 'dosya bulunamadı' })
  const bad = await load([FILE], 'reject')
  expect(bad.rec).toMatchObject({ state: 'refused', line: 'okunamadı', stat: FILE })
})

test('criteria 11 (A R7, F R7): only ranged reads, and an empty file is not read at all', async () => {
  const head = await load([FILE])
  expect(head.calls.read).toEqual([{ offset: 0, length: EV_HEAD }])
  expect(head.calls.stat).toEqual([{ resolve: true }, { resolve: true }])
  const body = await load([FILE], 'x', { len: EV_BODY })
  expect(body.calls.read).toEqual([{ offset: 0, length: EV_BODY }])
  expect(EV_BODY).toBe(81_920)
  const empty = await load([{ ...FILE, size: 0 }])
  expect(empty.rec).toMatchObject({ state: 'empty', size: 0 })
  expect(empty.calls.read.length).toBe(0)
  // A read that cuts a character ends in U+FFFD when the file is longer than the range: that one character is dropped.
  const cut = await load([{ ...FILE, size: EV_BODY + 5 }], `ab\ufffd`, { len: EV_BODY })
  expect(cut.rec).toMatchObject({ state: 'ok', body: 'ab', more: true })
  const whole = await load([{ ...FILE, size: 12 }], `abcdefghi\ufffd`, { len: EV_BODY })
  expect(whole.rec.body).toBe('abcdefghi\ufffd')
  const longer = await load([{ ...FILE, size: EV_BODY + 1 }], 'x', { len: EV_BODY })
  expect(longer.rec.more).toBe(true)
})

test('criterion 12 (A R8, F 12 add): the second stat must equal the first, twice running, or nothing of the read is kept', async () => {
  for (const change of [{ mtimeMs: 6 }, { realPath: '/e/b.md' }, { size: 11 }, { isLink: true }, { kind: 'dir' }] as Partial<EvStat>[]) {
    // Two attempts: stat, (read), stat that differs, stat, (read), stat that differs.
    const r = await load([FILE, { ...FILE, ...change }, FILE, { ...FILE, ...change }], 'SECRET text')
    expect(r.rec.state).toBe('refused')
    expect(r.rec.line).toBe(LINE.changed)
    expect('stat' in r.rec && r.rec.stat !== undefined).toBe(false) // absent: the next step loads again
    expect(JSON.stringify(r.rec)).not.toContain('SECRET')
    expect(r.calls.stat.length).toBe(4)
  }
  // The second stat rejects: a mismatch too.
  expect((await load([FILE, 'reject', FILE, 'reject'])).rec.line).toBe(LINE.changed)
  // Differs once, then matches: shown.
  const once = await load([FILE, { ...FILE, mtimeMs: 6 }, { ...FILE, mtimeMs: 6 }, { ...FILE, mtimeMs: 6 }], 'ok text')
  expect(once.rec).toMatchObject({ state: 'ok', stat: { mtimeMs: 6 } })
  expect(once.calls.stat.length).toBe(4)
})

test('criteria 13, 39 (A R9, F R9): NUL and mostly-undecodable text is not text; ESC-coloured logs are', async () => {
  const nul = await load([FILE], 'ab\u0000cd')
  expect(nul.rec).toMatchObject({ state: 'refused', line: LINE.text })
  expect(JSON.stringify(nul.rec)).not.toContain('ab')
  const mk = (n: number) => `${'a'.repeat(100 - n)}${'\ufffd'.repeat(n)}`
  expect((await load([FILE], mk(31))).rec).toMatchObject({ state: 'refused', line: LINE.text }) // 31 x 10 > 100 x 3
  expect((await load([FILE], mk(30))).rec.state).toBe('ok') // 30 x 10 = 300
  const ansi = await load([FILE], `${'\u001b'.repeat(40)}${'a'.repeat(60)}`)
  expect(ansi.rec.state).toBe('ok')
})

test('criteria 14, 25 (A R10, §4): the loaded body is clean and the preview comes from the same text', async () => {
  const r = await load([{ ...FILE, size: 40 }], '# Başlık\u001b[31m\r\nikinci\u202e\n', { len: EV_BODY })
  expect(r.rec).toMatchObject({ state: 'ok', body: '# Başlık\ufffd[31m\nikinci\n', preview: { l1: 'Başlık\ufffd[31m', l2: 'ikinci' } })
  const head = await load([{ ...FILE, size: 30, realPath: '/e/b.log' }], 'one\ntwo', { p: '/e/b.log' })
  expect(head.rec.preview).toEqual({ l1: 'one', l2: 'two' })
  expect(head.rec.body).toBeUndefined()
})
