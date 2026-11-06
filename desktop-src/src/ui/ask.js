// How Stave reaches Hermes: one stateless llm.oneshot per step. When the person picks "the chat's model",
// a hidden Stave session lends its model so the music is written by the same model they chat with;
// otherwise Hermes's auxiliary task model answers.
import { host } from '@hermes/plugin-sdk'

const SESSION_KEY = 'lenderSession'

async function lenderSession(storage) {
  const known = storage.get(SESSION_KEY, null)
  if (known) return known
  const created = await host.request('session.create', { hidden: true, title: 'Stave' })
  const id = created?.session_id || created?.id || null
  if (id) storage.set(SESSION_KEY, id)
  return id
}

export function makeAsk(storage, { useChatModel }) {
  return async function ask(instructions, input, { maxTokens = 1200, temperature = 0.6 } = {}) {
    const params = { instructions, input, max_tokens: maxTokens, temperature, task: 'title_generation' }
    if (useChatModel()) {
      try {
        const sid = await lenderSession(storage)
        if (sid) params.session_id = sid
      } catch {
        // No session to lend a model: the auxiliary model still answers.
      }
    }
    try {
      const result = await host.request('llm.oneshot', params)
      return String(result?.text ?? '')
    } catch (e) {
      if (params.session_id && /session/i.test(String(e?.message || e))) {
        storage.set(SESSION_KEY, null)
        delete params.session_id
        const result = await host.request('llm.oneshot', params)
        return String(result?.text ?? '')
      }
      throw e
    }
  }
}
