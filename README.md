# purepdf

[![npm version](https://img.shields.io/npm/v/purepdf.svg)](https://www.npmjs.com/package/purepdf)
[![license](https://img.shields.io/npm/l/purepdf.svg)](./LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/purepdf)](https://bundlephobia.com/package/purepdf)

**Zero-dependency** PDF library for Node.js and browsers.

Generate PDF documents from scratch, merge, split, extract text, or convert HTML to PDF — all without any external runtime dependencies.

---

## Features

- **Generate PDFs** — text, shapes, JPEG images, tables
- **14 built-in fonts** — all standard PDF Type1 fonts (Helvetica, Times, Courier, …)
- **Merge PDFs** — combine any number of PDF files into one
- **Split PDFs** — extract individual pages or specific page ranges
- **Extract text** — get the plain text content from any simple PDF
- **HTML → PDF** — convert basic HTML (headings, paragraphs, lists, bold/italic, tables) to PDF
- **ESM + CJS** — works in Node.js, Bun, Deno, and modern browsers
- **Zero dependencies** — no external packages, no native bindings
- **TypeScript** — full type definitions included

---

## Install

```bash
npm install purepdf
```

---

## Quick start

### Generate a PDF

```typescript
import { PDFDocument } from 'purepdf'
import { writeFileSync } from 'fs'

const doc = new PDFDocument({ size: 'A4' })

// Title
doc.text('Annual Report 2026', 50, 780, {
  font: 'Helvetica-Bold',
  size: 22,
  color: '#1a1a1a',
})

// Paragraph with auto word-wrap
doc.text(
  'This document was generated entirely without external dependencies using purepdf.',
  50, 740,
  { font: 'Helvetica', size: 11, maxWidth: 495 },
)

// Divider line
doc.line(50, 720, 545, 720, { stroke: '#cccccc', lineWidth: 0.5 })

// Coloured rectangle
doc.rect(50, 650, 200, 60, { fill: '#e8f4fd', stroke: '#4a90d9', lineWidth: 1 })

// Table
doc.table(
  {
    headers: ['Product',   'Qty', 'Price'],
    rows:    [
      ['Widget A',  '10', '$5.00'],
      ['Widget B',  '3',  '$12.50'],
      ['Widget C',  '25', '$2.00'],
    ],
  },
  50, 630,
  {
    colWidths:         [250, 80, 80],
    headerBackground:  '#1a73e8',
    headerColor:       '#ffffff',
    alternateRowColor: '#f8f8f8',
    borderColor:       '#dddddd',
  },
)

// Second page
doc.addPage()
doc.text('Page 2', 50, 780, { font: 'Helvetica', size: 14 })

writeFileSync('report.pdf', doc.save())
```

---

### Merge PDFs

```typescript
import { mergePDFs } from 'purepdf'
import { readFileSync, writeFileSync } from 'fs'

const a = readFileSync('invoice.pdf')
const b = readFileSync('appendix.pdf')
const merged = mergePDFs([a, b])
writeFileSync('complete.pdf', merged)
```

---

### Split a PDF

```typescript
import { splitPDF, extractPages } from 'purepdf'
import { readFileSync, writeFileSync } from 'fs'

const pdf = readFileSync('book.pdf')

// One file per page
const pages = splitPDF(pdf)
pages.forEach((page, i) => writeFileSync(`page-${i + 1}.pdf`, page))

// Extract specific pages (0-based indices)
const firstAndLast = extractPages(pdf, [0, pages.length - 1])
writeFileSync('excerpt.pdf', firstAndLast)
```

---

### Extract text

```typescript
import { extractText } from 'purepdf'
import { readFileSync } from 'fs'

const pdf = readFileSync('document.pdf')
const text = extractText(pdf)
console.log(text)
```

---

### Markdown → PDF

```typescript
import { markdownToPDF } from 'purepdf'
import { writeFileSync } from 'fs'

const md = `
# Annual Report

This document was generated from **Markdown** using *purepdf*.

## Highlights

- Zero dependencies
- Works in Node.js and browsers
- Supports tables, blockquotes, code blocks

| Quarter | Revenue |
|---------|---------|
| Q1      | $1.2M   |
| Q2      | $1.8M   |

> Revenue grew **50%** quarter over quarter.

\`\`\`ts
import { markdownToPDF } from 'purepdf'
const pdf = markdownToPDF('# Hello')
\`\`\`
`

writeFileSync('report.pdf', markdownToPDF(md))
```

---

### HTML → PDF

```typescript
import { htmlToPDF } from 'purepdf'
import { writeFileSync } from 'fs'

const html = `
  <h1>My Document</h1>
  <p>Hello <b>World</b>! This is <i>purepdf</i>.</p>
  <hr/>
  <ul>
    <li>Zero dependencies</li>
    <li>Works in Node.js and browsers</li>
    <li>Full TypeScript support</li>
  </ul>
`

writeFileSync('output.pdf', htmlToPDF(html, { size: 'A4', margin: 60 }))
```

---

## API

### `new PDFDocument(options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `size` | `PageSize \| [w, h]` | `'A4'` | Page size |

#### Methods

| Method | Description |
|--------|-------------|
| `addPage(options?)` | Add a new page and make it current. Chainable. |
| `getPageSize()` | Returns `{ width, height }` in points. |
| `text(str, x, y, options?)` | Draw text. Returns the y below the last line. |
| `rect(x, y, w, h, options?)` | Draw a rectangle. |
| `line(x1, y1, x2, y2, options?)` | Draw a line. |
| `circle(cx, cy, r, options?)` | Draw a circle. |
| `image(jpegData, x, y, options?)` | Draw a JPEG image. |
| `table(data, x, y, options?)` | Draw a table. Returns the y below the last row. |
| `save()` | Serialise and return `Uint8Array`. |

#### `TextOptions`

| Option | Type | Default |
|--------|------|---------|
| `font` | `FontName` | `'Helvetica'` |
| `size` | `number` | `12` |
| `color` | `string` (`'#RRGGBB'`) | `'#000000'` |
| `align` | `'left' \| 'center' \| 'right'` | `'left'` |
| `maxWidth` | `number` | — |
| `lineHeight` | `number` | `1.2` |

#### `GraphicsOptions`

| Option | Type | Default |
|--------|------|---------|
| `stroke` | `string \| false` | `'#000000'` |
| `fill` | `string \| false` | `false` |
| `lineWidth` | `number` | `1` |

#### `ImageOptions`

| Option | Type | Description |
|--------|------|-------------|
| `width` | `number` | Render width in points. Height is auto-calculated. |
| `height` | `number` | Render height in points. |

#### `TableOptions`

| Option | Type | Default |
|--------|------|---------|
| `colWidths` | `number[]` | equal split across 400pt |
| `rowHeight` | `number` | `fontSize + padding*2` |
| `headerBackground` | `string` | `'#1a73e8'` |
| `headerColor` | `string` | `'#ffffff'` |
| `alternateRowColor` | `string` | — |
| `borderColor` | `string` | `'#cccccc'` |
| `cellPadding` | `number` | `6` |
| `font` | `FontName` | `'Helvetica'` |
| `fontSize` | `number` | `10` |

---

### `mergePDFs(pdfs: Uint8Array[]): Uint8Array`

Merge two or more PDFs. Pages from each input appear in order.

### `splitPDF(pdf: Uint8Array): Uint8Array[]`

Split into individual single-page PDFs.

### `extractPages(pdf: Uint8Array, indices: number[]): Uint8Array`

Extract specific pages (0-based indices) and return as one PDF.

### `extractText(pdf: Uint8Array): string`

Extract plain text from a PDF. Works on simple, unencrypted PDFs.

### `markdownToPDF(markdown: string, options?): Uint8Array`

Convert a Markdown string to PDF.

```ts
import { markdownToPDF } from 'purepdf'

const md = `
# My Report

This paragraph has **bold**, *italic*, ~~strikethrough~~, and \`inline code\`.

## Features

- Zero dependencies
- Works in Node.js and browsers

> Important: always validate your input.

| Name  | Score |
|-------|-------|
| Alice | 95    |
| Bob   | 82    |

\`\`\`ts
const pdf = markdownToPDF('# Hello')
\`\`\`
`

const pdf = markdownToPDF(md, { size: 'A4', margin: 60 })
```

**Supported Markdown syntax:**

| Feature | Syntax |
|---------|--------|
| Headings | `# H1` … `###### H6`, Setext (`===` / `---`) |
| Bold | `**text**` or `__text__` |
| Italic | `*text*` or `_text_` |
| Bold+italic | `***text***` |
| Strikethrough | `~~text~~` |
| Inline code | `` `code` `` |
| Code blocks | ` ```lang ``` ` |
| Blockquote | `> text` |
| Unordered list | `- ` / `* ` / `+ ` |
| Ordered list | `1. ` |
| Table (GFM) | `\| col \| col \|` |
| Horizontal rule | `---` / `***` / `___` |
| Link | `[text](url)` → shows text only |
| Image | `![alt](url)` → shows `[alt]` |
| Hard line break | Line ending with two spaces |

### `markdownToHTML(markdown: string): string`

Convert Markdown to an HTML string (useful for inspection or pre-processing).

### `htmlToPDF(html: string, options?): Uint8Array`

Convert HTML to PDF.

#### `HtmlToPdfOptions`

| Option | Type | Default |
|--------|------|---------|
| `size` | `PageSize \| [w, h]` | `'A4'` |
| `margin` | `number` | `50` |
| `baseFontSize` | `number` | `11` |
| `baseFont` | `FontName` | `'Times-Roman'` |

**Supported HTML tags**: `h1`–`h6`, `p`, `br`, `b`/`strong`, `i`/`em`, `u`, `ul`, `ol`, `li`, `table`, `tr`, `th`, `td`, `hr`, `pre`, `code`, `div`, `span`, `section`, `article`.

---

### `measureText(text, font, size): number`

Returns the rendered width of a string in points.

### `wrapText(text, font, size, maxWidth): string[]`

Splits text into lines that fit within `maxWidth`. Respects `\n`.

### `PAGE_SIZES`

```typescript
PAGE_SIZES.A4     // [595.28, 841.89]
PAGE_SIZES.A3     // [841.89, 1190.55]
PAGE_SIZES.A5     // [419.53, 595.28]
PAGE_SIZES.Letter // [612, 792]
PAGE_SIZES.Legal  // [612, 1008]
```

---

### Built-in fonts (`FontName`)

| Serif | Sans-serif | Monospace |
|-------|-----------|-----------|
| Times-Roman | Helvetica | Courier |
| Times-Bold | Helvetica-Bold | Courier-Bold |
| Times-Italic | Helvetica-Oblique | Courier-Oblique |
| Times-BoldItalic | Helvetica-BoldOblique | Courier-BoldOblique |

Also: `Symbol`, `ZapfDingbats`.

---

## Limitations

- **Fonts**: only the 14 standard PDF fonts (no custom/embedded fonts in v1)
- **Images**: JPEG only (PNG/GIF are not supported in v1)
- **HTML**: basic structural tags only; complex CSS, `<style>`, and `<script>` are ignored
- **PDF parsing**: traditional XRef tables only (PDF ≤ 1.4 style); PDFs with compressed XRef streams (PDF 1.5+) are not supported
- **Encryption**: encrypted PDFs are not supported
- **Text encoding**: Latin-1 / WinAnsiEncoding (chars 32–255). Characters outside this range are replaced with `?`

---

## Development

```bash
npm install
npm run build       # compile
npm test            # run tests
npm run typecheck   # TypeScript check
npm run test:coverage
```

---

## License

[MIT](./LICENSE)
