/**
 * Standard character widths (1/1000 text units) for the 14 built-in PDF fonts.
 * Source: Adobe AFM (Adobe Font Metrics) files. Indices 0-95 = chars 32-127.
 * Use 600 as fallback for characters outside this range.
 */
import type { FontName } from './types'

// Chars 32-127 (96 entries each)
const HELVETICA: number[] = [
  278,278,355,556,556,889,667,222,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
  1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
  667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
  222,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,
  556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,278,
]

const HELVETICA_BOLD: number[] = [
  278,333,474,556,556,889,722,278,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
  975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,
  667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,
  278,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,
  611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,278,
]

const TIMES_ROMAN: number[] = [
  250,333,408,500,500,833,778,333,333,333,500,564,250,333,250,278,
  500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,
  921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,
  556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,
  333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,
  500,500,333,389,278,500,500,722,500,500,444,480,200,480,541,278,
]

const TIMES_BOLD: number[] = [
  250,333,555,500,500,1000,833,333,333,333,500,570,250,333,250,278,
  500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,
  930,722,667,722,722,667,611,778,778,389,500,778,667,944,722,778,
  611,778,722,556,667,722,722,1000,722,722,667,333,278,333,581,500,
  333,500,556,444,556,444,333,500,556,278,333,556,278,833,556,500,
  556,556,444,389,333,556,500,722,500,500,444,394,220,394,520,278,
]

const TIMES_ITALIC: number[] = [
  250,333,420,500,500,833,778,333,333,333,500,675,250,333,250,278,
  500,500,500,500,500,500,500,500,500,500,333,333,675,675,675,500,
  920,611,611,667,722,611,611,722,722,333,444,667,556,833,667,722,
  611,722,611,500,556,722,611,833,611,556,556,389,278,389,422,500,
  333,500,500,444,500,444,278,500,500,278,278,444,278,722,500,500,
  500,500,389,389,278,500,444,667,444,444,389,400,275,400,541,278,
]

const TIMES_BOLD_ITALIC: number[] = [
  250,389,555,500,500,833,778,333,333,333,500,570,250,333,250,278,
  500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,
  832,667,667,667,722,667,667,722,778,389,500,667,611,889,722,722,
  611,722,667,556,611,722,667,889,667,611,611,333,278,333,570,500,
  333,500,500,444,500,444,333,500,556,278,278,500,278,778,556,500,
  500,500,389,389,278,556,444,667,500,444,389,348,220,348,570,278,
]

// Courier is monospace — all characters are 600 units wide
const COURIER_600 = Array<number>(96).fill(600)

// Symbol and ZapfDingbats — use 600 as a reasonable default
const DEFAULT_600 = Array<number>(96).fill(600)

export const FONT_METRICS: Record<FontName, number[]> = {
  'Helvetica':             HELVETICA,
  'Helvetica-Bold':        HELVETICA_BOLD,
  'Helvetica-Oblique':     HELVETICA,       // same metrics as regular
  'Helvetica-BoldOblique': HELVETICA_BOLD,  // same metrics as bold
  'Times-Roman':           TIMES_ROMAN,
  'Times-Bold':            TIMES_BOLD,
  'Times-Italic':          TIMES_ITALIC,
  'Times-BoldItalic':      TIMES_BOLD_ITALIC,
  'Courier':               COURIER_600,
  'Courier-Bold':          COURIER_600,
  'Courier-Oblique':       COURIER_600,
  'Courier-BoldOblique':   COURIER_600,
  'Symbol':                DEFAULT_600,
  'ZapfDingbats':          DEFAULT_600,
}

/** Returns the rendered width of a string in points at the given font size. */
export function measureText(text: string, font: FontName, size: number): number {
  const widths = FONT_METRICS[font] ?? DEFAULT_600
  let w = 0
  for (let i = 0; i < text.length; i++) {
    const idx = text.charCodeAt(i) - 32
    w += (idx >= 0 && idx < widths.length) ? widths[idx] : 600
  }
  return (w * size) / 1000
}

/** Splits text into lines that fit within maxWidth. Respects '\n'. */
export function wrapText(
  text: string,
  font: FontName,
  size: number,
  maxWidth: number,
): string[] {
  const result: string[] = []
  // Pre-compute space width once per call instead of re-measuring accumulated line each iteration.
  // This changes complexity from O(total_chars²) to O(total_chars).
  const spaceW = measureText(' ', font, size)
  for (const para of text.split('\n')) {
    const words = para.split(' ')
    let line = ''
    let lineW = 0
    for (const word of words) {
      const wordW = measureText(word, font, size)
      if (!line) {
        line = word
        lineW = wordW
      } else if (lineW + spaceW + wordW <= maxWidth) {
        line += ' ' + word
        lineW += spaceW + wordW
      } else {
        result.push(line)
        line = word
        lineW = wordW
      }
    }
    result.push(line)
  }
  return result
}
