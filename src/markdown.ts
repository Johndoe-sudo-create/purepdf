/**
 * Markdown → PDF converter.
 * Converts Markdown to HTML (via markdownToHTML) then renders with htmlToPDF.
 *
 * Supported syntax:
 *   Headings        # H1 … ###### H6, Setext (=== / ---)
 *   Bold            **text** or __text__
 *   Italic          *text* or _text_
 *   Bold+italic     ***text***
 *   Strikethrough   ~~text~~
 *   Inline code     `code`
 *   Code blocks     ```lang … ```  or  ~~~…~~~
 *   Blockquotes     > text (nestable)
 *   Unordered list  - / * / + (two-space indent for nesting)
 *   Ordered list    1. 2. …
 *   Tables          GFM pipe tables
 *   Horizontal rule --- / *** / ___
 *   Links           [text](url) → text only (no URL in PDF)
 *   Images          ![alt](url) → [alt]
 *   Hard line break line ending with 2 spaces
 */
import { htmlToPDF } from './html'
import type { HtmlToPdfOptions } from './html'

export type MarkdownToPdfOptions = HtmlToPdfOptions

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert a Markdown string to a PDF `Uint8Array`.
 *
 * @example
 * ```ts
 * const pdf = markdownToPDF('# Hello\n\nThis is **bold** and *italic* text.')
 * ```
 */
export function markdownToPDF(markdown: string, opts?: MarkdownToPdfOptions): Uint8Array {
  return htmlToPDF(markdownToHTML(markdown), opts)
}

/**
 * Convert a Markdown string to an HTML string.
 * Useful if you want to inspect or customise the HTML before rendering.
 */
