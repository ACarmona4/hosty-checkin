import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'

export default function SignaturePad({ onChange, invalid }) {
  const { t } = useI18n()
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const last = useRef(null)
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    const c = canvasRef.current
    const resize = () => {
      const ratio = window.devicePixelRatio || 1
      const { width, height } = c.getBoundingClientRect()
      c.width = width * ratio
      c.height = height * ratio
      const ctx = c.getContext('2d')
      ctx.scale(ratio, ratio)
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#0f1b2d'
      setEmpty(true)
      onChange(null)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(c)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const point = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const down = (e) => {
    e.preventDefault()
    canvasRef.current.setPointerCapture(e.pointerId)
    drawing.current = true
    last.current = point(e)
  }
  const move = (e) => {
    if (!drawing.current) return
    const ctx = canvasRef.current.getContext('2d')
    const p = point(e)
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
    if (empty) setEmpty(false)
  }
  const up = () => {
    if (!drawing.current) return
    drawing.current = false
    if (!empty) onChange(canvasRef.current.toDataURL('image/png'))
  }

  const clear = () => {
    const c = canvasRef.current
    c.getContext('2d').clearRect(0, 0, c.width, c.height)
    setEmpty(true)
    onChange(null)
  }

  return (
    <div className={`signature ${invalid ? 'invalid' : ''}`}>
      <canvas
        ref={canvasRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        aria-label={t('rules.signature')}
      />
      {empty && <span className="signature-hint">{t('rules.signHere')}</span>}
      <div className="signature-line" />
      <button type="button" className="link-btn signature-clear" onClick={clear}>{t('rules.clear')}</button>
    </div>
  )
}
