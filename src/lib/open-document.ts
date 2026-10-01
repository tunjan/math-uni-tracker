import { getDocumentBlob } from './store/documents'

/** Opens a stored document in a new tab. The object URL is revoked once the tab has had time to load it. */
export async function openDocument(id: string) {
  const tab = window.open('', '_blank') // open synchronously, inside the click, so popup blockers allow it
  const blob = await getDocumentBlob(id)
  if (!blob || !tab) return tab?.close()
  const url = URL.createObjectURL(blob)
  tab.location.href = url
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
