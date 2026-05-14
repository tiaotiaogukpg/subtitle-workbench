import { ipcMain } from 'electron'
import { readUserSettingsFromDisk } from './userSettingsFile'

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

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

type ChatCompletionOk = {
  ok: true
  rawText: string
  latencyMs: number
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

type ChatCompletionFail = { ok: false; error: string }

async function callDeepSeekChatCompletion(params: {
  apiKey: string
  model: string
  messages: ChatMessage[]
  maxTokens: number
  temperature: number
  responseFormatJsonObject: boolean
}): Promise<ChatCompletionOk | ChatCompletionFail> {
  const modelId = resolveModelId(params.model)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120_000)
  const body: Record<string, unknown> = {
    model: modelId,
    messages: params.messages,
    max_tokens: params.maxTokens,
    temperature: params.temperature
  }
  if (params.responseFormatJsonObject) {
    body.response_format = { type: 'json_object' }
  }
  try {
    const res = await fetch(DEEPSEEK_CHAT_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    const rawText = await res.text()
    let data: unknown
    try {
      data = JSON.parse(rawText) as unknown
    } catch {
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}: ${rawText.slice(0, 240)}` }
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
    const usage = (data as { usage?: ChatCompletionOk['usage'] })?.usage
    return { ok: true, rawText: content, latencyMs: 0, usage }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'Request timed out' }
    }
    return { ok: false, error: safeErrorMessage(err) }
  } finally {
    clearTimeout(timeout)
  }
}

async function callDeepSeekChatCompletionTimed(params: {
  apiKey: string
  model: string
  messages: ChatMessage[]
  maxTokens: number
  temperature: number
  responseFormatJsonObject: boolean
}): Promise<ChatCompletionOk | ChatCompletionFail> {
  const t0 = Date.now()
  const result = await callDeepSeekChatCompletion(params)
  const latency = Date.now() - t0
  if (!result.ok) return result
  return { ...result, latencyMs: latency }
}

async function callDeepSeekChat(apiKey: string, model: string): Promise<TestOk | TestFail> {
  const result = await callDeepSeekChatCompletionTimed({
    apiKey,
    model,
    messages: [{ role: 'user', content: TEST_PROMPT }],
    maxTokens: 16,
    temperature: 0,
    responseFormatJsonObject: false
  })
  if (!result.ok) return result

  const content = result.rawText
  if (isOkReply(content)) return { ok: true }
  const preview = content.trim().slice(0, 120)
  return {
    ok: false,
    error: preview ? `Unexpected reply: ${preview}` : 'Empty reply from model'
  }
}

export function registerDeepSeekIpc(): void {
  ipcMain.removeHandler('deepseek:testConnection')
  ipcMain.removeHandler('deepseek:alignBatch')

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

  ipcMain.handle('deepseek:alignBatch', async (_event, raw: unknown) => {
    if (raw == null || typeof raw !== 'object') {
      return { ok: false, error: 'Invalid request' } as ChatCompletionFail
    }
    const { model, messages } = raw as { model?: unknown; messages?: unknown }
    if (typeof model !== 'string' || !Array.isArray(messages)) {
      return { ok: false, error: 'Invalid request' } as ChatCompletionFail
    }
    const normalized: ChatMessage[] = []
    for (const m of messages) {
      if (m == null || typeof m !== 'object') continue
      const msg = m as { role?: unknown; content?: unknown }
      if ((msg.role === 'system' || msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string') {
        normalized.push({ role: msg.role, content: msg.content })
      }
    }
    if (normalized.length === 0) {
      return { ok: false, error: 'Invalid request: empty messages' } as ChatCompletionFail
    }

    const { apiKey } = readUserSettingsFromDisk()
    const key = apiKey.trim()
    if (key === '') {
      return { ok: false, error: 'No API key on disk. Save settings with your DeepSeek API key first.' } as ChatCompletionFail
    }

    let first = await callDeepSeekChatCompletionTimed({
      apiKey: key,
      model,
      messages: normalized,
      maxTokens: 8192,
      temperature: 0.15,
      responseFormatJsonObject: true
    })

    if (!first.ok && /response_format|json_object/i.test(first.error)) {
      first = await callDeepSeekChatCompletionTimed({
        apiKey: key,
        model,
        messages: normalized,
        maxTokens: 8192,
        temperature: 0.15,
        responseFormatJsonObject: false
      })
    }

    return first
  })
}
