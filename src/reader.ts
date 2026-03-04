/**
 * Minimal PDF parser — enough to support merge, split, and text extraction.
 * Supports traditional cross-reference tables (PDF ≤ 1.4 style), which covers
 * all PDFs produced by purepdf and the vast majority of other generators.
 * PDFs with compressed XRef streams (PDF 1.5+) are not supported.
 */

// Latin-1 (ISO-8859-1): each byte maps to exactly one character,
// so character offset === byte offset. This is critical for XRef table lookups.
const dec = new TextDecoder('latin1')
const enc = new TextEncoder()

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toStr(buf: Uint8Array): string { return dec.decode(buf) }
function toBytes(s: string): Uint8Array { return enc.encode(s) }

function concat(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0)
  const out = new Uint8Array(total)
  let pos = 0
  for (const a of arrays) { out.set(a, pos); pos += a.length }
  return out
}

// ─── Cross-reference parser ───────────────────────────────────────────────────

interface XRefEntry { offset: number; gen: number; free: boolean }

/** Parse the traditional cross-reference table and return object → offset map. */
function parseXRef(src: string): Map<number, XRefEntry> {
  const map = new Map<number, XRefEntry>()

  // Find startxref
  const sxIdx = src.lastIndexOf('startxref')
  if (sxIdx === -1) throw new Error('purepdf: no startxref found')

  const after = src.slice(sxIdx + 9).trim()
  const xrefOffset = parseInt(after, 10)
  if (isNaN(xrefOffset)) throw new Error('purepdf: invalid startxref offset')

  // Walk from xrefOffset
  let p = xrefOffset
  const skipWS = () => { while (p < src.length && /\s/.test(src[p])) p++ }

  skipWS()
  if (!src.startsWith('xref', p)) {
    throw new Error('purepdf: expected "xref" — PDF may use compressed XRef streams (not supported)')
  }
  p += 4

  while (p < src.length) {
    skipWS()
    if (src.startsWith('trailer', p)) break

    // Read subsection header: "<startId> <count>"
    const lineEnd = src.indexOf('\n', p)
    if (lineEnd === -1) break
    const header = src.slice(p, lineEnd).trim()
    const parts = header.split(/\s+/)
    if (parts.length < 2) break
    let id  = parseInt(parts[0], 10)
    const cnt = parseInt(parts[1], 10)
    if (isNaN(id) || isNaN(cnt)) break
    p = lineEnd + 1

    for (let i = 0; i < cnt; i++) {
      // Each entry is exactly 20 bytes
      const entry = src.slice(p, p + 20)
      p += 20
      const offset = parseInt(entry.slice(0, 10), 10)
      const gen    = parseInt(entry.slice(11, 16), 10)
      const type   = entry[17]
      map.set(id, { offset, gen, free: type === 'f' })
      id++
    }
  }

  return map
}

// ─── Object reader ────────────────────────────────────────────────────────────

/** Read the raw bytes of a PDF object starting at `offset`. */
function readObjectAt(src: string, offset: number): string {
  const start = src.indexOf('obj', offset)
  if (start === -1) throw new Error(`purepdf: obj not found at offset ${offset}`)
  const bodyStart = start + 3

  // Find the matching "endobj"
  const end = src.indexOf('endobj', bodyStart)
  if (end === -1) throw new Error('purepdf: endobj not found')
  return src.slice(bodyStart, end).trim()
}

/** Extract the /Type value from a dictionary string, if present. */
function getDictType(obj: string): string {
  const m = /\/Type\s+\/(\w+)/.exec(obj)
  return m ? m[1] : ''
}

// ─── Text extraction ──────────────────────────────────────────────────────────

