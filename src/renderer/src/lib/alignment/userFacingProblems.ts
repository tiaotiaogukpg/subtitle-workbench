/**
 * 将仍落在 problems 里的内部片段统一成用户可读句（不含 flag 名）。
 * 供 Problems 面板与任意直接渲染 problems 的位置使用。
 */
export function humanizeLooseProblemToken(raw: string): string {
  const t = raw.trim()
  if (!t) return '建议在本行复查对齐结果。'

  const lower = t.toLowerCase()
  if (lower.startsWith('ai_alignment:')) {
    return raw
  }

  // Legacy：旧 cursor/drift 流程已不再写入，仅兼容历史 problems 展示
  const map: Record<string, string> = {
    alignment_drift: '建议人工复查本行。',
    drift_skip_batch: '建议人工复查本行。',
    possible_cursor_gap: '建议人工复查本行。',
    identical_span_reuse: '相邻字幕引用了同一英文句子，建议复查。',
    span_overlap_needs_trim: '两句英文可能存在部分重复。',
    semantic_undersegmentation: '英文原句较短，可能无法自然拆分。',
    duplicate_span: '与其它行英文范围重叠较多，建议复查。',
    duplicate_english_in_batch: '本批存在相同英文对应多行字幕，建议复查。',
    span_mismatch: '英文定位与上下文略有偏差，建议核对。',
    order_span_violation: '英文先后顺序与字幕行不完全一致，建议复查。',
    english_not_in_context: '模型给出的英文不在当前上下文内，建议重试或扩窗。',
    missing_subtitle: '本行未收到模型返回，请手动对齐。',
    empty_english: '本行未匹配到英文，请手动对齐。',
    invalid_candidate: '本行候选无效，请重新对齐。',
    non_contiguous_segments: '关联的英文片段不连续，建议复查。',
    structural_writable: '本行对齐结果未通过结构校验，建议复查。',
    model_parse_warning: '模型返回格式有部分异常，建议复查本批。',
    writable_structural_candidate: '候选结果未通过校验，建议重试或手动对齐。'
  }

  if (map[t]) return map[t]
  if (map[lower]) return map[lower]

  if (/overlap|ratio/i.test(t)) {
    return '相邻行英文范围重叠较多，建议复查。'
  }
  if (/parse|json|warning/i.test(t)) {
    return '模型返回格式有部分异常，建议复查本批。'
  }
  if (/structural|writable|candidate/i.test(t)) {
    return '本行对齐结果未通过校验，建议复查。'
  }

  return '建议在本行复查对齐结果。'
}
