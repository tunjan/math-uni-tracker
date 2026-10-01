import katex from 'katex'

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const cache = new Map<string, string>()

/** Text with inline `$…$` math → HTML. Odd segments of a split on `$` are math. */
export function texToHtml(text: string, throwOnError = false): string {
  const hit = cache.get(text)
  if (hit !== undefined && !throwOnError) return hit
  const html = text
    .split('$')
    .map((seg, i) => (i % 2 ? katex.renderToString(seg, { throwOnError, output: 'html' }) : escape(seg)))
    .join('')
  if (cache.size > 5000) cache.clear() // ponytail: crude bound, LRU if notes get huge
  cache.set(text, html)
  return html
}

/** Plain-text version for search: drops `$` but keeps the LaTeX source. */
export const texPlain = (text: string) => text.replaceAll('$', '')
