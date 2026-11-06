// Pieces live in the plugin's own storage: a list, newest first, plus which one is open.
const LIST = 'pieces'
const CURRENT = 'current'
const LIMIT = 60

export function loadPieces(storage) {
  const list = storage.get(LIST, [])
  return Array.isArray(list) ? list.filter(p => p && p.id && Array.isArray(p.bars)) : []
}

export function savePiece(storage, piece) {
  const list = loadPieces(storage).filter(p => p.id !== piece.id)
  const next = [piece, ...list].slice(0, LIMIT)
  storage.set(LIST, next)
  storage.set(CURRENT, piece.id)
  return next
}

export function deletePiece(storage, id) {
  const next = loadPieces(storage).filter(p => p.id !== id)
  storage.set(LIST, next)
  if (storage.get(CURRENT, null) === id) storage.set(CURRENT, null)
  return next
}

export function currentId(storage) {
  return storage.get(CURRENT, null)
}

export function setCurrent(storage, id) {
  storage.set(CURRENT, id)
}
