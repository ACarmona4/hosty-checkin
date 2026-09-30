import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useI18n, formatDate } from '../lib/i18n'
import { countryName } from '../lib/countries'
import {
  canvasToBlob, crop, fileToCanvas, getWorker, looksLikeMrz, mrzBandFor, passportDatesOk, readMrzAnywhere, readMrzBand,
} from '../lib/ocr'

const AUTO_SCAN_MS = 1200

/**
 * Camera-based document capture. Behaviour depends on the document type definition:
 *  - mrz:   passports — auto-scan the MRZ in the browser (tesseract.js); the server validates it
 *  - photo: Colombian documents (CC, TI, CE) — just take a picture, no OCR at all
 */
export default function DocumentScanner({ docType, definition, guestIndex, expectedName, onResult, onClose }) {
  const { t, lang } = useI18n()
  const mode = definition.verification
  const usesOcr = mode !== 'photo'
  const ratio = definition.card_ratio
  const band = mrzBandFor(ratio)

  const videoRef = useRef(null)
  const frameRef = useRef(null)
  const streamRef = useRef(null)
  const busyRef = useRef(false)
  const fileRef = useRef(null)

  const [phase, setPhase] = useState('loading') // loading | camera | nocamera | reading | verifying | result
  const [result, setResult] = useState(null)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
  }, [])

  const startCamera = useCallback(async () => {
    setError('')
    setResult(null)
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      streamRef.current = stream
      const v = videoRef.current
      if (!v) throw new Error('unmounted')
      v.srcObject = stream
      await v.play()
      setPhase('camera')
    } catch {
      stopCamera()
      setPhase('nocamera')
    }
  }, [stopCamera])

  useEffect(() => {
    let cancelled = false
    const ready = usesOcr ? getWorker() : Promise.resolve()
    ready
      .then(() => !cancelled && startCamera())
      .catch(() => !cancelled && (setError(t('error.generic')), setPhase('nocamera')))
    return () => {
      cancelled = true
      stopCamera()
    }
  }, [startCamera, stopCamera, usesOcr, t])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /** Map the on-screen frame (video uses object-fit: cover) to video pixel coordinates. */
  const grabFrame = () => {
    const v = videoRef.current, f = frameRef.current
    if (!v?.videoWidth || !f) return null
    const vr = v.getBoundingClientRect(), fr = f.getBoundingClientRect()
    const scale = Math.max(vr.width / v.videoWidth, vr.height / v.videoHeight)
    const offX = (vr.width - v.videoWidth * scale) / 2
    const offY = (vr.height - v.videoHeight * scale) / 2
    const sx = Math.max(0, (fr.left - vr.left - offX) / scale)
    const sy = Math.max(0, (fr.top - vr.top - offY) / scale)
    const sw = Math.min(v.videoWidth - sx, fr.width / scale)
    const sh = Math.min(v.videoHeight - sy, fr.height / scale)
    return crop(v, sx, sy, sw, sh)
  }

  const verify = async (canvas, ocrText) => {
    setPhase('verifying')
    try {
      const image = await canvasToBlob(canvas)
      const res = await api.verifyDocument({ guestIndex, docType, ocrText, expectedName, image })
      stopCamera()
      setPreview(canvas.toDataURL('image/jpeg', 0.7))
      setResult(res)
      setPhase('result')
    } catch (e) {
      setError(e.message || t('error.generic'))
      setPhase(streamRef.current ? 'camera' : 'nocamera')
    }
  }

  // Auto-scan (documents with an MRZ): OCR the band periodically, verify once it looks readable.
  useEffect(() => {
    if (phase !== 'camera' || !usesOcr) return
    const id = setInterval(async () => {
      if (busyRef.current) return
      busyRef.current = true
      try {
        const frame = grabFrame()
        if (!frame) return
        const text = await readMrzBand(frame, band)
        // keep scanning until a frame reads cleanly; "Capturar" still submits whatever is there
        if (looksLikeMrz(text) && passportDatesOk(text)) {
          clearInterval(id)
          await verify(frame, text)
        }
      } finally {
        busyRef.current = false
      }
    }, AUTO_SCAN_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, usesOcr, band])

  const manualCapture = async () => {
    const frame = grabFrame()
    if (!frame) return
    if (!usesOcr) return verify(frame, '')
    setPhase('reading')
    while (busyRef.current) await new Promise((r) => setTimeout(r, 100))
    busyRef.current = true
    try {
      let text = await readMrzBand(frame, band)
      if (!looksLikeMrz(text)) text = await readMrzAnywhere(frame)
      await verify(frame, text)
    } finally {
      busyRef.current = false
    }
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    stopCamera()
    setError('')
    setPhase('reading')
    try {
      const canvas = await fileToCanvas(file)
      await verify(canvas, usesOcr ? await readMrzAnywhere(canvas) : '')
    } catch {
      setError(t('error.generic'))
      setPhase('nocamera')
    }
  }

  const retry = () => {
    setResult(null)
    setPreview(null)
    setPhase('loading')
    // wait for the viewfinder to re-mount before attaching the stream
    requestAnimationFrame(() => startCamera())
  }

  const f = result?.fields
  const status = result?.status
  const hasMrz = !!f
  const live = phase === 'camera' || phase === 'reading' || phase === 'verifying'

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('scan.title')}>
      <div className="modal scanner">
        <header className="modal-head">
          <div>
            <h2>{t('scan.title')}</h2>
            <p className="muted small">{t(`doc.${docType}`)}</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label={t('scan.close')}>×</button>
        </header>

        {phase !== 'result' && (
          <>
            <div className={`viewfinder ${live ? '' : 'is-hidden'}`}>
              <video ref={videoRef} playsInline muted />
              <div className="vf-mask">
                <div className="vf-frame" ref={frameRef} style={{ aspectRatio: ratio }}>
                  {usesOcr && (
                    <div className="vf-mrz" style={{ height: `${band * 100}%` }}>
                      <span>{t('scan.mrzZone')}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="vf-status">
                {phase === 'camera' && usesOcr && <><span className="pulse" /> {t('scan.auto')}</>}
                {phase === 'reading' && <><span className="spinner" /> {t('scan.reading')}</>}
                {phase === 'verifying' && <><span className="spinner" /> {t('scan.verifying')}</>}
              </div>
            </div>

            {phase === 'loading' && <div className="scanner-placeholder"><span className="spinner" /> {t('scan.loading')}</div>}
            {phase === 'nocamera' && <div className="scanner-placeholder">{t('scan.noCamera')}</div>}

            <p className="muted small">{t(mode === 'mrz' ? 'scan.instructions' : 'scan.instructionsCard')}</p>
            {error && <p className="error-text">{error}</p>}

            <div className="actions">
              <button className="btn ghost" onClick={() => fileRef.current?.click()} disabled={phase === 'reading' || phase === 'verifying'}>
                {t('scan.upload')}
              </button>
              {phase === 'camera' && <button className="btn primary" onClick={manualCapture}>{t('scan.capture')}</button>}
              <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
            </div>
          </>
        )}

        {phase === 'result' && result && (
          <div className="scan-result">
            <div className={`status-line status-${status}`}>
              <span className="status-dot" />
              {t(`scan.status.${status}`)}
            </div>

            {status === 'unreadable' && <p className="muted">{t('scan.unreadable')}</p>}
            {status === 'captured' && (
              <>
                {preview && <img className="doc-preview" src={preview} alt="" />}
                <p className="muted small">{t('scan.photoSaved')}</p>
              </>
            )}
            {hasMrz && (
              <>
                <dl className="kv">
                  <div><dt>{t('f.lastName')}</dt><dd>{f.surname}</dd></div>
                  <div><dt>{t('f.firstName')}</dt><dd>{f.given_names}</dd></div>
                  <div><dt>{t('f.docNumber')}</dt><dd className="mono">{f.document_number}</dd></div>
                  <div><dt>{t('f.nationality')}</dt><dd>{countryName(f.nationality, lang)}</dd></div>
                  <div><dt>{t('f.birthDate')}</dt><dd>{formatDate(f.birth_date, lang)}</dd></div>
                  <div><dt>{t('scan.expiry')}</dt><dd>{formatDate(f.expiry_date, lang)}</dd></div>
                </dl>
                <ul className="checks">
                  {result.checks.map((c) => (
                    <li key={c.id} className={c.ok ? 'ok' : 'ko'}>
                      <span aria-hidden>{c.ok ? '✓' : '✕'}</span> {t(`scan.check.${c.id}`)}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="actions">
              <button className="btn ghost" onClick={retry}>{t('scan.retry')}</button>
              {status === 'captured' && <button className="btn primary" onClick={() => onResult(result)}>{t('scan.done')}</button>}
              {(status === 'verified' || status === 'review') && (
                <button className="btn primary" onClick={() => onResult(result)}>{t('scan.use')}</button>
              )}
              {(status === 'failed' || status === 'unreadable') && (
                <button className="btn ghost" onClick={() => onResult(result)}>{t('scan.manual')}</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
