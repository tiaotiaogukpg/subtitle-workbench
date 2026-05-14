/**
 * 用户设置默认值（主进程读写 `settings.json` 与渲染层初始状态共用）。
 * 勿在此文件存放真实密钥。
 */
export const DEFAULT_USER_SETTINGS = {
  provider: 'Deepseek',
  apiKey: '',
  model: '可选模型',
  batchSize: 20,
  confidenceThreshold: 70,
  autoMarkHighConfidence: true,
  subtitleOrder: 'chineseFirst' as const,
  exportFormat: '.srt' as const,
  separateLines: true,
  theme: 'dark' as const,
  fontSize: 14
}
