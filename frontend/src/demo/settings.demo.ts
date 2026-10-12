/** Settings: rule thresholds / enabled flags and AI mode. Changing rules re-evaluates exceptions. */
import type { SettingsResponse, SettingsUpdateInput } from '@/api/types'
import { db, resetStore } from './store'
import { WORKSPACE_META } from './seed'
import { evaluateExceptions } from './engine'
import { LIVE_AI_CONFIGURED } from './investigations.demo'
import { clone, currentActor, nowIso, validationError } from './util'

export function settingsDemo(): SettingsResponse {
  const s = db()
  return clone({
    environment: WORKSPACE_META.environment,
    ruleConfiguration: s.ruleConfiguration,
    aiMode: s.aiMode,
    liveAiAvailable: LIVE_AI_CONFIGURED,
  })
}

export function updateSettingsDemo(input: SettingsUpdateInput): SettingsResponse {
  const s = db()
  const errors: { field: string; message: string }[] = []
  const updates = input.rules ?? []
  updates.forEach((u, i) => {
    if (!s.ruleConfiguration.rules.some((r) => r.id === u.id)) errors.push({ field: `rules.${i}.id`, message: `Unknown rule "${u.id}".` })
    if (typeof u.threshold !== 'number' || !Number.isFinite(u.threshold)) {
      errors.push({ field: `rules.${i}.threshold`, message: 'The threshold must be a number.' })
    }
    if (typeof u.enabled !== 'boolean') errors.push({ field: `rules.${i}.enabled`, message: 'Enabled must be true or false.' })
  })
  if (input.aiMode !== undefined && input.aiMode !== 'mock' && input.aiMode !== 'live') {
    errors.push({ field: 'aiMode', message: 'AI mode must be mock or live.' })
  }
  if (errors.length) validationError(errors)

  const at = nowIso()
  const nextRules = s.ruleConfiguration.rules.map((r) => {
    const u = updates.find((x) => x.id === r.id)
    return u ? { ...r, threshold: u.threshold, enabled: u.enabled } : r
  })
  const changed = nextRules.some((r, i) => {
    const prev = s.ruleConfiguration.rules[i]!
    return r.threshold !== prev.threshold || r.enabled !== prev.enabled
  })
  if (changed) {
    s.ruleConfiguration = { version: s.ruleConfiguration.version + 1, activatedAt: at, rules: nextRules }
    evaluateExceptions(s, {
      at,
      actor: currentActor(),
      trigger: `rule configuration change to v${s.ruleConfiguration.version}`,
    })
  }
  if (input.aiMode !== undefined) s.aiMode = input.aiMode
  return settingsDemo()
}

export function resetDemoStore(): void {
  resetStore()
}