/** Decode a PDF literal string (content between outer parentheses). */
function decodeLiteralString(s: string): string {
  // Remove enclosing parens
  let result = ''
  let i = 1 // skip opening '('
  while (i < s.length - 1) {
    if (s[i] === '\\') {
      i++
      switch (s[i]) {
        case 'n': result += '\n'; break
        case 'r': result += '\r'; break
        case 't': result += '\t'; break
        case '(': result += '('; break
        case ')': result += ')'; break
        case '\\': result += '\\'; break
        default:
          // Octal \ddd
          if (/[0-7]/.test(s[i])) {
            let oct = ''
            for (let j = 0; j < 3 && /[0-7]/.test(s[i + j]); j++) oct += s[i + j]
            result += String.fromCharCode(parseInt(oct, 8))
            i += oct.length - 1
          }
      }
    } else {
      result += s[i]
    }
    i++
  }
  return result
}

/** Extract printable text from a PDF content stream. */
function extractFromStream(stream: string): string {
  const parts: string[] = []

  // Match text show operators: (string) Tj | [(...)...] TJ
  const re = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj|\[([^\]]*)\]\s*TJ/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stream)) !== null) {
    if (m[1] !== undefined) {
      parts.push(decodeLiteralString('(' + m[1] + ')'))
    } else {
      // TJ array: extract all literal strings within it
      const arr = m[2]
      const re2 = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g
      let m2: RegExpExecArray | null
      while ((m2 = re2.exec(arr)) !== null) {
        parts.push(decodeLiteralString('(' + m2[1] + ')'))
      }
    }
  }

  // Join with spaces, collapse multiple whitespace
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

// ─── Font extraction ─────────────────────────────────────────────────────────

interface FontDef { pdfName: string; baseFontName: string }

/**
 * Extract font definitions used by a page by reading its Resource dictionary
 * and looking up each referenced font object in the XRef table.
 */
function extractPageFonts(src: string, xref: Map<number, XRefEntry>, pageObj: string): FontDef[] {
  const fonts: FontDef[] = []

  // Match the /Font << ... >> section inside /Resources
  const m = /\/Font\s*<<([^>]*)>>/.exec(pageObj)
  if (!m) return fonts

  const re = /\/(\w+)\s+(\d+)\s+0\s+R/g
  let fm: RegExpExecArray | null
  while ((fm = re.exec(m[1])) !== null) {
    const pdfName = fm[1]
    const objId   = parseInt(fm[2], 10)
    const entry   = xref.get(objId)
    if (!entry || entry.free) continue
    try {
      const fontObj = readObjectAt(src, entry.offset)
      const bm = /\/BaseFont\s+\/(\S+)/.exec(fontObj)
      if (bm) fonts.push({ pdfName, baseFontName: bm[1] })
    } catch { /* skip unparseable font objects */ }
  }
  return fonts
}

// ─── Public: extractText ─────────────────────────────────────────────────────

/**
 * Extract plain text from a PDF.
 * Works on simple, unencrypted PDFs. Returns text page by page,
 * with pages separated by '\n\n'.
 */
export function extractText(pdfBytes: Uint8Array): string {
  const src = toStr(pdfBytes)
  const xref = parseXRef(src)

  // Find all Page objects
  const pageTexts: string[] = []

  for (const [, entry] of xref) {
    if (entry.free) continue
    try {
      const obj = readObjectAt(src, entry.offset)
      if (getDictType(obj) !== 'Page') continue

      // Find /Contents reference(s)
      const contentsMatch = /\/Contents\s+(\d+)\s+0\s+R/.exec(obj)
      if (!contentsMatch) continue
      const contId = parseInt(contentsMatch[1], 10)

      const contEntry = xref.get(contId)
      if (!contEntry) continue
      const contObj = readObjectAt(src, contEntry.offset)

      // Extract the stream body
      const streamStart = contObj.indexOf('stream')
      const streamEnd   = contObj.lastIndexOf('endstream')
      if (streamStart === -1 || streamEnd === -1) continue

      const streamBody = contObj.slice(streamStart + 6, streamEnd).replace(/^\r?\n/, '')
      pageTexts.push(extractFromStream(streamBody))
    } catch {
      // Skip objects that fail to parse
    }
  }

  return pageTexts.filter(Boolean).join('\n\n')
}

// ─── Public: mergePDFs ───────────────────────────────────────────────────────

