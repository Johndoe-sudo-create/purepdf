/**
 * PDF generation engine.
 * Produces valid PDF 1.7 files that open in any standard viewer.
 * Supports text (14 built-in fonts), shapes, JPEG images, and tables.
 */
import type {
  DocumentOptions, AddPageOptions, TextOptions,
  GraphicsOptions, ImageOptions, TableData, TableOptions, FontName,
} from './types'
import { PAGE_SIZES, PDF_BINARY_COMMENT } from './constants'
import { measureText, wrapText } from './metrics'

// ─── Low-level helpers ────────────────────────────────────────────────────────

const enc = new TextEncoder()

// Pre-encode the binary comment once at module load (contains bytes > 127).
const _BINARY_COMMENT = enc.encode(PDF_BINARY_COMMENT)

function concat(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0)
  const out = new Uint8Array(total)
  let pos = 0
  for (const a of arrays) { out.set(a, pos); pos += a.length }
  return out
}

/** Escape a string for use inside PDF parenthesis string `(...)`. */
function pdfStr(s: string): string {
  let r = '('
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code === 40 || code === 41 || code === 92) {
      r += '\\' + s[i]
    } else if (code >= 32 && code <= 126) {
      r += s[i]
    } else if (code >= 128 && code <= 255) {
      r += '\\' + code.toString(8).padStart(3, '0') // octal escape
    } else {
      r += '?' // chars outside Latin-1 become '?'
    }
  }
  return r + ')'
}

/** Parse '#RRGGBB' or '#RGB' to a PDF RGB string "r g b" (0–1 range). */
const _rgbCache = new Map<string, string>()
function toRGB(hex: string): string {
  const cached = _rgbCache.get(hex)
  if (cached) return cached
  const h = hex.replace('#', '')
  const full = h.length === 3
    ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    : h
  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255
  const result = `${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)}`
  _rgbCache.set(hex, result)
  return result
}

/** Read JPEG image dimensions and colour space from its binary header. */
function parseJPEG(data: Uint8Array): { width: number; height: number; colorSpace: string } {
  for (let i = 0; i < data.length - 9; i++) {
    if (
      data[i] === 0xff &&
      data[i + 1] >= 0xc0 && data[i + 1] <= 0xcf &&
      data[i + 1] !== 0xc4 && data[i + 1] !== 0xc8 && data[i + 1] !== 0xcc
    ) {
      const height = (data[i + 5] << 8) | data[i + 6]
      const width  = (data[i + 7] << 8) | data[i + 8]
      const comps  = data[i + 9]
      const colorSpace = comps === 1 ? '/DeviceGray' : comps === 4 ? '/DeviceCMYK' : '/DeviceRGB'
      return { width, height, colorSpace }
    }
  }
  throw new Error('purepdf: invalid or unsupported JPEG data')
}

// ─── XRef entry ───────────────────────────────────────────────────────────────

/** 20-byte cross-reference entry as required by the PDF spec. */
function xrefEntry(offset: number, gen: number, type: 'n' | 'f'): string {
  return `${String(offset).padStart(10, '0')} ${String(gen).padStart(5, '0')} ${type} \n`
}

// ─── Internal page model ──────────────────────────────────────────────────────

interface PageState {
  id:         number
  contentId:  number
  width:      number
  height:     number
  ops:        string[]   // PDF content stream operator lines
  fonts:      Map<FontName, string>  // FontName → PDF font resource name "F1", "F2", …
  images:     Map<string, { pdfName: string; objId: number; width: number; height: number; data: Uint8Array }>
}

// ─── PDFDocument ──────────────────────────────────────────────────────────────

/**
 * Creates and serialises PDF documents.
 *
 * @example
 * ```ts
 * const doc = new PDFDocument()
 * doc.text('Hello World', 50, 750, { size: 24, font: 'Helvetica-Bold' })
 * doc.rect(50, 700, 200, 40, { fill: '#ffffcc', stroke: '#999' })
 * const bytes = doc.save()
 * ```
 */
export class PDFDocument {
  private _nextId   = 1
  private _pagesId  = 0
  private _catalogId = 0
  private _pages:   PageState[] = []
  private _fonts:   Map<FontName, { pdfName: string; objId: number }> = new Map()
  private _fontCnt  = 0
  private _imgCnt   = 0

  constructor(opts: DocumentOptions = {}) {
    this._pagesId   = this._alloc()
    this._catalogId = this._alloc()
    this._addPage(opts.size)
  }

  // ── Page management ─────────────────────────────────────────────────────────

  /** Add a new page and make it current. */
  addPage(opts: AddPageOptions = {}): this {
    this._addPage(opts.size)
    return this
  }

