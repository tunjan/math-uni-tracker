import { texToHtml } from '@/lib/tex'

export function Tex({ text, className }: { text: string; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: texToHtml(text) }} />
}
