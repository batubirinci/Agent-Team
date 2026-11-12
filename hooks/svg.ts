// Thin bars for the desktop pane. An Svg is drawn as an image and cannot read the person's theme,
// so the colors are ones that read on both a light and a dark pane.
export const TRACK = 'rgba(128,128,128,0.25)'
export const MUTED = '#8A8880'
export const CLAY = '#D97757'
export const OK = '#4E9A47'
export const BAD = '#D9534F'

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

// A ● in text keeps the text's size on desktop; this is the design's 8 px dot.
export const dotSvg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="${color}"/></svg>`

export function stagesSvg(current: number, count = 5): string {
  const w = 320
  const gap = 4
  const seg = (w - gap * (count - 1)) / count
  const parts = Array.from({ length: count }, (_, i) =>
    rect(i * (seg + gap), seg, i < current ? MUTED : i === current ? CLAY : TRACK),
  )
  return svg(w, parts.join(''))
}
