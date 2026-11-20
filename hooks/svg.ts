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
  const fill = p > 0 ? rect(0, (w * p) / 100, p >= 80 ? CLAY : MUTED) : ''
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

// pane-groups red stub (replaced in the next commit)
export const doneStagesSvg = (_elapsed?: number): string => ''
