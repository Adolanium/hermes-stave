// How Stave reaches Hermes: one stateless llm.oneshot per step, routed to the plugin's own
// auxiliary task ("Stave composer" in Settings ▸ Models). With nothing set there, Hermes uses the
// main model. An older Hermes without the task falls back to the built-in helper task.
import { host } from '@hermes/plugin-sdk'

const TASK = 'stave'
const FALLBACK_TASK = 'title_generation'

let taskMissing = false

export function makeAsk() {
  return async function ask(instructions, input, { maxTokens = 1200, temperature = 0.6 } = {}) {
    const params = { instructions, input, max_tokens: maxTokens, temperature, task: taskMissing ? FALLBACK_TASK : TASK }
    try {
      const result = await host.request('llm.oneshot', params)
      return String(result?.text ?? '')
    } catch (e) {
      const message = String(e?.message || e)
      if (!taskMissing && /task|auxiliary/i.test(message) && /unknown|not found|invalid|no such/i.test(message)) {
        taskMissing = true
        const result = await host.request('llm.oneshot', { ...params, task: FALLBACK_TASK })
        return String(result?.text ?? '')
      }
      throw e
    }
  }
}
