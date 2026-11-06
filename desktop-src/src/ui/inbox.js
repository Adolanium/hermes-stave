// Pieces the agent opened from a chat (stave_open) wait in the plugin's inbox on the Hermes side.
// While the plugin is loaded, this polls the inbox, saves each piece to the Pieces list, tells the
// page (if it is open) and shows a toast with a way to the page.
import { host } from '@hermes/plugin-sdk'
import { pieceFromAgent } from '../music/model.js'
import { savePiece } from './store.js'

export const INBOX_EVENT = 'stave:inbox'
const EVERY_MS = 3000

export function watchInbox({ rest, storage, path }) {
  let stopped = false
  let timer = 0
  let quietUntil = 0
  const tick = async () => {
    if (stopped) return
    try {
      if (Date.now() >= quietUntil) {
        const answer = await rest('/inbox')
        for (const entry of answer?.pieces || []) {
          const piece = pieceFromAgent(entry)
          savePiece(storage, piece)
          await rest(`/inbox/${encodeURIComponent(entry.id)}/ack`, { method: 'POST' })
          window.dispatchEvent(new CustomEvent(INBOX_EVENT, { detail: { id: piece.id } }))
          host.notify({
            kind: 'success',
            title: 'Hermes wrote a piece',
            message: `“${piece.title}” is on the Stave page.`,
            action: { label: 'Open in Stave', onClick: () => host.navigate(path) }
          })
        }
      }
    } catch {
      // No route yet (the Hermes side of the plugin is off or still loading): look again later.
      quietUntil = Date.now() + 15000
    }
    if (!stopped) timer = setTimeout(tick, EVERY_MS)
  }
  timer = setTimeout(tick, 800)
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
