import type { ReactNode } from 'react'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from './ui/sheet'

interface DetailDrawerProps {
  open: boolean
  /** Called on Esc, overlay click or the close button (e.g. navigate back to the list URL). */
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  /** Small line above the title (e.g. record id or badges). */
  eyebrow?: ReactNode
  children: ReactNode
  /** Sticky footer for actions. */
  footer?: ReactNode
  className?: string
}

/** Right-side detail panel: full width on mobile, 640px on desktop; focus trapped, Esc closes. */
export function DetailDrawer({ open, onClose, title, description, eyebrow, children, footer, className }: DetailDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className={className}>
        <SheetHeader>
          {eyebrow && <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{eyebrow}</div>}
          <SheetTitle>{title}</SheetTitle>
          {description ? (
            <SheetDescription>{description}</SheetDescription>
          ) : (
            <SheetDescription className="sr-only">Details</SheetDescription>
          )}
        </SheetHeader>
        <SheetBody>{children}</SheetBody>
        {footer && <SheetFooter>{footer}</SheetFooter>}
      </SheetContent>
    </Sheet>
  )
}
