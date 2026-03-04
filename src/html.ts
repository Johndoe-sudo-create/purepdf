/**
 * Basic HTML → PDF converter.
 * Supported tags: h1–h6, p, br, b/strong, i/em, u, del/s, code, pre,
 *   blockquote, ul, ol, li, table, tr, th, td, hr, div, span, section, article.
 * No external CSS, no images via URL, no JavaScript.
 * Inline style="color:…;font-size:…" is parsed.
 */
import { PDFDocument } from './writer'
import type { FontName, PageSize } from './types'
import { measureText } from './metrics'

// ─── Options ──────────────────────────────────────────────────────────────────

export interface HtmlToPdfOptions {
  /** Page size (default: 'A4'). */
  size?:          PageSize | [number, number]
  /** Page margin in points (default: 50). */
  margin?:        number
  /** Base font size in points (default: 11). */
  baseFontSize?:  number
  /** Base font (default: 'Times-Roman'). */
  baseFont?:      FontName
}

// ─── Tokeniser ────────────────────────────────────────────────────────────────

type Token =
  | { type: 'open';  tag: string; attrs: Record<string, string> }
  | { type: 'close'; tag: string }
  | { type: 'text';  value: string }

function tokenise(html: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i)
      if (end === -1) { i++; continue }
      const raw = html.slice(i + 1, end).trim()
      i = end + 1

      if (raw.startsWith('!')) continue   // comment / doctype
      if (raw.startsWith('/')) {
        tokens.push({ type: 'close', tag: raw.slice(1).trim().toLowerCase() })
        continue
      }

      const selfClose = raw.endsWith('/')
      const tagBody   = selfClose ? raw.slice(0, -1).trim() : raw
      const spaceIdx  = tagBody.search(/\s/)
      const tag       = (spaceIdx === -1 ? tagBody : tagBody.slice(0, spaceIdx)).toLowerCase()
      const attrStr   = spaceIdx === -1 ? '' : tagBody.slice(spaceIdx)
      const attrs     = parseAttrs(attrStr)

      tokens.push({ type: 'open', tag, attrs })
      if (selfClose || tag === 'br' || tag === 'hr' || tag === 'img') {
        tokens.push({ type: 'close', tag })
      }
    } else {
      const end = html.indexOf('<', i)
      const raw = end === -1 ? html.slice(i) : html.slice(i, end)
      i = end === -1 ? html.length : end
      const text = decodeEntities(raw)
      if (text) tokens.push({ type: 'text', value: text })
    }
  }
  return tokens
}

function parseAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /(\w[\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return attrs
}

const _ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ',
}
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, e => _ENTITIES[e] ?? e)
    .replace(/\s+/g, ' ')
}

// ─── Inline style parser ─────────────────────────────────────────────────────

interface InlineStyle { color?: string; fontSize?: number }

function parseInlineStyle(style: string): InlineStyle {
  const result: InlineStyle = {}
  for (const decl of style.split(';')) {
    const [prop, val] = decl.split(':').map(s => s.trim())
    if (!prop || !val) continue
    if (prop === 'color') result.color = cssColorToHex(val)
    if (prop === 'font-size') {
      const pt = parseFloat(val)
      if (!isNaN(pt)) result.fontSize = pt
    }
  }
  return result
}

function cssColorToHex(c: string): string {
  const named: Record<string, string> = {
    red: '#ff0000', blue: '#0000ff', green: '#008000',
    black: '#000000', white: '#ffffff', gray: '#808080',
    grey: '#808080', orange: '#ffa500', purple: '#800080',
  }
  if (c.startsWith('#')) return c
  return named[c.toLowerCase()] ?? '#000000'
}

// ─── Renderer ────────────────────────────────────────────────────────────────

interface RunCtx {
  font:          FontName
  size:          number
  color:         string
  bold:          boolean
  italic:        boolean
  underline:     boolean
  strikethrough: boolean
}

function resolveFont(bold: boolean, italic: boolean, base: FontName): FontName {
  // Pick from the same font family
  const isHelv  = base.startsWith('Helvetica')
  const isCour  = base.startsWith('Courier')
  if (isHelv) {
    if (bold && italic) return 'Helvetica-BoldOblique'
    if (bold)           return 'Helvetica-Bold'
    if (italic)         return 'Helvetica-Oblique'
    return 'Helvetica'
  }
  if (isCour) {
    if (bold && italic) return 'Courier-BoldOblique'
    if (bold)           return 'Courier-Bold'
    if (italic)         return 'Courier-Oblique'
    return 'Courier'
  }
  // Times (default)
  if (bold && italic) return 'Times-BoldItalic'
  if (bold)           return 'Times-Bold'
  if (italic)         return 'Times-Italic'
  return 'Times-Roman'
}

