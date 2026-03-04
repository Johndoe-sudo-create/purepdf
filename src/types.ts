// ─── Page ────────────────────────────────────────────────────────────────────

export type PageSize = 'A3' | 'A4' | 'A5' | 'Letter' | 'Legal'

// ─── Fonts ───────────────────────────────────────────────────────────────────

export type FontName =
  | 'Helvetica' | 'Helvetica-Bold' | 'Helvetica-Oblique' | 'Helvetica-BoldOblique'
  | 'Times-Roman' | 'Times-Bold' | 'Times-Italic' | 'Times-BoldItalic'
  | 'Courier' | 'Courier-Bold' | 'Courier-Oblique' | 'Courier-BoldOblique'
  | 'Symbol' | 'ZapfDingbats'

// ─── Options ─────────────────────────────────────────────────────────────────

export interface DocumentOptions {
  /** Page size (default: 'A4'). */
  size?: PageSize | [number, number]
}

export interface AddPageOptions {
  size?: PageSize | [number, number]
}

export interface TextOptions {
  font?:       FontName
  size?:       number
  /** '#RRGGBB' or '#RGB'. Default: '#000000'. */
  color?:      string
  align?:      'left' | 'center' | 'right'
  /** Wrap text at this width (points). */
  maxWidth?:   number
  /** Line height multiplier (default: 1.2). */
  lineHeight?: number
}

export interface GraphicsOptions {
  /** Stroke color '#RRGGBB', or false to skip stroke. Default: '#000000'. */
  stroke?:    string | false
  /** Fill color '#RRGGBB', or false to skip fill. Default: false. */
  fill?:      string | false
  lineWidth?: number
}

export interface ImageOptions {
  /** Render width in points. Height is auto-calculated from aspect ratio unless also given. */
  width?:  number
  /** Render height in points. */
  height?: number
}

export interface TableOptions {
  /** Column widths in points. If omitted, columns are equally spaced across 400pt. */
  colWidths?:          number[]
  rowHeight?:          number
  font?:               FontName
  fontSize?:           number
  headerFont?:         FontName
  headerFontSize?:     number
  /** Header row background fill. Default: '#1a73e8'. */
  headerBackground?:   string
  /** Header row text color. Default: '#ffffff'. */
  headerColor?:        string
  /** Alternating row background. Default: none. */
  alternateRowColor?:  string
  /** Border color. Default: '#cccccc'. */
  borderColor?:        string
  /** Cell padding in points. Default: 6. */
  cellPadding?:        number
}

export interface TableData {
  headers?: string[]
  rows:     string[][]
}
