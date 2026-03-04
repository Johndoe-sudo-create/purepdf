/**
 * purepdf — PDF generation, parsing, and conversion. Zero dependencies.
 */

// ── Generation ────────────────────────────────────────────────────────────────
export { PDFDocument }                          from './writer'

// ── Operations ────────────────────────────────────────────────────────────────
export { extractText, mergePDFs, splitPDF, extractPages } from './reader'

// ── HTML → PDF ────────────────────────────────────────────────────────────────
export { htmlToPDF }                            from './html'
export type { HtmlToPdfOptions }                from './html'

// ── Markdown → PDF ────────────────────────────────────────────────────────────
export { markdownToPDF, markdownToHTML }        from './markdown'
export type { MarkdownToPdfOptions }            from './markdown'

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  PageSize, FontName,
  DocumentOptions, AddPageOptions,
  TextOptions, GraphicsOptions, ImageOptions,
  TableData, TableOptions,
} from './types'

// ── Utilities ─────────────────────────────────────────────────────────────────
export { measureText, wrapText } from './metrics'
export { PAGE_SIZES }            from './constants'
