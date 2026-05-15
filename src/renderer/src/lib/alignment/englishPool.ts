import type { ScriptSegment } from '../../types'
import { isPureEnglishText } from '../language'

/** 仅 `language === english` 且文本通过纯英文检测的片段（顺序与 Script Pool 一致）。 */
export function filterEnglishPoolSegments(segments: ScriptSegment[]): ScriptSegment[] {
  return segments.filter(
    (s) => s.language === 'english' && s.text.trim().length > 0 && isPureEnglishText(s.text)
  )
}

/** 沙盒：按字幕进度比例定位英文池窗口起点（小批量测试用，非整文件游标）。 */
export function resolveSandboxEnglishCursor(
  poolLength: number,
  subtitleBatchStartIndex: number,
  totalSubtitleLines: number,
  windowSize: number
): number {
  if (poolLength === 0) return 0
  const take = Math.min(windowSize, poolLength)
  const denom = Math.max(1, totalSubtitleLines - 1)
  const ratio = Math.min(1, Math.max(0, subtitleBatchStartIndex / denom))
  const maxStart = Math.max(0, poolLength - take)
  return Math.floor(ratio * maxStart)
}
