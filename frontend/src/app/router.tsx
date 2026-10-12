import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { OverviewPage } from '@/pages/overview/OverviewPage'
import { CompaniesPage } from '@/pages/companies/CompaniesPage'
import { CompanyDetailPage } from '@/pages/companies/CompanyDetailPage'
import { ExceptionsPage } from '@/pages/exceptions/ExceptionsPage'
import { ExceptionDrawer } from '@/pages/exceptions/ExceptionDrawer'
import { InvestigationsPage } from '@/pages/investigations/InvestigationsPage'
import { InvestigationDrawer } from '@/pages/investigations/InvestigationDrawer'
import { ActionsPage } from '@/pages/actions/ActionsPage'
import { ActionDrawer } from '@/pages/actions/ActionDrawer'
import { ImpactPage } from '@/pages/impact/ImpactPage'
import { ImportPage } from '@/pages/import/ImportPage'
import { MethodologyPage } from '@/pages/methodology/MethodologyPage'
import { SettingsPage } from '@/pages/settings/SettingsPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { RouteErrorPage } from '@/pages/RouteErrorPage'

/**
 * All 13 views. Detail drawers are child routes: the list page renders <Outlet />,
 * so `/exceptions/:id` shows the list with the drawer open, survives refresh and can be shared.
 */
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: '/', element: <OverviewPage /> },
      { path: '/companies', element: <CompaniesPage /> },
      { path: '/companies/:companyId', element: <CompanyDetailPage /> },
      {
        path: '/exceptions',
        element: <ExceptionsPage />,
        children: [{ path: ':exceptionId', element: <ExceptionDrawer /> }],
      },
      {
        path: '/investigations',
        element: <InvestigationsPage />,
        children: [{ path: ':investigationId', element: <InvestigationDrawer /> }],
      },
      {
        path: '/actions',
        element: <ActionsPage />,
        children: [{ path: ':actionId', element: <ActionDrawer /> }],
      },
      { path: '/impact', element: <ImpactPage /> },
      { path: '/import', element: <ImportPage /> },
      { path: '/methodology', element: <MethodologyPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
