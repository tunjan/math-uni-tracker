/**
 * pdf.js, loaded only when needed (it is large). Used to count pages for cost estimates and to render
 * handwritten working to images for grading, so any vision model can read it.
 */
async function pdfjs() {
  const lib = await import('pdfjs-dist')
  lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  return lib
}

async function open(blob: Blob) {
  const lib = await pdfjs()
  const task = lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) })
  return { doc: await task.promise, close: () => task.destroy() }
}

export async function pageCount(blob: Blob): Promise<number | null> {
  try {
    const { doc, close } = await open(blob)
    const n = doc.numPages
    await close()
    return n
  } catch {
    return null
  }
}

/** Each page as a JPEG whose long side is at most `maxSide` pixels. */
export async function renderPages(blob: Blob, maxSide = 2000, quality = 0.85): Promise<Blob[]> {
  const { doc, close } = await open(blob)
  const out: Blob[] = []
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: maxSide / Math.max(base.width, base.height) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      await page.render({ canvas, viewport }).promise
      out.push(await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('could not encode the page'))), 'image/jpeg', quality)))
    }
  } finally {
    await close()
  }
  return out
}

/** Downscale a photo to JPEG with its long side at most `maxSide`; the original is kept elsewhere. */
export async function downscaleImage(blob: Blob, maxSide = 2000, quality = 0.85): Promise<Blob> {
  const bmp = await createImageBitmap(blob)
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * s)
  canvas.height = Math.round(bmp.height * s)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  return new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('could not encode the image'))), 'image/jpeg', quality))
}
