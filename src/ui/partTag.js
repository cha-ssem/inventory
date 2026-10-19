import { ROBOT_PART_PREFIX } from '../data/youngpoongCatalog.js'
import { html } from './dom.js'

// 입출고 화면에서 확장 기능으로 더한 로봇 부품(YP-)에 표시를 붙인다
export const partNoLabel = (partNo) =>
  String(partNo).startsWith(ROBOT_PART_PREFIX) ? html`${partNo} <span class="section-tag section-tag-sm" title="수중 점검 로봇 부품">로봇</span>` : partNo
