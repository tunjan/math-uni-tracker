import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { cn } from '@/lib/utils'

/** Markdown with KaTeX maths and GFM tables. Raw HTML is not rendered and remote images are never fetched. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('markdown', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}
        components={{
          img: ({ alt, src }) => <span className="text-muted-foreground">[image{alt ? `: ${alt}` : ''}{typeof src === 'string' ? ` — ${src}` : ''}]</span>,
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
        }}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