  /** Current page dimensions in points. */
  getPageSize(): { width: number; height: number } {
    const p = this._cur()
    return { width: p.width, height: p.height }
  }

  // ── Text ────────────────────────────────────────────────────────────────────

  /**
   * Draw text at position (x, y) — y measured from the bottom of the page.
   * Returns the y coordinate immediately below the last line drawn.
   */
  text(str: string, x: number, y: number, opts: TextOptions = {}): number {
    const font     = opts.font      ?? 'Helvetica'
    const size     = opts.size      ?? 12
    const color    = opts.color     ?? '#000000'
    const align    = opts.align     ?? 'left'
    const lhMul    = opts.lineHeight ?? 1.2
    const maxWidth = opts.maxWidth

    const { pdfName } = this._useFont(font)
    const p   = this._cur()
    const lh  = size * lhMul
    const lines = maxWidth ? wrapText(str, font, size, maxWidth) : [str]
    const width = maxWidth ?? p.width

    const ops = p.ops
    ops.push(`q`)
    ops.push(`${toRGB(color)} rg`)

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lw   = measureText(line, font, size)
      let lx = x
      if (align === 'center') lx = x + (width - lw) / 2
      if (align === 'right')  lx = x + width - lw

      ops.push(`BT`)
      ops.push(`/${pdfName} ${size} Tf`)
      ops.push(`${lx.toFixed(3)} ${(y - i * lh).toFixed(3)} Td`)
      ops.push(`${pdfStr(line)} Tj`)
      ops.push(`ET`)
    }

