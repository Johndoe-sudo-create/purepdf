import { describe, it, expect } from 'vitest'
import {
  PDFDocument, extractText, mergePDFs, splitPDF, extractPages,
  htmlToPDF, markdownToPDF, markdownToHTML, measureText, PAGE_SIZES,
} from './index'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isPDF(b: Uint8Array): boolean {
  const header = String.fromCharCode(...b.slice(0, 5))
  return header === '%PDF-'
}

// ─── PDFDocument ──────────────────────────────────────────────────────────────

describe('PDFDocument', () => {
  it('produces valid PDF bytes', () => {
    const doc = new PDFDocument()
    const pdf = doc.save()
    expect(pdf).toBeInstanceOf(Uint8Array)
    expect(isPDF(pdf)).toBe(true)
    expect(pdf.length).toBeGreaterThan(200)
  })

  it('contains %%EOF marker', () => {
    const doc = new PDFDocument()
    const pdf = doc.save()
    const text = new TextDecoder().decode(pdf)
    expect(text).toContain('%%EOF')
  })

  it('contains xref section', () => {
    const doc = new PDFDocument()
    const text = new TextDecoder().decode(doc.save())
    expect(text).toContain('xref')
    expect(text).toContain('startxref')
  })

  it('default page is A4', () => {
    const doc = new PDFDocument()
    const { width, height } = doc.getPageSize()
    expect(width).toBeCloseTo(595.28, 1)
    expect(height).toBeCloseTo(841.89, 1)
  })

  it('respects custom page size', () => {
    const doc = new PDFDocument({ size: 'Letter' })
    const { width, height } = doc.getPageSize()
    expect(width).toBe(612)
    expect(height).toBe(792)
  })

  it('respects custom [w, h] size', () => {
    const doc = new PDFDocument({ size: [400, 600] })
    const { width, height } = doc.getPageSize()
    expect(width).toBe(400)
    expect(height).toBe(600)
  })

  it('can add pages', () => {
    const doc = new PDFDocument()
    doc.addPage().addPage()
    const text = new TextDecoder().decode(doc.save())
    expect(text).toContain('/Count 3')
  })

  it('text() embeds font reference', () => {
    const doc = new PDFDocument()
    doc.text('Hello World', 50, 750)
    const text = new TextDecoder().decode(doc.save())
    expect(text).toContain('Helvetica')
    expect(text).toContain('Hello World')
  })

  it('text() with Helvetica-Bold', () => {
    const doc = new PDFDocument()
    doc.text('Bold', 50, 750, { font: 'Helvetica-Bold', size: 16 })
    const text = new TextDecoder().decode(doc.save())
    expect(text).toContain('Helvetica-Bold')
  })

  it('text() returns y below last line', () => {
    const doc = new PDFDocument()
    const y = doc.text('Line', 50, 750, { size: 12, lineHeight: 1.2 })
    expect(y).toBeLessThan(750)
  })

  it('text() wraps long lines', () => {
    const doc = new PDFDocument()
    const longText = 'This is a very long sentence that should be wrapped across multiple lines in the PDF document.'
    doc.text(longText, 50, 750, { maxWidth: 200 })
    const text = new TextDecoder().decode(doc.save())
    expect(text).toContain('BT') // multiple text objects
  })

  it('rect() adds rectangle path', () => {
    const doc = new PDFDocument()
    doc.rect(50, 600, 200, 100, { stroke: '#000000', fill: '#ffffcc' })
    const text = new TextDecoder().decode(doc.save())
    expect(text).toContain('re')  // PDF rect operator
  })

  it('line() adds path', () => {
    const doc = new PDFDocument()
    doc.line(50, 700, 545, 700, { stroke: '#cccccc' })
    const text = new TextDecoder().decode(doc.save())
    expect(text).toContain(' m ')
    expect(text).toContain(' l')
  })

  it('circle() adds bezier curves', () => {
    const doc = new PDFDocument()
    doc.circle(300, 400, 50, { stroke: '#0000ff', fill: '#ccccff' })
    const text = new TextDecoder().decode(doc.save())
    expect(text).toContain(' c')  // bezier curve operator
  })

  it('table() draws rows', () => {
    const doc = new PDFDocument()
    doc.table(
      { headers: ['Name', 'Score'], rows: [['Alice', '95'], ['Bob', '82']] },
      50, 700,
      { colWidths: [200, 100] },
    )
    const text = new TextDecoder().decode(doc.save())
    expect(text).toContain('Name')
    expect(text).toContain('Alice')
    expect(text).toContain('95')
  })

  it('table() without headers', () => {
    const doc = new PDFDocument()
    const y = doc.table({ rows: [['a', 'b'], ['c', 'd']] }, 50, 700)
    expect(y).toBeLessThan(700)
  })

  it('table() with empty data does not throw', () => {
    const doc = new PDFDocument()
    expect(() => doc.table({ rows: [] }, 50, 700)).not.toThrow()
  })

  it('rect() with stroke:false and fill draws only fill (no accidental stroke)', () => {
    const doc = new PDFDocument()
    doc.rect(50, 600, 200, 100, { fill: '#ff0000', stroke: false })
    const text = new TextDecoder().decode(doc.save())
    // Should contain fill operator 'f', must NOT have standalone S after the rect
    // The content stream should have 'f\n' not 'B\n' or 'S\n'
    expect(text).toContain('\nf\n')
    expect(text).not.toContain('\nB\n')
  })

  it('multi-page document with content on each page', () => {
    const doc = new PDFDocument()
    doc.text('Page 1', 50, 750)
    doc.addPage()
    doc.text('Page 2', 50, 750)
    const text = new TextDecoder().decode(doc.save())
    expect(text).toContain('Page 1')
    expect(text).toContain('Page 2')
    expect(text).toContain('/Count 2')
  })

  it('font used on multiple pages is registered once', () => {
    const doc = new PDFDocument()
    doc.text('P1', 50, 750, { font: 'Courier' })
    doc.addPage()
    doc.text('P2', 50, 750, { font: 'Courier' })
    const text = new TextDecoder().decode(doc.save())
    // Only one Courier font object
    const matches = text.match(/\/BaseFont \/Courier[^-]/g) ?? []
    expect(matches.length).toBe(1)
  })
})

