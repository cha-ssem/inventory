import { isOpenStatus } from '../inspection/flow.js'

const MINUTE_MS = 60_000
// 요청 하나에 남기는 재발생 기록 상한 (이상을 켜 둔 채 잊은 화면이 저장 공간·시트를 채우지 않도록)
export const MAX_RECUR = 50
const TITLE_PREFIX = { SENSOR: '', LOG: '로그 분석: ' }

// 기준 시각이 미래면(다른 기기 시계가 빠름) 대기 시간이 지난 것으로 본다
const minutesSince = (from, now) => {
  const minutes = (Date.parse(now) - Date.parse(from)) / MINUTE_MS
  return minutes < 0 ? Number.POSITIVE_INFINITY : minutes
}

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
      if (open.recurCount >= MAX_RECUR) return []
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
