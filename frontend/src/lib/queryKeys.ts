/**
 * TanStack Query keys. Every query uses a key from here so mutations can
 * invalidate the right data (e.g. an action status change refreshes the overview counts).
 */
export const queryKeys = {
  workspace: ['workspace'] as const,
  overview: (filters: object) => ['overview', filters] as const,
  companies: (filters: object) => ['companies', filters] as const,
  company: (id: string) => ['company', id] as const,
  exceptions: (filters: object) => ['exceptions', filters] as const,
  exception: (id: string) => ['exception', id] as const,
  exceptionTrace: (id: string) => ['exception', id, 'trace'] as const,
  investigations: (filters: object) => ['investigations', filters] as const,
  investigation: (id: string) => ['investigation', id] as const,
  actions: (filters: object) => ['actions', filters] as const,
  action: (id: string) => ['action', id] as const,
  impacts: (filters: object) => ['impacts', filters] as const,
  importJob: (id: string) => ['import', id] as const,
  methodology: ['methodology'] as const,
  settings: ['settings'] as const,
}
