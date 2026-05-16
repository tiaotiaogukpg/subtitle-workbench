/** 与 App 中候选「当前应用」判定一致。 */
export function segmentIdsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}
