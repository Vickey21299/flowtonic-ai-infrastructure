/** Persistent notice required by Spec §13. Exact wording is part of the acceptance checks. */
export function DemoNotice() {
  return (
    <div
      role="note"
      className="bg-foreground px-4 py-1.5 text-center text-2xs font-semibold uppercase tracking-wider text-background"
    >
      DEMO ENVIRONMENT — ALL COMPANY DATA IS FICTIONAL.
    </div>
  )
}
