import type { PageSize } from './types'

/** Page dimensions in points [width, height]. 1 pt = 1/72 inch. */
export const PAGE_SIZES: Record<PageSize, [number, number]> = {
  A3:     [841.89, 1190.55],
  A4:     [595.28,  841.89],
  A5:     [419.53,  595.28],
  Letter: [612,     792   ],
  Legal:  [612,     1008  ],
}

/** Header comment bytes: 4 bytes > 127 signal binary file to FTP tools. */
export const PDF_BINARY_COMMENT = '%\xe2\xe3\xcf\xd3\n'
