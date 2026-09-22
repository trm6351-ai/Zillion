import {
  isCurrencyMetricName,
  isPercentMetricName,
  isSumMetricName,
  normalizeName,
} from './names'
import type { Aggregation, KpiUnit } from './types'

export type MetricTone = 'positive' | 'availability' | 'attention' | 'risk' | 'neutral'

const RISK_HINT =
  /\b(incident|incidents|outage|outages|failure|failures|fault|faults|error|errors|alert|alerts|downtime|loss|losses|defect|defects|critical)\b/

const ATTENTION_HINT =
  /\b(delay|delays|overdue|shortage|shortages|complaint|complaints|warning|warnings)\b/

/**
 * Semantic color role for a KPI. Based on unit and generic metric language,
 * not on any department or dataset identity.
 */
export function metricTone(name: string, unit: KpiUnit, aggregation: Aggregation): MetricTone {
  const normalized = normalizeName(name)

  if (RISK_HINT.test(normalized)) {
    return 'risk'
  }

  if (ATTENTION_HINT.test(normalized)) {
    return 'attention'
  }

  if (unit === 'currency' || isCurrencyMetricName(name)) {
    return 'positive'
  }

  if (unit === 'percent' || unit === 'percentFraction' || isPercentMetricName(name)) {
    return 'availability'
  }

  if (aggregation === 'count' || aggregation === 'distinctCount') {
    return 'neutral'
  }

  if (isSumMetricName(name)) {
    return 'positive'
  }

  return 'neutral'
}