// ─── measureText ──────────────────────────────────────────────────────────────

describe('measureText', () => {
  it('returns 0 for empty string', () => {
    expect(measureText('', 'Helvetica', 12)).toBe(0)
  })

  it('returns positive width for non-empty string', () => {
    expect(measureText('Hello', 'Helvetica', 12)).toBeGreaterThan(0)
  })

  it('scales linearly with font size', () => {
    const w12 = measureText('A', 'Helvetica', 12)
    const w24 = measureText('A', 'Helvetica', 24)
    expect(w24).toBeCloseTo(w12 * 2, 5)
  })

  it('Courier is monospace — all chars same width', () => {
    const wA = measureText('A', 'Courier', 12)
    const wm = measureText('m', 'Courier', 12)
    expect(wA).toBe(wm)
  })
})

// ─── PAGE_SIZES ───────────────────────────────────────────────────────────────

describe('PAGE_SIZES', () => {
  it('A4 is 595.28 × 841.89', () => {
    expect(PAGE_SIZES.A4[0]).toBeCloseTo(595.28, 1)
    expect(PAGE_SIZES.A4[1]).toBeCloseTo(841.89, 1)
  })
  it('Letter is 612 × 792', () => {
    expect(PAGE_SIZES.Letter).toEqual([612, 792])
  })
})

// ─── extractText ──────────────────────────────────────────────────────────────

describe('extractText', () => {
  it('extracts text from a generated PDF', () => {
    const doc = new PDFDocument()
    doc.text('Hello PDF', 50, 750)
    doc.text('Second line', 50, 720)
    const pdf = doc.save()
    const text = extractText(pdf)
    expect(text).toContain('Hello PDF')
    expect(text).toContain('Second line')
  })

  it('extracts text from multiple pages', () => {
    const doc = new PDFDocument()
    doc.text('Page one', 50, 750)
    doc.addPage()
    doc.text('Page two', 50, 750)
    const pdf = doc.save()
    const text = extractText(pdf)
    expect(text).toContain('Page one')
    expect(text).toContain('Page two')
  })

  it('returns empty string for page with no text', () => {
    const doc = new PDFDocument()
    doc.rect(50, 600, 100, 100)
    const pdf = doc.save()
    const text = extractText(pdf)
    expect(typeof text).toBe('string')
  })
})

// ─── mergePDFs ────────────────────────────────────────────────────────────────

describe('mergePDFs', () => {
  it('returns valid PDF', () => {
    const a = new PDFDocument()
    a.text('Doc A', 50, 750)
    const b = new PDFDocument()
    b.text('Doc B', 50, 750)
    const merged = mergePDFs([a.save(), b.save()])
    expect(isPDF(merged)).toBe(true)
  })

  it('merged PDF has correct page count', () => {
    const a = new PDFDocument()
    a.text('A1', 50, 750)
    const b = new PDFDocument()
    b.text('B1', 50, 750)
    b.addPage()
    b.text('B2', 50, 750)
    const merged = mergePDFs([a.save(), b.save()])
    const text = new TextDecoder().decode(merged)
    expect(text).toContain('/Count 3')
  })

  it('single PDF passthrough', () => {
    const doc = new PDFDocument()
    doc.text('Only', 50, 750)
    const pdf = doc.save()
    expect(mergePDFs([pdf])).toBe(pdf)
  })

  it('throws on empty array', () => {
    expect(() => mergePDFs([])).toThrow()
  })

  it('preserves font resources in merged output', () => {
    const a = new PDFDocument()
    a.text('Helvetica text', 50, 750, { font: 'Helvetica' })
    const b = new PDFDocument()
    b.text('Bold text', 50, 750, { font: 'Helvetica-Bold' })
    const merged = mergePDFs([a.save(), b.save()])
    const text = new TextDecoder().decode(merged)
    // Both fonts should appear as BaseFont entries in the merged PDF
    expect(text).toContain('/BaseFont /Helvetica')
    expect(text).toContain('/BaseFont /Helvetica-Bold')
  })
})

