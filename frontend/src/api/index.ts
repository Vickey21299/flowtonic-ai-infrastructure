/**
 * The API used by every screen.
 *
 * Read methods call the FastAPI backend (`backend/app`), which reads the Supabase database
 * through a read-only role. Screens and components are unchanged: responses follow `types.ts`.
 *
 * CSV import goes to FastAPI as well (it writes through a separate database role). The other
 * write methods (workflow, actions, impact, settings, reset) reject with an ApiError until their
 * endpoints exist. Methodology, settings and the sample CSV are static reference content and
 * still come from `src/demo/`.
 *
 * Every method throws `ApiError` on failure, including when the backend is not reachable.
 */
import type { Api, SettingsResponse } from './types'
import { ApiError, type ApiErrorCode } from './errors'
import { sampleCsvDemo } from '@/demo/import.demo'
import { methodologyDemo } from '@/demo/methodology.demo'
import { clone } from '@/demo/util'

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000/api'
const TIMEOUT_MS = 15_000
const WRITE_TIMEOUT_MS = 60_000 // a confirm recalculates KPIs and exceptions in one transaction

const KNOWN_CODES: ApiErrorCode[] = [
  'validation_error',
  'invalid_transition',
  'conflict',
  'not_found',
  'provider_unavailable',
  'internal_error',
]

/** Backend error codes that have no frontend equivalent. */
function toCode(code: unknown, status: number): ApiErrorCode {
  if (typeof code === 'string' && (KNOWN_CODES as string[]).includes(code)) return code as ApiErrorCode
  if (status === 503) return 'provider_unavailable'
  if (status === 404) return 'not_found'
  if (status === 422) return 'validation_error'
  return 'internal_error'
}

type Params = Record<string, string | number | boolean | null | undefined>

async function request<T>(method: 'GET' | 'POST' | 'PUT', path: string, params: Params = {}, body?: unknown): Promise<T> {
  const url = new URL(BASE_URL + path, window.location.origin)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }

  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(method === 'GET' ? TIMEOUT_MS : WRITE_TIMEOUT_MS),
    })
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === 'TimeoutError'
    throw new ApiError(
      'provider_unavailable',
      timedOut
        ? 'The Flownetic API did not respond in time. Please retry.'
        : `Cannot reach the Flownetic API at ${BASE_URL}. Is the backend running?`,
    )
  }

  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const err = (data ?? {}) as {
      code?: string
      message?: string
      request_id?: string
      details?: { fieldErrors?: { field: string; message: string }[] }
    }
    throw new ApiError(toCode(err.code, res.status), err.message ?? `Request failed (HTTP ${res.status}).`, {
      fieldErrors: err.details?.fieldErrors,
      requestId: err.request_id,
    })
  }
  return data as T
}

const get = <T>(path: string, params: Params = {}) => request<T>('GET', path, params)
const send = <T>(method: 'POST' | 'PUT', path: string, body: unknown = {}) => request<T>(method, path, {}, body)

/** Not offered in this version. */
function notAvailable(what: string): Promise<never> {
  return Promise.reject(
    new ApiError('conflict', `${what} is not available yet. This version only reads data from the database.`),
  )
}

/** Static reference content (not database records). */
async function reference<T>(fn: () => T): Promise<T> {
  return clone(fn())
}

export const api: Api = {
  getWorkspace: () => get('/workspace'),

  getOverview: (filters) => get('/dashboard/kpis', { ...filters }),
  listCompanies: (filters) => get('/companies', { ...filters }),
  getCompany: (id) => get(`/companies/${encodeURIComponent(id)}`),

  listExceptions: (filters) => get('/exceptions', { ...filters }),
  getException: (id) => get(`/exceptions/${encodeURIComponent(id)}`),
  getExceptionTrace: (id) => get(`/exceptions/${encodeURIComponent(id)}/trace`),
  transitionException: (id, req) => send('POST', `/exceptions/${encodeURIComponent(id)}/transition`, req),

  listInvestigations: (filters) => get('/investigations', { ...filters }),
  getInvestigation: (id) => get(`/investigations/${encodeURIComponent(id)}`),
  generateInvestigation: (exceptionId, mode) => send('POST', '/investigations', { exceptionId, mode }),
  addInvestigationNote: (id, text) => send('POST', `/investigations/${encodeURIComponent(id)}/notes`, { text }),
  saveInvestigationEdit: (id, edited) => send('PUT', `/investigations/${encodeURIComponent(id)}/edit`, { edited }),
  markInvestigationReviewed: (id) => send('POST', `/investigations/${encodeURIComponent(id)}/review`),

  listActions: (filters) => get('/actions', { ...filters }),
  getAction: (id) => get(`/actions/${encodeURIComponent(id)}`),
  createAction: (input) => send('POST', '/actions', input),
  updateAction: (id, patch) => send('PUT', `/actions/${encodeURIComponent(id)}`, patch),
  transitionAction: (id, req) => send('POST', `/actions/${encodeURIComponent(id)}/transition`, req),
  addActionNote: (id, text) => send('POST', `/actions/${encodeURIComponent(id)}/notes`, { text }),
  addActionEvidence: (id, item) => send('POST', `/actions/${encodeURIComponent(id)}/evidence`, item),

  listImpacts: (filters) => get('/impacts', { ...filters }),
  createImpact: (input) => send('POST', '/impacts', input),
  updateImpact: (id, patch) => send('PUT', `/impacts/${encodeURIComponent(id)}`, patch),
  verifyImpact: (id, req) => send('POST', `/impacts/${encodeURIComponent(id)}/verify`, req),

  getSampleCsv: () => reference(sampleCsvDemo),
  getImportJob: (id) => get(`/imports/${encodeURIComponent(id)}`),
  uploadImport: (file) => send('POST', '/imports', { name: file.name, text: file.text }),
  setImportMapping: (id, mapping) => send('PUT', `/imports/${encodeURIComponent(id)}/mapping`, { mapping }),
  confirmImport: (id, opts) => send('POST', `/imports/${encodeURIComponent(id)}/confirm`, opts),
  cancelImport: (id) => send('POST', `/imports/${encodeURIComponent(id)}/cancel`),

  getMethodology: async () => {
    const s = await get<SettingsResponse>('/settings') // rules and AI status come from the backend
    const m = clone(methodologyDemo())
    return {
      ...m,
      ruleConfiguration: s.ruleConfiguration,
      aiStatus: {
        mode: s.aiMode,
        liveConfigured: s.liveAiAvailable,
        note: s.liveAiAvailable
          ? 'Live investigations use Google Gemini on the backend; the API key never reaches the browser. The mock template stays available and is clearly labelled.'
          : m.aiStatus.note,
      },
    }
  },
  getSettings: () => get('/settings'),
  updateSettings: (input) => send('PUT', '/settings', input),
  resetDemo: () => notAvailable('Resetting demo data'),
}
