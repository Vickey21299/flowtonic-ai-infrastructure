/**
 * Uniform API error, mirroring the backend error shape
 * `{ code, message, details, request_id }`.
 *
 * - code "validation_error"   → HTTP 422, `fieldErrors` lists the problems
 * - code "invalid_transition" → HTTP 409, `allowedTransitions` lists legal targets
 * - code "not_found"          → HTTP 404
 */
export type ApiErrorCode =
  | 'validation_error'
  | 'invalid_transition'
  | 'conflict'
  | 'not_found'
  | 'provider_unavailable'
  | 'internal_error'

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly fieldErrors: { field: string; message: string }[]
  readonly allowedTransitions: string[]
  readonly requestId: string

  constructor(
    code: ApiErrorCode,
    message: string,
    opts: {
      fieldErrors?: { field: string; message: string }[]
      allowedTransitions?: string[]
      requestId?: string
    } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.fieldErrors = opts.fieldErrors ?? []
    this.allowedTransitions = opts.allowedTransitions ?? []
    this.requestId = opts.requestId ?? `req_${Math.random().toString(36).slice(2, 10)}`
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError
}
