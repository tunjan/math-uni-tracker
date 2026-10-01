/** Save a value as a pretty-printed JSON file via a temporary link. */
export function downloadJson(filename: string, value: unknown) {
  downloadBlob(filename, new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }))
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
