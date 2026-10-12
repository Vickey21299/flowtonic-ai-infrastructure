import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <section className="space-y-3 py-12 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">This address does not match any screen.</p>
      <Link to="/" className="inline-block text-sm font-medium text-accent underline underline-offset-4">
        Back to overview
      </Link>
    </section>
  )
}
