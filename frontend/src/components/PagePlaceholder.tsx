import { useEffect } from 'react'
import { useParams } from 'react-router-dom'

interface PagePlaceholderProps {
  title: string
  spec: string
  phase: string
  description: string
}

/** Temporary page body used until a screen is integrated. Replaced page by page. */
export function PagePlaceholder({ title, spec, phase, description }: PagePlaceholderProps) {
  const params = useParams()
  const id = Object.values(params).find(Boolean)

  useEffect(() => {
    document.title = `${title} · Flownetic`
  }, [title])

  return (
    <section aria-labelledby="page-title" className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{spec}</p>
        <h1 id="page-title" className="text-2xl font-semibold tracking-tight">
          {title}
          {id && <span className="ml-2 font-normal text-muted-foreground">· {id}</span>}
        </h1>
      </div>
      <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-muted-foreground">
        <p>{description}</p>
        <p className="mt-2 text-xs">Not built yet — scheduled for {phase}.</p>
      </div>
    </section>
  )
}
