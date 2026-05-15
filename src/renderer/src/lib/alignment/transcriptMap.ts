/**
 * Transcript structure map（整文件结构分析）— 阶段二接口占位。
 * 小批量对齐暂不发送全文结构。
 */

import type { ScriptSegment } from '../../types'

export interface TranscriptSectionStub {
  id: string
  startSegmentId: string
  endSegmentId: string
  summary: string
  keywords: string[]
  title?: string
  speaker?: string
}

export interface TranscriptMapContext {
  sections: TranscriptSectionStub[]
  currentSectionId: string | null
}

export interface BuildTranscriptMapContextInput {
  englishPool: ScriptSegment[]
  cursorPoolIndex: number
  windowEndPoolIndex: number
  sections: TranscriptSectionStub[]
}

/** @internal 整文件对齐启用后实现 */
export function buildTranscriptMapContext(
  _input: BuildTranscriptMapContextInput
): TranscriptMapContext | null {
  return null
}