/**
 * Convert an HTML string to a PDF `Uint8Array`.
 *
 * @example
 * ```ts
 * const pdf = htmlToPDF('<h1>Report</h1><p>Hello <b>World</b></p>')
 * ```
 */
export function htmlToPDF(html: string, opts: HtmlToPdfOptions = {}): Uint8Array {
  const margin   = opts.margin       ?? 50
  const baseSize = opts.baseFontSize ?? 11
  const baseFont = opts.baseFont     ?? 'Times-Roman'

  const doc    = new PDFDocument({ size: opts.size ?? 'A4' })
  const { width, height } = doc.getPageSize()
  const maxW   = width - margin * 2

  let curY        = height - margin
  let leftOffset  = 0  // increased for blockquotes

  const newPage = () => { doc.addPage({ size: opts.size }); curY = height - margin }
  const ensureSpace = (n: number) => { if (curY - n < margin) newPage() }

  // ── Paragraph flush ──────────────────────────────────────────────────────────
  interface TextRun {
    text:          string
    font:          FontName
    size:          number
    color:         string
    underline:     boolean
    strikethrough: boolean
  }

  const flushParagraph = (runs: TextRun[], lhMul = 1.4, spaceBefore = 0, spaceAfter = 6) => {
    if (runs.length === 0) return

    const left   = margin + leftOffset
    const availW = maxW - leftOffset

    // w is cached on insertion — avoids re-measuring the same text 3 times per segment
    type Seg = { text: string; font: FontName; size: number; color: string; underline: boolean; strikethrough: boolean; x: number; w: number }
    const layoutLines: Seg[][] = [[]]
    let lineW = 0

    for (const run of runs) {
      for (const token of run.text.split(/(\s+)/g)) {
        if (!token) continue
        const isSpace = token.charCodeAt(0) <= 32  // faster than regex for common ASCII
        const tw = measureText(token, run.font, run.size)
        if (!isSpace && lineW + tw > availW && lineW > 0) {
          layoutLines.push([])
          lineW = 0
        }
        layoutLines[layoutLines.length - 1].push({
          text: token, font: run.font, size: run.size,
          color: run.color, underline: run.underline, strikethrough: run.strikethrough, x: 0, w: tw,
        })
        lineW += tw
      }
    }

    curY -= spaceBefore
    for (const ll of layoutLines) {
      const lSize = Math.max(...ll.map(s => s.size), baseSize)
      ensureSpace(lSize * lhMul + spaceAfter)

      // Assign x positions using cached widths (no extra measureText calls)
      let lx = left
      for (const seg of ll) { seg.x = lx; lx += seg.w }

      for (const seg of ll) {
        if (seg.text.trim() === '') continue
        doc.text(seg.text, seg.x, curY, { font: seg.font, size: seg.size, color: seg.color })
        if (seg.underline) {
          doc.line(seg.x, curY - 1, seg.x + seg.w, curY - 1, { stroke: seg.color, lineWidth: 0.5 })
        }
        if (seg.strikethrough) {
          const sy = curY + seg.size * 0.3
          doc.line(seg.x, sy, seg.x + seg.w, sy, { stroke: seg.color, lineWidth: 0.5 })
        }
      }
      curY -= lSize * lhMul
    }
    curY -= spaceAfter
  }

  // ── Token processor ──────────────────────────────────────────────────────────
  const tokens = tokenise(html)
  const stack:  RunCtx[] = []
  let ctx: RunCtx = {
    font: baseFont, size: baseSize, color: '#000000',
    bold: false, italic: false, underline: false, strikethrough: false,
  }

  let paraRuns: TextRun[] = []
  let listDepth = 0
  let inPre     = false

  const headingSize: Record<string, number> = {
    h1: baseSize * 2.2, h2: baseSize * 1.8, h3: baseSize * 1.5,
    h4: baseSize * 1.3, h5: baseSize * 1.1, h6: baseSize,
  }

  const pushCtx = (changes: Partial<RunCtx>) => {
    stack.push({ ...ctx })
    ctx = { ...ctx, ...changes }
    ctx.font = resolveFont(ctx.bold, ctx.italic, baseFont)
  }
  const popCtx = () => { if (stack.length > 0) ctx = stack.pop()! }

  const flushPara = (lh?: number, before?: number, after?: number) => {
    flushParagraph(paraRuns, lh, before, after)
    paraRuns = []
  }

  const addRun = (text: string) => {
    paraRuns.push({
      text, font: ctx.font, size: ctx.size, color: ctx.color,
      underline: ctx.underline, strikethrough: ctx.strikethrough,
    })
  }

  for (const tok of tokens) {
    if (tok.type === 'open') {
      const { tag, attrs } = tok
      const style = parseInlineStyle(attrs['style'] ?? '')

      if (/^h[1-6]$/.test(tag)) {
        flushPara()
        pushCtx({ size: headingSize[tag], bold: true, color: style.color ?? '#000000' })

      } else if (tag === 'p') {
        flushPara()
        pushCtx({ color: style.color ?? ctx.color, size: style.fontSize ?? ctx.size })

      } else if (tag === 'b' || tag === 'strong') {
        pushCtx({ bold: true })
      } else if (tag === 'i' || tag === 'em') {
        pushCtx({ italic: true })
      } else if (tag === 'u') {
        pushCtx({ underline: true })
      } else if (tag === 'del' || tag === 's') {
        pushCtx({ strikethrough: true })

      } else if (tag === 'br') {
        addRun('\n')

      } else if (tag === 'hr') {
        flushPara()
        ensureSpace(20)
        doc.line(margin, curY, width - margin, curY, { stroke: '#cccccc', lineWidth: 0.5 })
        curY -= 10

      } else if (tag === 'blockquote') {
        flushPara()
        curY -= 4
        // Draw left-border accent line (drawn after content, so we mark start Y)
        leftOffset += 20
        pushCtx({ color: '#555555' })

      } else if (tag === 'ul' || tag === 'ol') {
        flushPara()
        listDepth++

      } else if (tag === 'li') {
        flushPara()
        const indent = '  '.repeat(Math.max(0, listDepth - 1))
        // \x95 = WinAnsiEncoding bullet (•)
        pushCtx({})
        addRun(indent + '\x95  ')

      } else if (tag === 'table') {
        flushPara(); pushCtx({})
      } else if (tag === 'tr') {
        pushCtx({})
      } else if (tag === 'th' || tag === 'td') {
        pushCtx({ bold: tag === 'th' })

      } else if (tag === 'pre') {
        flushPara()
        pushCtx({ font: 'Courier', size: ctx.size * 0.9 })
        inPre = true
      } else if (tag === 'code') {
        // inline code — don't flush, just switch font
        pushCtx({ font: 'Courier', size: ctx.size * 0.9 })

      } else if (tag === 'span' || tag === 'div' || tag === 'section' || tag === 'article') {
        pushCtx({ color: style.color ?? ctx.color, size: style.fontSize ?? ctx.size })
      }

    } else if (tok.type === 'close') {
      const { tag } = tok

      if (/^h[1-6]$/.test(tag)) {
        flushPara(1.5, 10, 8); popCtx()

      } else if (tag === 'p') {
        flushPara(1.5, 0, 8); popCtx()

      } else if (tag === 'b' || tag === 'strong' || tag === 'i' || tag === 'em' || tag === 'u') {
        popCtx()
      } else if (tag === 'del' || tag === 's') {
        popCtx()

      } else if (tag === 'blockquote') {
        flushPara(1.4, 0, 6)
        popCtx()
        leftOffset = Math.max(0, leftOffset - 20)
        curY -= 4

      } else if (tag === 'ul' || tag === 'ol') {
        flushPara()
        listDepth = Math.max(0, listDepth - 1)
      } else if (tag === 'li') {
        flushPara(1.4, 0, 4); popCtx()

      } else if (tag === 'th' || tag === 'td' || tag === 'tr' || tag === 'table') {
        flushPara(); popCtx()

      } else if (tag === 'pre') {
        flushPara(1.3, 0, 6); popCtx(); inPre = false
      } else if (tag === 'code') {
        // inline code — restore without flushing
        popCtx()

      } else if (tag === 'span' || tag === 'div' || tag === 'section' || tag === 'article') {
        flushPara(); popCtx()
      }

    } else {
      // text node
      let text = tok.value
      if (!inPre) text = text.replace(/\n/g, ' ').replace(/\s+/g, ' ')
      if (text.trim() || inPre) addRun(text)
    }
  }

  flushPara()
  return doc.save()
}

