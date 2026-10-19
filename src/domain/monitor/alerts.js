import { isOpenStatus } from '../inspection/flow.js'

const MINUTE_MS = 60_000
const TITLE_PREFIX = { SENSOR: '', LOG: '로그 분석: ' }

const minutesSince = (from, now) => (Date.parse(now) - Date.parse(from)) / MINUTE_MS

// 센서·로그 위반을 점검 요청으로 바꾼다.
// 같은 로봇·같은 기준으로 열린 요청이 있으면 새로 만들지 않고 재발생(RECUR)만 남기고, 그것도 기준의 대기 시간(cooldown)마다 한 번만.
// violations: [{ robot, rule, reading }], requests: foldRequests 결과의 요청 목록
export const planAlerts = (violations, requests, now, { source = 'SENSOR' } = {}) => {
  const seen = new Set()
  return violations.flatMap(({ robot, rule, reading }) => {
    const key = `${robot.robotId}|${rule.id}`
    if (seen.has(key) || !robot.siteId) return []
    seen.add(key)
    const open = requests.find((r) => r.robotId === robot.robotId && r.ruleId === rule.id && isOpenStatus(r.status))
    if (open) {
      const last = open.lastRecurAt ?? open.requestedAt
      return minutesSince(last, now) >= rule.cooldownMin ? [{ kind: 'RECUR', requestId: open.requestId, reading }] : []
    }
    return [
      {
        kind: 'REQUEST',
        input: {
          siteId: robot.siteId,
          robotId: robot.robotId,
          source,
          priority: rule.priority,
          ruleId: rule.id,
          title: `${TITLE_PREFIX[source] ?? ''}${rule.title} (${robot.name})`,
          detail: `센서 기준을 넘었습니다: ${rule.title}`,
          reading,
        },
      },
    ]
  })
}