// ─── splitPDF ─────────────────────────────────────────────────────────────────

describe('splitPDF', () => {
  it('splits a 3-page PDF into 3 parts', () => {
    const doc = new PDFDocument()
    doc.text('P1', 50, 750)
    doc.addPage()
    doc.text('P2', 50, 750)
    doc.addPage()
    doc.text('P3', 50, 750)
    const pages = splitPDF(doc.save())
    expect(pages.length).toBe(3)
    for (const p of pages) expect(isPDF(p)).toBe(true)
  })

  it('each split page is a single-page PDF', () => {
    const doc = new PDFDocument()
    doc.text('X', 50, 750)
    doc.addPage()
    doc.text('Y', 50, 750)
    const pages = splitPDF(doc.save())
    for (const p of pages) {
      const text = new TextDecoder().decode(p)
      expect(text).toContain('/Count 1')
    }
  })
})

// ─── extractPages ─────────────────────────────────────────────────────────────

describe('extractPages', () => {
  it('extracts specific pages', () => {
    const doc = new PDFDocument()
    doc.text('P1', 50, 750)
    doc.addPage()
    doc.text('P2', 50, 750)
    doc.addPage()
    doc.text('P3', 50, 750)
    const extracted = extractPages(doc.save(), [0, 2])
    const text = new TextDecoder().decode(extracted)
    expect(text).toContain('/Count 2')
  })

  it('throws if no pages match', () => {
    const doc = new PDFDocument()
    doc.text('Only', 50, 750)
    expect(() => extractPages(doc.save(), [99])).toThrow()
  })
})

// ─── htmlToPDF ────────────────────────────────────────────────────────────────

describe('htmlToPDF', () => {
  it('produces valid PDF', () => {
    const pdf = htmlToPDF('<h1>Title</h1><p>Hello World</p>')
    expect(isPDF(pdf)).toBe(true)
  })

  it('includes heading text', () => {
    const pdf = htmlToPDF('<h1>My Report</h1>')
    const extracted = extractText(pdf)
    expect(extracted).toContain('My')
    expect(extracted).toContain('Report')
  })

  it('handles bold and italic', () => {
    const pdf = htmlToPDF('<p><b>Bold</b> and <i>italic</i> text</p>')
    const extracted = extractText(pdf)
    expect(extracted).toContain('Bold')
    expect(extracted).toContain('italic')
  })

  it('handles lists', () => {
    const pdf = htmlToPDF('<ul><li>Item 1</li><li>Item 2</li></ul>')
    const extracted = extractText(pdf)
    expect(extracted).toContain('Item')
    expect(extracted).toContain('1')
  })

  it('handles hr rule', () => {
    const pdf = htmlToPDF('<p>Before</p><hr/><p>After</p>')
    expect(isPDF(pdf)).toBe(true)
  })

  it('handles empty string', () => {
    const pdf = htmlToPDF('')
    expect(isPDF(pdf)).toBe(true)
  })

  it('respects custom page size', () => {
    const pdf = htmlToPDF('<p>Test</p>', { size: 'Letter' })
    const text = new TextDecoder().decode(pdf)
    expect(text).toContain('612')
  })

  it('handles inline code without splitting paragraph', () => {
    const pdf = htmlToPDF('<p>Use <code>fn()</code> to call.</p>')
    const extracted = extractText(pdf)
    expect(extracted).toContain('Use')
    expect(extracted).toContain('fn()')
    expect(extracted).toContain('call')
  })

  it('handles del/strikethrough', () => {
    const pdf = htmlToPDF('<p><del>old</del> new</p>')
    const extracted = extractText(pdf)
    expect(extracted).toContain('old')
    expect(extracted).toContain('new')
  })

  it('handles blockquote', () => {
    const pdf = htmlToPDF('<blockquote><p>Quoted text</p></blockquote>')
    const extracted = extractText(pdf)
    expect(extracted).toContain('Quoted')
    expect(extracted).toContain('text')
  })
})

// ─── markdownToHTML ───────────────────────────────────────────────────────────

