import type { ScriptSegment } from '../../types'
import { isPureEnglishText } from '../language'
import {
  LOCAL_ENGLISH_CONTEXT_MAX_SEGMENTS,
  LOCAL_ENGLISH_CONTEXT_MIN_SEGMENTS
} from './constants'
import { normalizeGroupText } from './candidateGroups'

/** Prompt 中的只读 local English context（不可作为 groupId 直接选用）。 */
export interface LocalEnglishContextBlock {
  segmentIds: string[]
  text: string
  startSegmentIndex: number
  endSegmentIndex: number
  segmentCount: number
}

export function buildLocalEnglishContextBlock(options: {
  englishSegments: ScriptSegment[]
  cursor: number
  minSegments?: number
  maxSegments?: number
}): LocalEnglishContextBlock | null {
  const pool = options.englishSegments
  if (pool.length === 0) return null

  const minSeg = options.minSegments ?? LOCAL_ENGLISH_CONTEXT_MIN_SEGMENTS
  const maxSeg = options.maxSegments ?? LOCAL_ENGLISH_CONTEXT_MAX_SEGMENTS
  const start = Math.min(Math.max(0, options.cursor), pool.length - 1)
  const available = pool.length - start
  if (available <= 0) return null

  const target = Math.min(maxSeg, available)
  const run = available >= minSeg ? Math.max(minSeg, Math.min(maxSeg, available)) : target
  const end = start + run - 1
  const segs = pool.slice(start, end + 1)
  if (segs.some((s) => s.language !== 'english' || !isPureEnglishText(s.text))) return null

  const segmentIds = segs.map((s) => s.id)
  const text = normalizeGroupText(segs.map((s) => s.text.trim()).join(' '))

  return {
    segmentIds,
    text,
    startSegmentIndex: start,
    endSegmentIndex: end,
    segmentCount: segs.length
  }
}

export function formatLocalEnglishContextLabel(block: LocalEnglishContextBlock): string {
  return `pool[${block.startSegmentIndex}…${block.endSegmentIndex}] · ${block.segmentCount} segs`
}
