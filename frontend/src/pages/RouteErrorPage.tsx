import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'

/** Last-resort error screen for a page that crashed while rendering. */
export function RouteErrorPage() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error'

  return (
    <section role="alert" className="mx-auto max-w-lg space-y-3 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Something went wrong on this screen</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Link to="/" className="inline-block text-sm font-medium text-accent underline underline-offset-4">
        Back to overview
      </Link>
    </section>
  )
}
