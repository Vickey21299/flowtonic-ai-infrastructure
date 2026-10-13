import { useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  description?: ReactNode
  /** Small uppercase line above the title (e.g. breadcrumb or section name). */
  eyebrow?: ReactNode
  /** Extra line under the title, e.g. badges / metadata. */
  meta?: ReactNode
  /** Right-aligned buttons. */
  actions?: ReactNode
  /** Overrides the browser tab title (defaults to `title`). */
  documentTitle?: string
  className?: string
}

/** Page title block. Renders the page <h1 id="page-title"> and sets document.title to "<title> · Flowtonic". */
export function PageHeader({ title, description, eyebrow, meta, actions, documentTitle, className }: PageHeaderProps) {
  const tabTitle = documentTitle ?? title
  useEffect(() => {
    document.title = `${tabTitle} · Flowtonic`
  }, [tabTitle])

  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0 space-y-1">
        {eyebrow && <div className="text-xs uppercase tracking-wider text-muted-foreground">{eyebrow}</div>}
        <h1 id="page-title" className="text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {description && <div className="max-w-3xl text-sm text-muted-foreground">{description}</div>}
        {meta && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
