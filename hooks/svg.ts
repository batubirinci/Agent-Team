// Thin bars for the desktop pane. An Svg is drawn as an image and cannot read the person's theme,
// so the colors are ones that read on both a light and a dark pane.
export const TRACK = 'rgba(128,128,128,0.25)'
export const MUTED = '#8A8880'
export const CLAY = '#D97757'
export const OK = '#4E9A47'
export const BAD = '#D9534F'
// The current stage part of a blocked task (the approved design's red).
export const STUCK = '#E06C6C'
// The dot of the strip for other sessions' decisions (the approved design's amber).
export const AMBER = '#E5C07B'

const H = 4
const n = (x: number) => Math.round(x * 100) / 100
const svg = (w: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}">${body}</svg>`
const rect = (x: number, w: number, fill: string) =>
  `<rect x="${n(x)}" width="${n(w)}" height="${H}" rx="2" fill="${fill}"/>`

export function meterSvg(pct: number): string {
  const w = 160
  const p = Math.min(100, Math.max(0, pct))
  const fill = p > 0 ? rect(0, (w * p) / 100, p >= 80 ? AMBER : MUTED) : ''
  return svg(w, rect(0, w, TRACK) + fill)
}

// Motion lives in the Svg's own <style>, only under no-preference (the person's Reduce Motion leaves today's still drawing; SMIL could
// not be gated). Plain CSS: an image-mode Svg runs it (seen live 2026-11-19).
const MOTION = (css: string) => `<style>@media (prefers-reduced-motion: no-preference){${css}}</style>`
const LOOP = '1600ms ease-in-out infinite'

// A ● in text keeps the text's size on desktop; this is the design's 8 px dot. `pulse`: a running role's dot, opacity 1 -> 0.4 -> 1.
export const dotSvg = (color: string, pulse = false) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8">${pulse ? MOTION(`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}circle{animation:pulse ${LOOP}}`) : ''}<circle cx="4" cy="4" r="4" fill="${color}"/></svg>`

// `running`: a 24 px lighter band travels across the current segment (clipped to it). Hidden (opacity 0, no fill) unless the animation runs.
export function stagesSvg(current: number, count = 5, blocked = false, running = false): string {
  const w = 320
  const gap = 4
  const seg = (w - gap * (count - 1)) / count
  const parts = Array.from({ length: count }, (_, i) =>
    rect(i * (seg + gap), seg, i < current ? MUTED : i === current ? (blocked ? STUCK : CLAY) : TRACK),
  )
  const band = running
    ? MOTION(`@keyframes sweep{from{transform:translateX(-24px);opacity:1}to{transform:translateX(${n(seg)}px);opacity:1}}.sweep{fill:rgba(255,255,255,0.45);animation:sweep ${LOOP}}`) +
      `<clipPath id="c${current}"><rect x="${n(current * (seg + gap))}" width="${n(seg)}" height="${H}" rx="2"/></clipPath>` +
      `<g class="band" clip-path="url(#c${current})"><rect class="sweep" x="${n(current * (seg + gap))}" width="24" height="${H}" opacity="0"/></g>`
    : ''
  return svg(w, parts.join('') + band)
}

// A finished task's stage line: five green segments. `elapsed` (ms since the finish, 0 <= elapsed < DONE_MS) adds the one-shot light-up, each segment 0.25 -> 1 in
// 300 ms, 150 ms apart, left to right. The Svg is a function of elapsed time: the desktop rebuilds an image on every redraw and a new image with the same source
// restarts its animation (measured), so the delay is `i * 150 - elapsed` (negative: the animation resumes where it was). From DONE_MS on, or without a clock, it is still.
export const DONE_MS = 1200
export function doneStagesSvg(elapsed = Number.NaN): string {
  const w = 320
  const gap = 4
  const seg = (w - gap * 4) / 5
  const parts = Array.from({ length: 5 }, (_, i) => rect(i * (seg + gap), seg, OK).replace('/>', ` class="s${i}"/>`))
  const motion = elapsed >= 0 && elapsed < DONE_MS
    ? MOTION(`@keyframes lit{from{opacity:0.25}to{opacity:1}}${parts.map((_, i) => `.s${i}{animation:lit 300ms ease-out ${n(i * 150 - elapsed)}ms 1 both}`).join('')}`)
    : ''
  return svg(w, motion + parts.join(''))
}

// The reader's bar (320 x 4): a clay bar that fills once in 280 ms with a lighter band crossing it (520 ms, starting at 120 ms), as a function of `elapsed` ms since
// the reader opened (the same one-shot pattern as doneStagesSvg: a redraw restarts an image's animation, so the delay is negative). Still outside 0 <= elapsed < EV_BAR_MS.
export const EV_BAR_MS = 640
export function evBarSvg(elapsed = Number.NaN): string {
  const w = 320
  const motion = elapsed >= 0 && elapsed < EV_BAR_MS
    ? MOTION(`@keyframes fill{from{transform:scaleX(0)}to{transform:scaleX(1)}}@keyframes band{from{opacity:.9;transform:translateX(-40px)}to{opacity:0;transform:translateX(320px)}}.fill{transform-origin:left center;animation:fill 280ms cubic-bezier(.2,.7,.2,1) ${n(-elapsed)}ms 1 both}.band{animation:band 520ms ease-in-out ${n(120 - elapsed)}ms 1 both}`)
    : ''
  return svg(w, `${motion}${rect(0, w, TRACK)}${rect(0, w, CLAY).replace('/>', ' class="fill"/>')}<rect class="band" x="0" width="40" height="${H}" fill="rgba(255,255,255,0.45)" opacity="0"/>`)
}

// The status dot of an evidence row (8 x 8). `elapsed` ms since the reader was left: the dot fades from clay to its own color once in 700 ms.
export const EV_DOT_MS = 700
export function evDotSvg(color: string, elapsed = Number.NaN): string {
  const motion = elapsed >= 0 && elapsed < EV_DOT_MS ? MOTION(`@keyframes flash{from{fill:${CLAY}}to{fill:${color}}}circle{animation:flash 700ms ease-out ${n(-elapsed)}ms 1 both}`) : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8">${motion}<circle cx="4" cy="4" r="4" fill="${color}"/></svg>`
}

// The detail's hairlines (a Box has no single-edge border). The rail joins one round's dot to the next: 2 x 2000, far taller than a round, clipped by the Box it sits
// in. The rule divides the evidence rows: 1000 x 1 stretched to the slot (preserveAspectRatio none).
export const RAIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2000" viewBox="0 0 2 2000"><rect width="2" height="2000" rx="1" fill="${TRACK}"/></svg>`
export const RULE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1" viewBox="0 0 1000 1" preserveAspectRatio="none"><rect width="1000" height="1" fill="${TRACK}"/></svg>`

// The padlock before a push decision's kind (14 x 14, a CLAY stroke, still: no motion).
export const LOCK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="${CLAY}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>`