    ops.push(`Q`)
    return y - (lines.length - 1) * lh - size
  }

  // ── Graphics ────────────────────────────────────────────────────────────────

  /** Draw a rectangle. */
  rect(x: number, y: number, w: number, h: number, opts: GraphicsOptions = {}): this {
    this._drawPath(opts, `${x.toFixed(3)} ${y.toFixed(3)} ${w.toFixed(3)} ${h.toFixed(3)} re`)
    return this
  }

  /** Draw a line. */
  line(x1: number, y1: number, x2: number, y2: number, opts: GraphicsOptions = {}): this {
    this._drawPath(opts, `${x1.toFixed(3)} ${y1.toFixed(3)} m ${x2.toFixed(3)} ${y2.toFixed(3)} l`)
    return this
  }

  /** Draw a circle. */
  circle(cx: number, cy: number, r: number, opts: GraphicsOptions = {}): this {
    // Approximate circle with 4 cubic bezier curves (κ ≈ 0.5523)
    const k = r * 0.5523
    const path = [
      `${(cx).toFixed(3)} ${(cy + r).toFixed(3)} m`,
      `${(cx + k).toFixed(3)} ${(cy + r).toFixed(3)} ${(cx + r).toFixed(3)} ${(cy + k).toFixed(3)} ${(cx + r).toFixed(3)} ${cy.toFixed(3)} c`,
      `${(cx + r).toFixed(3)} ${(cy - k).toFixed(3)} ${(cx + k).toFixed(3)} ${(cy - r).toFixed(3)} ${cx.toFixed(3)} ${(cy - r).toFixed(3)} c`,
      `${(cx - k).toFixed(3)} ${(cy - r).toFixed(3)} ${(cx - r).toFixed(3)} ${(cy - k).toFixed(3)} ${(cx - r).toFixed(3)} ${cy.toFixed(3)} c`,
      `${(cx - r).toFixed(3)} ${(cy + k).toFixed(3)} ${(cx - k).toFixed(3)} ${(cy + r).toFixed(3)} ${cx.toFixed(3)} ${(cy + r).toFixed(3)} c`,
    ].join(' ')
    this._drawPath(opts, path)
    return this
  }

  // ── Images ──────────────────────────────────────────────────────────────────

  /**
   * Draw a JPEG image at (x, y).
   * Width or height can be given; if only one is provided, the other is computed
   * from the aspect ratio.
   */
  image(jpegData: Uint8Array, x: number, y: number, opts: ImageOptions = {}): this {
    const p   = this._cur()
    const key = `img_${this._imgCnt++}`
    const inf = parseJPEG(jpegData)

    let w = opts.width  ?? 0
    let h = opts.height ?? 0
    if (w && !h) h = w * (inf.height / inf.width)
    else if (h && !w) w = h * (inf.width / inf.height)
    else if (!w && !h) { w = inf.width; h = inf.height }

    const imgObjId = this._alloc()
    const pdfName  = `Im${imgObjId}`

    p.images.set(key, { pdfName, objId: imgObjId, width: inf.width, height: inf.height, data: jpegData })
    p.ops.push(`q`)
    p.ops.push(`${w.toFixed(3)} 0 0 ${h.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm`)
    p.ops.push(`/${pdfName} Do`)
    p.ops.push(`Q`)
    return this
  }

  // ── Tables ──────────────────────────────────────────────────────────────────

  /**
   * Draw a table starting at (x, y).
   * Returns the y coordinate below the last row.
   */
  table(data: TableData, x: number, y: number, opts: TableOptions = {}): number {
    const font        = opts.font            ?? 'Helvetica'
    const fontSize    = opts.fontSize        ?? 10
    const hFont       = opts.headerFont      ?? 'Helvetica-Bold'
    const hFontSize   = opts.headerFontSize  ?? fontSize
    const hBg         = opts.headerBackground  ?? '#1a73e8'
    const hColor      = opts.headerColor       ?? '#ffffff'
    const altColor    = opts.alternateRowColor
    const borderColor = opts.borderColor       ?? '#cccccc'
    const padding     = opts.cellPadding       ?? 6
    const rowH        = opts.rowHeight         ?? (fontSize + padding * 2)

    const numCols = Math.max(
      data.headers?.length ?? 0,
      ...data.rows.map(r => r.length),
      1, // guard against division by zero when data is empty
    )
    const defaultColW = 400 / numCols
    const colWidths   = opts.colWidths ?? Array<number>(numCols).fill(defaultColW)
    const totalW      = colWidths.reduce((s, w) => s + w, 0)

    let curY = y

    const drawRow = (cells: string[], bg: string | undefined, textColor: string, f: FontName, fs: number) => {
      // Background
      if (bg) this.rect(x, curY - rowH, totalW, rowH, { fill: bg, stroke: false })
      // Border
      this.rect(x, curY - rowH, totalW, rowH, { stroke: borderColor, fill: false })

      // Cell text + vertical separators
      let cx = x
      for (let ci = 0; ci < numCols; ci++) {
        const cell = cells[ci] ?? ''
        // vertical line between cols
        if (ci > 0) this.line(cx, curY, cx, curY - rowH, { stroke: borderColor })
        this.text(cell, cx + padding, curY - padding - fs * 0.25, {
          font: f, size: fs, color: textColor,
          maxWidth: colWidths[ci] - padding * 2,
        })
        cx += colWidths[ci]
      }
      curY -= rowH
    }

    if (data.headers && data.headers.length > 0) {
      drawRow(data.headers, hBg, hColor, hFont, hFontSize)
    }

    data.rows.forEach((row, ri) => {
      const bg = altColor && ri % 2 === 1 ? altColor : undefined
      drawRow(row, bg, '#000000', font, fontSize)
    })

    return curY
  }

  // ── Serialise ────────────────────────────────────────────────────────────────

  /** Serialise the document and return the raw PDF bytes. */
  save(): Uint8Array {
    const chunks: Uint8Array[] = []
    const offsets = new Map<number, number>()

    // String buffer: all PDF structure after the binary header is ASCII-only
    // (pdfStr() octal-escapes every non-ASCII char), so char count === byte count.
    // We flush the buffer to a single Uint8Array only when raw binary (JPEG) must
    // be inserted, reducing TextEncoder.encode() calls from ~100 to 1–2 per save().
    let buf = ''
    let written = 0  // bytes already committed to chunks

    const flush = (): void => {
      if (!buf) return
      const b = enc.encode(buf)
      chunks.push(b)
      written += b.length
      buf = ''
    }
    // curPos: bytes written so far. ASCII buf: buf.length === its encoded byte count.
    const curPos   = ()              => written + buf.length
    const write    = (s: string)     => { buf += s }
    const writeRaw = (b: Uint8Array) => { flush(); chunks.push(b); written += b.length }
    const startObj = (id: number)    => { offsets.set(id, curPos()); write(`${id} 0 obj\n`) }
    const endObj   = ()              => write('endobj\n')

    // ── Header ─────────────────────────────────────────────────────────────────
    write('%PDF-1.7\n')
    writeRaw(_BINARY_COMMENT)  // pre-encoded bytes > 127; must be raw to keep curPos accurate

    // ── Catalog ────────────────────────────────────────────────────────────────
    startObj(this._catalogId)
    write(`<< /Type /Catalog /Pages ${this._pagesId} 0 R >>\n`)
    endObj()

    // ── Pages root ─────────────────────────────────────────────────────────────
    const pageRefs = this._pages.map(p => `${p.id} 0 R`).join(' ')
    startObj(this._pagesId)
    write(`<< /Type /Pages /Kids [${pageRefs}] /Count ${this._pages.length} >>\n`)
    endObj()

    // ── Font objects ──────────────────────────────────────────────────────────
    for (const [name, { pdfName: _, objId }] of this._fonts) {
      startObj(objId)
      write(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>\n`)
      endObj()
    }

    // ── Pages (page dict + content stream + image XObjects) ────────────────────
    for (const p of this._pages) {
      // ── Image XObjects ──────────────────────────────────────────────────────
      for (const img of p.images.values()) {
        const { colorSpace } = parseJPEG(img.data)
        startObj(img.objId)
        write(
          `<< /Type /XObject /Subtype /Image` +
          ` /Width ${img.width} /Height ${img.height}` +
          ` /ColorSpace ${colorSpace} /BitsPerComponent 8` +
          ` /Filter /DCTDecode /Length ${img.data.length} >>\n` +
          `stream\n`
        )
        writeRaw(img.data)  // JPEG: only raw write needed per page
        write('\nendstream\n')
        endObj()
      }

      // ── Content stream (always ASCII — written directly into the buffer) ─────
      const contentStr = p.ops.join('\n') + '\n'
      startObj(p.contentId)
      write(`<< /Length ${contentStr.length} >>\nstream\n`)
      write(contentStr)
      write('\nendstream\n')
      endObj()

      // ── Page dict ──────────────────────────────────────────────────────────
      const fontRes = [...p.fonts.entries()]
        .map(([name, pdfName]) => {
          const { objId } = this._fonts.get(name as FontName)!
          return `/${pdfName} ${objId} 0 R`
        })
        .join(' ')

      const imgRes = [...p.images.values()]
        .map(img => `/${img.pdfName} ${img.objId} 0 R`)
        .join(' ')

      const resourceParts: string[] = []
      if (fontRes) resourceParts.push(`/Font << ${fontRes} >>`)
      if (imgRes)  resourceParts.push(`/XObject << ${imgRes} >>`)

      startObj(p.id)
      write(
        `<< /Type /Page /Parent ${this._pagesId} 0 R` +
        ` /MediaBox [0 0 ${p.width.toFixed(3)} ${p.height.toFixed(3)}]` +
        ` /Contents ${p.contentId} 0 R` +
        ` /Resources << ${resourceParts.join(' ')} >> >>\n`
      )
      endObj()
    }

    // ── Cross-reference table ─────────────────────────────────────────────────
    const xrefOffset = curPos()
    const maxId = this._nextId - 1
    write(`xref\n0 ${maxId + 1}\n`)
    write(xrefEntry(0, 65535, 'f'))  // object 0 is always free

    for (let id = 1; id <= maxId; id++) {
      const off = offsets.get(id)
      if (off !== undefined) {
        write(xrefEntry(off, 0, 'n'))
      } else {
        write(xrefEntry(0, 65535, 'f'))  // unused/free slot
      }
    }

    // ── Trailer ────────────────────────────────────────────────────────────────
    write(`trailer\n<< /Size ${maxId + 1} /Root ${this._catalogId} 0 R >>\n`)
    write(`startxref\n${xrefOffset}\n%%EOF\n`)

    flush()
    return concat(chunks)
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private _alloc(): number { return this._nextId++ }

  private _cur(): PageState {
    if (this._pages.length === 0) throw new Error('purepdf: no page — call addPage() first')
    return this._pages[this._pages.length - 1]
  }

  private _addPage(size?: AddPageOptions['size']): void {
    const [w, h] = Array.isArray(size) ? size : PAGE_SIZES[size ?? 'A4']
    this._pages.push({
      id:        this._alloc(),
      contentId: this._alloc(),
      width:  w,
      height: h,
      ops:    [],
      fonts:  new Map(),
      images: new Map(),
    })
  }

  private _useFont(name: FontName): { pdfName: string; objId: number } {
    if (!this._fonts.has(name)) {
      this._fonts.set(name, { pdfName: `F${++this._fontCnt}`, objId: this._alloc() })
    }
    const f = this._fonts.get(name)!
    const p = this._cur()
    if (!p.fonts.has(name)) p.fonts.set(name, f.pdfName)
    return f
  }

  private _drawPath(opts: GraphicsOptions, pathOps: string): void {
    const stroke    = opts.stroke    !== false ? (opts.stroke    ?? '#000000') : null
    const fill      = opts.fill      !== false ? (opts.fill      ?? false)     : null
    const lineWidth = opts.lineWidth ?? 1

    const p = this._cur()
    p.ops.push('q')
    if (stroke) p.ops.push(`${lineWidth.toFixed(3)} w ${toRGB(stroke)} RG`)
    if (fill)   p.ops.push(`${toRGB(fill as string)} rg`)
    p.ops.push(pathOps)

    if (stroke && fill)       p.ops.push('B')
    else if (fill)            p.ops.push('f')
    else if (stroke)          p.ops.push('S')
    else                      p.ops.push('n') // end path without painting
    p.ops.push('Q')
  }
}