/**
 * Merge two or more PDFs into one.
 * All pages from each input PDF are combined in order.
 *
 * Limitation: works best with simple, unencrypted PDFs.
 */
export function mergePDFs(pdfs: Uint8Array[]): Uint8Array {
  if (pdfs.length === 0) throw new Error('purepdf: mergePDFs requires at least one PDF')
  if (pdfs.length === 1) return pdfs[0]

  const allPageData: PageData[] = []

  for (const pdf of pdfs) {
    const src  = toStr(pdf)
    const xref = parseXRef(src)

    for (const [, entry] of xref) {
      if (entry.free) continue
      try {
        const obj = readObjectAt(src, entry.offset)
        if (getDictType(obj) !== 'Page') continue

        const mb = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(obj)
        const w  = mb ? parseFloat(mb[3]) : 595.28
        const h  = mb ? parseFloat(mb[4]) : 841.89

        const cm = /\/Contents\s+(\d+)\s+0\s+R/.exec(obj)
        if (!cm) { allPageData.push({ width: w, height: h, stream: '', fonts: [] }); continue }

        const ce = xref.get(parseInt(cm[1], 10))
        if (!ce) { allPageData.push({ width: w, height: h, stream: '', fonts: [] }); continue }

        const co = readObjectAt(src, ce.offset)
        const ss = co.indexOf('stream')
        const se = co.lastIndexOf('endstream')
        const stream = ss !== -1 && se !== -1 ? co.slice(ss + 6, se).replace(/^\r?\n/, '') : ''

        allPageData.push({ width: w, height: h, stream, fonts: extractPageFonts(src, xref, obj) })
      } catch {
        // skip
      }
    }
  }

  return _buildFromPageData(allPageData)
}

// ─── Public: splitPDF ────────────────────────────────────────────────────────

/**
 * Split a PDF into individual pages.
 * Returns an array where each element is a single-page PDF.
 */
export function splitPDF(pdfBytes: Uint8Array): Uint8Array[] {
  const src  = toStr(pdfBytes)
  const xref = parseXRef(src)
  const pages: Uint8Array[] = []

  for (const [, entry] of xref) {
    if (entry.free) continue
    try {
      const obj = readObjectAt(src, entry.offset)
      if (getDictType(obj) !== 'Page') continue

      const mb = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(obj)
      const w  = mb ? parseFloat(mb[3]) : 595.28
      const h  = mb ? parseFloat(mb[4]) : 841.89

      const cm = /\/Contents\s+(\d+)\s+0\s+R/.exec(obj)
      let stream = ''
      if (cm) {
        const ce = xref.get(parseInt(cm[1], 10))
        if (ce) {
          const co = readObjectAt(src, ce.offset)
          const ss = co.indexOf('stream')
          const se = co.lastIndexOf('endstream')
          if (ss !== -1 && se !== -1) stream = co.slice(ss + 6, se).replace(/^\r?\n/, '')
        }
      }

      const fonts = extractPageFonts(src, xref, obj)
      pages.push(_buildFromPageData([{ width: w, height: h, stream, fonts }]))
    } catch {
      // skip
    }
  }

  return pages
}

/**
 * Extract specific page indices (0-based) from a PDF.
 * @example extractPages(pdf, [0, 2]) → first and third pages
 */
export function extractPages(pdfBytes: Uint8Array, indices: number[]): Uint8Array {
  const all = splitPDF(pdfBytes)
  const set = new Set(indices)
  const selected = all.filter((_, i) => set.has(i))
  if (selected.length === 0) throw new Error('purepdf: no pages matched the given indices')
  return mergePDFs(selected)
}

// ─── Internal: build PDF from raw page data ───────────────────────────────────

interface PageData {
  width:  number
  height: number
  stream: string
  fonts:  FontDef[]
}