describe('markdownToHTML', () => {
  it('converts headings', () => {
    expect(markdownToHTML('# H1')).toContain('<h1>')
    expect(markdownToHTML('## H2')).toContain('<h2>')
    expect(markdownToHTML('###### H6')).toContain('<h6>')
  })

  it('converts bold and italic', () => {
    const html = markdownToHTML('**bold** and *italic*')
    expect(html).toContain('<b>')
    expect(html).toContain('<i>')
  })

  it('converts bold+italic', () => {
    expect(markdownToHTML('***bitalic***')).toContain('<b><i>')
  })

  it('converts strikethrough', () => {
    expect(markdownToHTML('~~strike~~')).toContain('<del>')
  })

  it('converts inline code', () => {
    const html = markdownToHTML('Use `console.log()` here')
    expect(html).toContain('<code>')
    expect(html).toContain('console.log()')
  })

  it('converts fenced code blocks', () => {
    const md = '```js\nconsole.log("hi")\n```'
    const html = markdownToHTML(md)
    expect(html).toContain('<pre>')
    expect(html).toContain('console.log')
  })

  it('converts blockquotes', () => {
    const html = markdownToHTML('> This is a quote')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('This is a quote')
  })

  it('converts unordered lists', () => {
    const html = markdownToHTML('- item A\n- item B')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>')
    expect(html).toContain('item A')
  })

  it('converts ordered lists', () => {
    const html = markdownToHTML('1. first\n2. second')
    expect(html).toContain('<ol>')
    expect(html).toContain('first')
  })

  it('converts GFM tables', () => {
    const md = '| Name | Score |\n|------|-------|\n| Alice | 95 |'
    const html = markdownToHTML(md)
    expect(html).toContain('<table>')
    expect(html).toContain('<th>')
    expect(html).toContain('Alice')
  })

  it('converts horizontal rule', () => {
    expect(markdownToHTML('---')).toContain('<hr')
    expect(markdownToHTML('***')).toContain('<hr')
  })

  it('converts setext headings', () => {
    expect(markdownToHTML('Title\n=====')).toContain('<h1>')
    expect(markdownToHTML('Sub\n---')).toContain('<h2>')
  })

  it('strips link URL but keeps text', () => {
    const html = markdownToHTML('[click here](https://example.com)')
    expect(html).toContain('click here')
    expect(html).not.toContain('https://')
  })

  it('converts image to alt text', () => {
    const html = markdownToHTML('![logo](https://example.com/img.png)')
    expect(html).toContain('[logo]')
    expect(html).not.toContain('https://')
  })

  it('escapes HTML in code', () => {
    const html = markdownToHTML('```\n<div>test</div>\n```')
    expect(html).toContain('&lt;div&gt;')
  })
})

// ─── markdownToPDF ────────────────────────────────────────────────────────────

describe('markdownToPDF', () => {
  it('produces valid PDF', () => {
    const pdf = markdownToPDF('# Title\n\nHello **World**')
    expect(isPDF(pdf)).toBe(true)
  })

  it('renders heading text', () => {
    const pdf = markdownToPDF('# My Heading')
    const text = extractText(pdf)
    expect(text).toContain('My')
    expect(text).toContain('Heading')
  })

  it('renders bold text', () => {
    const pdf = markdownToPDF('This is **bold** text')
    const text = extractText(pdf)
    expect(text).toContain('bold')
  })

  it('renders list items', () => {
    const pdf = markdownToPDF('- alpha\n- beta\n- gamma')
    const text = extractText(pdf)
    expect(text).toContain('alpha')
    expect(text).toContain('gamma')
  })

  it('renders a code block', () => {
    const pdf = markdownToPDF('```\nconst x = 1\n```')
    const text = extractText(pdf)
    expect(text).toContain('const')
  })

  it('renders a table', () => {
    const md = '| Name | Value |\n|------|-------|\n| foo | 42 |'
    const pdf = markdownToPDF(md)
    const text = extractText(pdf)
    expect(text).toContain('foo')
    expect(text).toContain('42')
  })

  it('renders a full document', () => {
    const md = `# Report

This is a paragraph with **bold**, *italic*, and \`code\`.

## Section 2

> A blockquote with important info.

- Item 1
- Item 2

| Col A | Col B |
|-------|-------|
| 1     | 2     |

---

The end.`
    const pdf = markdownToPDF(md)
    expect(isPDF(pdf)).toBe(true)
    const text = extractText(pdf)
    expect(text).toContain('Report')
    expect(text).toContain('bold')
    expect(text).toContain('Item 1')
    expect(text).toContain('end')
  })

  it('respects page size option', () => {
    const pdf = markdownToPDF('# Hi', { size: 'Letter' })
    const decoded = new TextDecoder().decode(pdf)
    expect(decoded).toContain('612')
  })
})
