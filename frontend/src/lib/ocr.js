import { createWorker, PSM } from 'tesseract.js'

// Share of the framed document (from the bottom) that holds the MRZ, with margin:
// passports (ID-3, 2 lines) ~23 %, ID cards (ID-1, 3 lines) ~35 %.
export const mrzBandFor = (ratio) => (ratio < 1.5 ? 0.3 : 0.42)

let workerPromise = null

/** Lazily create a single Tesseract worker tuned for MRZ text (A–Z, 0–9, "<"). */
export function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('eng', 1)
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: '0',
      })
      return worker
    })().catch((e) => {
      workerPromise = null
      throw e
    })
  }
  return workerPromise
}

/** Copy a region of a source (video/image/canvas) into a new canvas, optionally resized. */
export function crop(source, sx, sy, sw, sh, targetWidth = sw) {
  const scale = targetWidth / sw
  const c = document.createElement('canvas')
  c.width = Math.round(sw * scale)
  c.height = Math.round(sh * scale)
  c.getContext('2d').drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height)
  return c
}

/** Grayscale + contrast stretch; OCR on MRZ text is far more reliable after this. */
function preprocess(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  const hist = new Uint32Array(256)
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0
    d[i] = g
    hist[g]++
  }
  // Clip the darkest/brightest 1 % and stretch the rest to 0–255.
  const total = d.length / 4
  let lo = 0, hi = 255, acc = 0
  while (lo < 255 && (acc += hist[lo]) < total * 0.01) lo++
  acc = 0
  while (hi > 0 && (acc += hist[hi]) < total * 0.01) hi--
  const range = Math.max(1, hi - lo)
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / range))
    d[i] = d[i + 1] = d[i + 2] = v
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

async function recognize(canvas) {
  const worker = await getWorker()
  const { data } = await worker.recognize(preprocess(canvas))
  return data.text || ''
}

/** Quick client-side check: does the text contain something that looks like an MRZ? */
export function looksLikeMrz(text) {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s/g, '').toUpperCase())
    .filter((l) => l.length >= 25 && (l.match(/</g) || []).length >= 2)
  for (let i = 0; i < lines.length - 1; i++) {
    const [a, b] = [lines[i], lines[i + 1]]
    if (a.length >= 40 && b.length >= 40 && /^[PV]/.test(a)) return true
  }
  for (let i = 0; i < lines.length - 2; i++) {
    if (lines.slice(i, i + 3).every((l) => l.length >= 27 && l.length <= 33) && /^[ICA]/.test(lines[i])) return true
  }
  return false
}

const DIGIT_LOOKALIKES = { O: '0', Q: '0', D: '0', U: '0', P: '0', I: '1', L: '1', J: '1', Z: '2', A: '4', S: '5', G: '6', T: '7', B: '8' }
const toDigits = (s) => s.replace(/[A-Z]/g, (c) => DIGIT_LOOKALIKES[c] ?? c)
const charValue = (c) => (c === '<' ? 0 : /\d/.test(c) ? +c : c.charCodeAt(0) - 55)
const checkDigit = (s) => String([...s].reduce((a, c, i) => a + charValue(c) * [7, 3, 1][i % 3], 0) % 10)

/**
 * Quick local sanity check of a passport (TD3) read: birth and expiry check digits.
 * Lets the auto-scan skip bad frames instead of submitting them; the server does the full check.
 */
export function passportDatesOk(text) {
  const lines = text.split('\n').map((l) => l.replace(/\s/g, '').toUpperCase())
  const i = lines.findIndex((l) => /^[PV]/.test(l) && l.length >= 38 && l.includes('<<'))
  const l2 = lines[i + 1]
  if (i < 0 || !l2 || l2.length < 28) return false
  const dob = toDigits(l2.slice(13, 20)), exp = toDigits(l2.slice(21, 28))
  return checkDigit(dob.slice(0, 6)) === dob[6] && checkDigit(exp.slice(0, 6)) === exp[6]
}

/** OCR the MRZ band of an already-framed document image. */
export async function readMrzBand(docCanvas, band) {
  const h = docCanvas.height
  const top = Math.round(h * (1 - band))
  return recognize(crop(docCanvas, 0, top, docCanvas.width, h - top, 1400))
}

/**
 * OCR a free-form photo (upload). The document can be anywhere in the frame,
 * so try the bottom part first, then the whole image.
 */
export async function readMrzAnywhere(canvas) {
  const w = canvas.width, h = canvas.height
  const attempts = [
    [0, h * 0.5, w, h * 0.5],
    [0, h * 0.25, w, h * 0.5],
    [0, 0, w, h],
  ]
  let text = ''
  for (const [x, y, cw, ch] of attempts) {
    text = await recognize(crop(canvas, x, Math.round(y), cw, Math.round(ch), Math.min(1800, cw * 2)))
    if (looksLikeMrz(text)) return text
  }
  return text
}

export function canvasToBlob(canvas, quality = 0.9) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

export async function fileToCanvas(file, maxWidth = 2000) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxWidth / bitmap.width)
  const c = document.createElement('canvas')
  c.width = Math.round(bitmap.width * scale)
  c.height = Math.round(bitmap.height * scale)
  c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height)
  bitmap.close?.()
  return c
}
