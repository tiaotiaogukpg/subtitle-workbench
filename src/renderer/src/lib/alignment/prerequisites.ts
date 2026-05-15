/** 运行真实 DeepSeek 对齐前的必要条件检查；返回用户可读错误文案，通过则返回 null。 */
export function validateAlignmentPrerequisites(input: {
  apiKey: string
  subtitleCount: number
  englishPoolSize: number
  bridgeReady: boolean
}): string | null {
  if (!input.bridgeReady) {
    return '真实对齐仅在 Electron 桌面端可用（安全桥接未加载）。'
  }
  if (!input.apiKey.trim()) {
    return '请先在 Settings 中配置 DeepSeek API Key。'
  }
  if (input.subtitleCount === 0) {
    return '请先导入中文字幕 SRT。'
  }
  if (input.englishPoolSize === 0) {
    return '请先导入英文原稿，并确保存在通过纯英文检测的片段。'
  }
  return null
}