export function markdownToHTML(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // ── Fenced code block (``` or ~~~) ─────────────────────────────────────
    const fenceM = /^(`{3,}|~{3,})(\S*)/.exec(line)
    if (fenceM) {
      const fence = fenceM[1]
      i++
      const code: string[] = []
      while (i < lines.length && !lines[i].startsWith(fence)) {
        code.push(escapeHTML(lines[i]))
        i++
      }
      i++ // closing fence
      out.push(`<pre><code>${code.join('\n')}</code></pre>`)
      continue
    }

    // ── ATX heading  # … ###### ────────────────────────────────────────────
    const hM = /^(#{1,6})\s+(.+?)(?:\s+#+\s*)?$/.exec(line)
    if (hM) {
      const n = hM[1].length
      out.push(`<h${n}>${processInline(hM[2])}</h${n}>`)
      i++
      continue
    }

    // ── Horizontal rule  --- / *** / ___ ───────────────────────────────────
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr/>')
      i++
      continue
    }

    // ── Blockquote  > ──────────────────────────────────────────────────────
    if (/^>\s?/.test(line)) {
      const bqLines: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        bqLines.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      // Recursively convert blockquote content (supports nested headings, lists, etc.)
      out.push(`<blockquote>${markdownToHTML(bqLines.join('\n'))}</blockquote>`)
      continue
    }

    // ── Unordered list  - / * / + ──────────────────────────────────────────
    if (/^(\s{0,3})[-*+]\s/.test(line)) {
      const [html, next] = buildList(lines, i, false)
      out.push(...html)
      i = next
      continue
    }

    // ── Ordered list  1. 2. … ─────────────────────────────────────────────
    if (/^\d+\.\s/.test(line)) {
      const [html, next] = buildList(lines, i, true)
      out.push(...html)
      i = next
      continue
    }

    // ── GFM Table ──────────────────────────────────────────────────────────
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const headers = splitTableRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]))
        i++
      }
      out.push(buildTable(headers, rows))
      continue
    }

    // ── Setext heading  text\n=== or text\n--- ─────────────────────────────
    if (i + 1 < lines.length && line.trim() !== '') {
      if (/^=+\s*$/.test(lines[i + 1])) {
        out.push(`<h1>${processInline(line)}</h1>`)
        i += 2; continue
      }
      if (/^-{2,}\s*$/.test(lines[i + 1])) {
        out.push(`<h2>${processInline(line)}</h2>`)
        i += 2; continue
      }
    }

    // ── Blank line ─────────────────────────────────────────────────────────
    if (line.trim() === '') { i++; continue }

    // ── Paragraph ──────────────────────────────────────────────────────────
    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !isBlockStart(lines[i]) &&
      !(i + 1 < lines.length && (/^=+\s*$/.test(lines[i + 1]) || /^-{2,}\s*$/.test(lines[i + 1])))
    ) {
      const l = lines[i]
      paraLines.push(l.endsWith('  ') ? l.trimEnd() + '<br/>' : l)
      i++
    }
    if (paraLines.length > 0) {
      out.push(`<p>${processInline(paraLines.join(' '))}</p>`)
    }
  }

  return out.join('\n')
}

// ─── Inline processing ────────────────────────────────────────────────────────

function processInline(text: string): string {
  // Protect inline code from further processing
  const codes: string[] = []
  text = text.replace(/`([^`]+)`/g, (_, c) => {
    const idx = codes.length
    codes.push(`<code>${escapeHTML(c)}</code>`)
    return `\x00CODE${idx}\x00`
  })

  // Images first (placeholder to protect from link pattern): ![alt](url) → [alt]
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '\x01$1\x01')
  // Links [text](url) → text only (no clickable URL in PDF)
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  // Restore image alt text as [alt]
  text = text.replace(/\x01([^\x01]*)\x01/g, '[$1]')

  // Bold + italic
  text = text.replace(/\*{3}([^*\n]+)\*{3}/g, '<b><i>$1</i></b>')
  text = text.replace(/_{3}([^_\n]+)_{3}/g, '<b><i>$1</i></b>')
  // Bold
  text = text.replace(/\*{2}([^*\n]+)\*{2}/g, '<b>$1</b>')
  text = text.replace(/_{2}([^_\n]+)_{2}/g, '<b>$1</b>')
  // Italic
  text = text.replace(/\*([^*\n]+)\*/g, '<i>$1</i>')
  text = text.replace(/_([^_\n]+)_/g, '<i>$1</i>')
  // Strikethrough
  text = text.replace(/~~([^~\n]+)~~/g, '<del>$1</del>')

  // Restore inline code
  text = text.replace(/\x00CODE(\d+)\x00/g, (_, n) => codes[parseInt(n)])
  return text
}

// ─── Block helpers ────────────────────────────────────────────────────────────

function escapeHTML(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function isBlockStart(line: string): boolean {
  return /^(#{1,6}\s|[-*+]\s|\d+\.\s|`{3,}|~{3,}|>\s?|(\*{3,}|-{3,}|_{3,})\s*$)/.test(line)
}

function isTableSep(line: string): boolean {
  return /^\|?[\s|:\-]+\|?$/.test(line) && line.includes('-')
}

function splitTableRow(line: string): string[] {
  const parts = line.split('|').map(c => c.trim())
  // Remove leading/trailing empty cells from | outer | borders
  if (parts.length > 0 && parts[0] === '') parts.shift()
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
  return parts
}

function buildTable(headers: string[], rows: string[][]): string {
  const ths = headers.map(h => `<th>${processInline(h)}</th>`).join('')
  const trs = rows.map(row =>
    '<tr>' + row.map(c => `<td>${processInline(c)}</td>`).join('') + '</tr>'
  ).join('\n')
  return `<table><tr>${ths}</tr>\n${trs}</table>`
}

/** Collect list HTML from lines starting at index i. Returns [htmlLines, nextIndex]. */
function buildList(lines: string[], start: number, ordered: boolean): [string[], number] {
  const tag = ordered ? 'ol' : 'ul'
  const re  = ordered ? /^\d+\.\s+/ : /^\s*[-*+]\s+/
  const out: string[] = [`<${tag}>`]
  let i = start
  while (i < lines.length && (ordered ? /^\d+\.\s/.test(lines[i]) : /^\s*[-*+]\s/.test(lines[i]))) {
    const text = lines[i].replace(re, '')
    // Nested list on next line? (indented by 2+ spaces)
    if (i + 1 < lines.length && /^\s{2,}[-*+\d]/.test(lines[i + 1])) {
      out.push(`<li>${processInline(text)}`)
      i++
      const subItems: string[] = []
      while (i < lines.length && /^\s{2,}[-*+\d]/.test(lines[i])) {
        subItems.push(lines[i].replace(/^\s+/, ''))
        i++
      }
      const subTag = ordered ? 'ol' : 'ul'
      out.push(`<${subTag}>`)
      for (const sub of subItems) {
        const subText = sub.replace(ordered ? /^\d+\.\s+/ : /^[-*+]\s+/, '')
        out.push(`<li>${processInline(subText)}</li>`)
      }
      out.push(`</${subTag}></li>`)
    } else {
      out.push(`<li>${processInline(text)}</li>`)
      i++
    }
  }
  out.push(`</${tag}>`)
  return [out, i]
}
