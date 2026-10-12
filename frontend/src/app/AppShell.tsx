import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DemoNotice } from './DemoNotice'
import { Header } from './Header'
import { SideNav } from './SideNav'

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { pathname } = useLocation()

  // Move focus to the main content on navigation so keyboard and screen-reader users land in the page.
  useEffect(() => {
    document.getElementById('main')?.focus({ preventScroll: true })
  }, [pathname])

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <DemoNotice />
      <Header onOpenMobileNav={() => setMobileOpen(true)} />

      <div className="flex flex-1">
        <aside
          className={cn(
            'sticky top-0 hidden h-[calc(100vh-5.5rem)] shrink-0 border-r border-border bg-surface transition-[width] duration-150 lg:block',
            collapsed ? 'w-14' : 'w-60',
          )}
        >
          <SideNav collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />
        </aside>

        <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-foreground/30 lg:hidden" />
            <Dialog.Content
              className="fixed inset-y-0 left-0 z-50 w-72 border-r border-border bg-surface shadow-lg lg:hidden"
              aria-describedby={undefined}
            >
              <div className="flex h-14 items-center justify-between border-b border-border px-4">
                <Dialog.Title className="text-base font-semibold">Flownetic</Dialog.Title>
                <Dialog.Close
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                  aria-label="Close navigation"
                >
                  <X className="h-5 w-5" aria-hidden />
                </Dialog.Close>
              </div>
              <SideNav
                mobile
                collapsed={false}
                onToggleCollapsed={() => undefined}
                onNavigate={() => setMobileOpen(false)}
              />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
