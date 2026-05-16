import type { ScriptSegment } from '../../types'
import { isPureEnglishText } from '../language'

/** 仅 `language === english` 且文本通过纯英文检测的片段（顺序与 Script Pool 一致）。 */
export function filterEnglishPoolSegments(segments: ScriptSegment[]): ScriptSegment[] {
  return segments.filter(
    (s) => s.language === 'english' && s.text.trim().length > 0 && isPureEnglishText(s.text)
  )
}
