import { ipcMain } from 'electron'

const DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/v1/chat/completions'
const TEST_PROMPT = 'Reply with OK.'

function resolveModelId(model: string): string {
  const m = model.trim()
  if (m === '' || m === '可选模型') return 'deepseek-chat'
  return m
}

function isOkReply(content: string): boolean {
  const firstLine = content.trim().split(/\n/)[0]?.trim() ?? ''
  const stripped = firstLine.replace(/^[\s`'"]+|[\s`'"]+$/g, '')
  return /^OK[.!\s]*$/i.test(stripped) || stripped.toUpperCase() === 'OK'
}

type TestOk = { ok: true }
type TestFail = { ok: false; error: string }

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

async function callDeepSeekChat(apiKey: string, model: string): Promise<TestOk | TestFail> {
  const modelId = resolveModelId(model)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25_000)
  try {
    const res = await fetch(DEEPSEEK_CHAT_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: TEST_PROMPT }],
        max_tokens: 16
      })
    })

    const rawText = await res.text()
    let data: unknown
    try {
      data = JSON.parse(rawText) as unknown
    } catch {
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}: ${rawText.slice(0, 200)}` }
      }
      return { ok: false, error: 'Invalid JSON from API' }
    }

    if (!res.ok) {
      const errObj = data as { error?: { message?: string } }
      const msg = errObj?.error?.message ?? `HTTP ${res.status}`
      return { ok: false, error: msg }
    }

    const choices = (data as { choices?: Array<{ message?: { content?: string } }> })?.choices
    const content = choices?.[0]?.message?.content ?? ''
    if (isOkReply(content)) return { ok: true }
    const preview = content.trim().slice(0, 120)
    return {
      ok: false,
      error: preview ? `Unexpected reply: ${preview}` : 'Empty reply from model'
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'Request timed out' }
    }
    return { ok: false, error: safeErrorMessage(err) }
  } finally {
    clearTimeout(timeout)
  }
}

export function registerDeepSeekIpc(): void {
  ipcMain.removeHandler('deepseek:testConnection')

  ipcMain.handle('deepseek:testConnection', async (_event, raw: unknown) => {
    if (raw == null || typeof raw !== 'object') {
      return { ok: false, error: 'Invalid request' } satisfies TestFail
    }
    const { apiKey, model } = raw as { apiKey?: unknown; model?: unknown }
    if (typeof apiKey !== 'string' || typeof model !== 'string') {
      return { ok: false, error: 'Invalid request' } satisfies TestFail
    }
    const trimmed = apiKey.trim()
    if (trimmed === '') {
      return { ok: false, error: 'Please enter DeepSeek API Key.' } satisfies TestFail
    }
    return callDeepSeekChat(trimmed, model)
  })
}
