const TECHNICAL =
  /\b(503|502|500|404|invalid-response|provider rejection|provider rejected|TypeError|ECONN|fetch failed)\b/i

export const AI_UNAVAILABLE_TITLE = 'AI analysis is temporarily unavailable.'
export const AI_UNAVAILABLE_COPY = 'Your dashboard and previous insights are still available.'

export function toUserAiMessage(
  message: string | null | undefined,
  fallback = `${AI_UNAVAILABLE_TITLE} ${AI_UNAVAILABLE_COPY}`,
): string {
  if (!message || TECHNICAL.test(message)) {
    return fallback
  }
  return message
}

export function isTechnicalAiDetail(message: string | null | undefined): boolean {
  return Boolean(message && TECHNICAL.test(message))
}