function _buildFromPageData(pages: PageData[]): Uint8Array {
  const chunks: Uint8Array[] = []
  let pos = 0
  let nextId = 1

  const write    = (s: string) => { const b = toBytes(s); chunks.push(b); pos += b.length }
  const writeRaw = (b: Uint8Array) => { chunks.push(b); pos += b.length }

  const catalogId = nextId++
  const pagesId   = nextId++

  // ── Deduplicate fonts across all pages ────────────────────────────────────
  // globalFontMap: baseFontName → { globalPdfName, objId }
  const globalFontMap = new Map<string, { globalPdfName: string; objId: number }>()
  let fontCounter = 0
  for (const page of pages) {
    for (const f of page.fonts) {
      if (!globalFontMap.has(f.baseFontName)) {
        globalFontMap.set(f.baseFontName, {
          globalPdfName: `F${++fontCounter}`,
          objId: nextId++,
        })
      }
    }
  }

  // Pre-allocate page/content IDs
  const pageIds:    number[] = []
  const contentIds: number[] = []
  for (let i = 0; i < pages.length; i++) {
    pageIds.push(nextId++)
    contentIds.push(nextId++)
  }

  const maxId = nextId - 1
  const objOffsets = new Map<number, number>()

  write('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')

  const startO = (id: number) => { objOffsets.set(id, pos); write(`${id} 0 obj\n`) }
  const endO   = () => write('endobj\n')

  startO(catalogId)
  write(`<< /Type /Catalog /Pages ${pagesId} 0 R >>\n`)
  endO()

  const kids = pageIds.map(id => `${id} 0 R`).join(' ')
  startO(pagesId)
  write(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\n`)
  endO()

  // ── Write global font objects ─────────────────────────────────────────────
  for (const [baseFontName, { objId }] of globalFontMap) {
    startO(objId)
    write(`<< /Type /Font /Subtype /Type1 /BaseFont /${baseFontName} /Encoding /WinAnsiEncoding >>\n`)
    endO()
  }

  // ── Write pages ───────────────────────────────────────────────────────────
  for (let i = 0; i < pages.length; i++) {
    const { width, height, fonts } = pages[i]
    let stream = pages[i].stream

    // Remap old per-source font names (F1, F2, …) → global names (F1, F2, …)
    // to avoid conflicts when merging PDFs with different font assignments.
    const fontResEntries: string[] = []
    const seen = new Set<string>()
    for (const f of fonts) {
      const gf = globalFontMap.get(f.baseFontName)
      if (!gf) continue
      if (gf.globalPdfName !== f.pdfName) {
        // Replace only exact font name references (followed by whitespace)
        stream = stream.replace(new RegExp(`/${f.pdfName}(?=[ \\t\\r\\n])`, 'g'), `/${gf.globalPdfName}`)
      }
      const entry = `/${gf.globalPdfName} ${gf.objId} 0 R`
      if (!seen.has(entry)) { seen.add(entry); fontResEntries.push(entry) }
    }

    const streamBytes = toBytes(stream)
    startO(contentIds[i])
    write(`<< /Length ${streamBytes.length} >>\nstream\n`)
    writeRaw(streamBytes)
    write('\nendstream\n')
    endO()

    const fontRes   = fontResEntries.length > 0 ? `/Font << ${fontResEntries.join(' ')} >>` : ''
    const resources = fontRes ? `<< ${fontRes} >>` : '<< >>'
    startO(pageIds[i])
    write(
      `<< /Type /Page /Parent ${pagesId} 0 R` +
      ` /MediaBox [0 0 ${width.toFixed(3)} ${height.toFixed(3)}]` +
      ` /Contents ${contentIds[i]} 0 R /Resources ${resources} >>\n`
    )
    endO()
  }

  // ── XRef ─────────────────────────────────────────────────────────────────
  const xrefOff = pos
  write(`xref\n0 ${maxId + 1}\n`)
  write(`${String(0).padStart(10, '0')} 65535 f \n`)
  for (let id = 1; id <= maxId; id++) {
    const off = objOffsets.get(id) ?? 0
    write(`${String(off).padStart(10, '0')} 00000 n \n`)
  }
  write(`trailer\n<< /Size ${maxId + 1} /Root ${catalogId} 0 R >>\n`)
  write(`startxref\n${xrefOff}\n%%EOF\n`)

  return concat(chunks)
}

