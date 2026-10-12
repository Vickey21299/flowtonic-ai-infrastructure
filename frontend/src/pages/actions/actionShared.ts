import { useQueryClient } from '@tanstack/react-query'
import type { ActionStatus } from '@/api/types'

/** URL params that open/pre-fill the create-action form (set by the exception and investigation drawers). */
export const NEW_ACTION_PARAMS = ['new', 'exceptionId', 'investigationId', 'title'] as const

/** Query prefixes touched by any action mutation (counts, company tabs, exception links, impacts). */
const ACTION_INVALIDATE = [['action'], ['actions'], ['overview'], ['companies'], ['company'], ['exception'], ['impacts']]

export function useInvalidateActionData() {
  const qc = useQueryClient()
  return () => Promise.all(ACTION_INVALIDATE.map((queryKey) => qc.invalidateQueries({ queryKey })))
}

/** Main path of the action lifecycle (Spec §10), for the stepper. Reopened / Cancelled are side states. */
export const ACTION_PATH: ActionStatus[] = [
  'proposed',
  'approved',
  'in_progress',
  'completed',
  'outcome_verification',
  'verified',
]

/** Button label for moving TO a status. */
export const transitionLabel: Record<ActionStatus, string> = {
  proposed: 'Back to proposed',
  approved: 'Approve',
  in_progress: 'Start work',
  completed: 'Mark completed',
  outcome_verification: 'Move to outcome verification',
  verified: 'Mark outcome verified',
  reopened: 'Reopen',
  cancelled: 'Cancel action',
}
