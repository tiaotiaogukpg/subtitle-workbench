/** 轻量词级 diff（空格分词 + LCS），供 Attempt 与当前英文对比；非通用 diff 引擎。 */
export type AttemptWordDiffOp = { type: 'eq' | 'del' | 'ins'; text: string }

function tokenize(s: string): string[] {
  return s
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
}

/**
 * 从 `fromText` 视角对比到 `toText`：`del` 为仅在 from 出现，`ins` 为仅在 to 出现，`eq` 为共有 token。
 */
export function buildAttemptWordDiff(fromText: string, toText: string): AttemptWordDiffOp[] {
  const a = tokenize(fromText)
  const b = tokenize(toText)
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) dp[i]![j] = dp[i - 1]![j - 1]! + 1
      else dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!)
    }
  }
  const raw: AttemptWordDiffOp[] = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      raw.push({ type: 'eq', text: a[i - 1]! })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      raw.push({ type: 'ins', text: b[j - 1]! })
      j--
    } else if (i > 0) {
      raw.push({ type: 'del', text: a[i - 1]! })
      i--
    } else {
      break
    }
  }
  raw.reverse()
  return mergeAdjacentOps(raw)
}

function mergeAdjacentOps(ops: AttemptWordDiffOp[]): AttemptWordDiffOp[] {
  const out: AttemptWordDiffOp[] = []
  for (const op of ops) {
    const last = out[out.length - 1]
    if (last && last.type === op.type) {
      last.text = `${last.text} ${op.text}`
    } else {
      out.push({ ...op })
    }
  }
  return out
}
