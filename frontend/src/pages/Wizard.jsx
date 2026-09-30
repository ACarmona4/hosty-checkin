import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { formatDate, useI18n } from '../lib/i18n'
import { normalizeCountry } from '../lib/countries'
import { EMAIL_RE, required, validateIdentity } from '../lib/validate'
import { CountrySelect, REASONS, SelectInput, TextInput } from '../components/fields'
import IdentityFields from '../components/IdentityFields'
import DocumentScanner from '../components/DocumentScanner'
import SignaturePad from '../components/SignaturePad'

const EMPTY_COMPANION = { full_name: '', doc_type: '', doc_number: '', birth_date: '', nationality: '' }

function initialData(reservation, saved) {
  const count = Math.max(0, reservation.guests - 1)
  const companions = Array.from({ length: count }, (_, i) => ({ ...EMPTY_COMPANION, ...(saved.companions?.[i] || {}) }))
  return {
    email: reservation.email || '',
    phone: reservation.phone || '',
    nationality: '', doc_type: '', doc_number: '', birth_date: '', residence_country: '',
    vehicle_plate: '', visit_reason: '', emergency_name: '', emergency_phone: '',
    rules_accepted: false, data_authorized: false,
    ...saved,
    companions,
  }
}

const titleCase = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())

export default function Wizard({ session, definitions, onSubmitted, onSessionLost }) {
  const { t, lang } = useI18n()
  const r = session.reservation
  const [data, setData] = useState(() => initialData(r, session.data || {}))
  const [scans, setScans] = useState(session.scans || {})
  const [errors, setErrors] = useState({})
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [scanner, setScanner] = useState(null) // guest index being scanned
  const [signature, setSignature] = useState(null)
  const [rules, setRules] = useState(null)
  const [rulesLang, setRulesLang] = useState(lang)

  useEffect(() => { api.rules().then(setRules).catch(() => {}) }, [])
  useEffect(() => { setRulesLang(lang) }, [lang])

  const steps = useMemo(() => [
    'reservation', 'holder', 'stay', ...(r.guests > 1 ? ['companions'] : []), 'rules',
  ], [r.guests])
  const current = steps[step]

  // Editing a field clears its error; changing the document type also re-checks its dependants.
  const clearErrors = (keys) => setErrors((e) => {
    if (!keys.some((k) => k in e)) return e
    const n = { ...e }
    keys.forEach((k) => delete n[k])
    return n
  })
  const related = (keys) => (keys.includes('doc_type') ? [...keys, 'doc_number', 'birth_date', 'nationality', 'document_photo'] : keys)
  const set = (k) => (v) => {
    setData((d) => ({ ...d, [k]: v }))
    clearErrors([k])
  }
  const patch = (p) => {
    setData((d) => ({ ...d, ...p }))
    clearErrors(related(Object.keys(p)))
  }
  const patchCompanion = (i, p) => {
    setData((d) => ({ ...d, companions: d.companions.map((c, j) => (j === i ? { ...c, ...p } : c)) }))
    clearErrors(related(Object.keys(p)).map((k) => `companions.${i}.${k}`))
  }

  const guestDoc = (idx) => (idx === 0 ? data : data.companions[idx - 1])
  const scanStatus = (idx) => scans[`${idx}:${guestDoc(idx).doc_type}`]

  // ---------------------------------------------------------------- validation per step
  const validate = (name) => {
    let e = {}
    const on = r.check_in
    const photo = (idx, prefix) => (guestDoc(idx).doc_type && !scanStatus(idx) ? { [`${prefix}document_photo`]: 'required' } : {})
    if (name === 'reservation') {
      e = required(data, ['email', 'phone'])
      if (data.email && !EMAIL_RE.test(data.email.trim())) e.email = 'invalid'
    }
    if (name === 'holder') {
      e = { ...validateIdentity(data, definitions, on), ...required(data, ['residence_country']), ...photo(0, '') }
    }
    if (name === 'stay') e = required(data, ['visit_reason', 'emergency_name', 'emergency_phone'])
    if (name === 'companions') {
      data.companions.forEach((c, i) => {
        const p = `companions.${i}.`
        Object.assign(e, required(c, ['full_name'], p), validateIdentity(c, definitions, on, p), photo(i + 1, p))
      })
    }
    if (name === 'rules') {
      if (!data.rules_accepted) e.rules_accepted = 'required'
      if (!data.data_authorized) e.data_authorized = 'required'
      if (!signature) e.signature = 'required'
    }
    return e
  }

  const saveDraft = async () => {
    try {
      await api.saveDraft({ ...data, language: lang })
    } catch (err) {
      if (err.status === 401) onSessionLost()
    }
  }

  const go = (to) => {
    setStep(to)
    setFormError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const next = async () => {
    const e = validate(current)
    setErrors(e)
    if (Object.keys(e).length) {
      setFormError(t('error.fix'))
      return
    }
    if (current === 'rules') return submit()
    saveDraft()
    go(step + 1)
  }

  const stepOfError = (key) => {
    if (key.startsWith('companions')) return steps.indexOf('companions')
    if (['email', 'phone'].includes(key)) return 0
    if (['visit_reason', 'emergency_name', 'emergency_phone', 'vehicle_plate'].includes(key)) return steps.indexOf('stay')
    if (['rules_accepted', 'data_authorized', 'signature'].includes(key)) return steps.indexOf('rules')
    return steps.indexOf('holder')
  }

  const submit = async () => {
    setBusy(true)
    setFormError('')
    try {
      await api.submit({ ...data, language: lang }, signature)
      await onSubmitted()
    } catch (err) {
      if (err.status === 401) return onSessionLost()
      const fields = err.detail?.fields
      if (fields) {
        setErrors(fields)
        const first = Math.min(...Object.keys(fields).map(stepOfError))
        if (first >= 0 && first !== step) go(first)
        setFormError(t('error.fix'))
      } else setFormError(t('error.generic'))
    } finally {
      setBusy(false)
    }
  }

  // ---------------------------------------------------------------- scanner result
  const onScanResult = (idx, result) => {
    const doc = guestDoc(idx)
    setScans((s) => ({ ...s, [`${idx}:${doc.doc_type}`]: result.status }))
    setErrors((e) => {
      const n = { ...e }
      delete n[idx === 0 ? 'document_photo' : `companions.${idx - 1}.document_photo`]
      return n
    })
    const f = result.fields
    if (f && (result.status === 'verified' || result.status === 'review')) {
      const p = {
        doc_number: f.document_number || doc.doc_number,
        nationality: normalizeCountry(f.nationality) || doc.nationality,
        birth_date: f.birth_date || doc.birth_date,
      }
      if (idx === 0) patch(p)
      else {
        if (!doc.full_name.trim()) p.full_name = titleCase(`${f.given_names} ${f.surname}`.trim())
        patchCompanion(idx - 1, p)
      }
    }
    setScanner(null)
  }

  const err = (k) => errors[k]
  const nights = Math.round((new Date(r.check_out) - new Date(r.check_in)) / 86400000)
  const rulesDoc = rules?.[rulesLang] || rules?.es

  return (
    <section className="wizard">
      <nav className="progress" aria-label="progress">
        <div className="progress-text">
          <span>{t('step.of', { n: step + 1, total: steps.length })}</span>
          <span className="progress-name">{t(`steps.${current}`)}</span>
        </div>
        <div className="progress-bar"><div style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
      </nav>

      {current === 'reservation' && (
        <>
          <h1>{t('res.title')}</h1>
          <p className="lead">{t('res.subtitle')}</p>
          <div className="card readonly">
            <span className="tag">{t('res.fromBooking')}</span>
            <dl className="kv">
              <div><dt>{t('res.property')}</dt><dd>{r.property}</dd></div>
              <div><dt>{t('res.room')}</dt><dd>{r.room}</dd></div>
              <div><dt>{t('res.checkIn')}</dt><dd>{formatDate(r.check_in, lang)}</dd></div>
              <div><dt>{t('res.checkOut')}</dt><dd>{formatDate(r.check_out, lang)} <span className="muted">· {t('res.nights', { n: nights })}</span></dd></div>
              <div><dt>{t('res.holder')}</dt><dd>{r.first_name} {r.last_name}</dd></div>
              <div><dt>{t('res.guests')}</dt><dd>{r.guests}</dd></div>
            </dl>
          </div>
          <h2>{t('res.contact')}</h2>
          <p className="muted">{t('res.contactHint')}</p>
          <div className="grid">
            <TextInput label={t('f.email')} type="email" value={data.email} onChange={set('email')} error={err('email')} autoComplete="email" />
            <TextInput label={t('f.phone')} type="tel" value={data.phone} onChange={set('phone')} error={err('phone')} autoComplete="tel" placeholder="+57 300 000 0000" />
          </div>
        </>
      )}

      {current === 'holder' && (
        <>
          <h1>{t('holder.title')}</h1>
          <p className="lead">{t('holder.subtitle')}</p>
          <div className="card readonly compact">
            <span className="tag">{t('res.fromBooking')}</span>
            <dl className="kv">
              <div><dt>{t('f.firstName')}</dt><dd>{r.first_name}</dd></div>
              <div><dt>{t('f.lastName')}</dt><dd>{r.last_name}</dd></div>
            </dl>
          </div>
          <IdentityFields value={data} onChange={patch} errors={errors} definitions={definitions}
            scanStatus={scanStatus(0)} onScan={() => setScanner(0)} />
          <div className="grid">
            <CountrySelect label={t('f.residence')} value={data.residence_country} onChange={set('residence_country')} error={err('residence_country')} />
          </div>
        </>
      )}

      {current === 'stay' && (
        <>
          <h1>{t('stay.title')}</h1>
          <p className="lead">{t('stay.subtitle')}</p>
          <div className="grid">
            <SelectInput label={t('f.reason')} value={data.visit_reason} onChange={set('visit_reason')} error={err('visit_reason')}
              options={REASONS.map((v) => ({ value: v, label: t(`reason.${v}`) }))} />
            <TextInput label={t('f.plate')} value={data.vehicle_plate} onChange={(v) => set('vehicle_plate')(v.toUpperCase())} optional autoComplete="off" />
            <TextInput label={t('f.emergencyName')} value={data.emergency_name} onChange={set('emergency_name')} error={err('emergency_name')} />
            <TextInput label={t('f.emergencyPhone')} type="tel" value={data.emergency_phone} onChange={set('emergency_phone')} error={err('emergency_phone')} />
          </div>
        </>
      )}

      {current === 'companions' && (
        <>
          <h1>{t('comp.title')}</h1>
          <p className="lead">{t('comp.subtitle', { n: data.companions.length })}</p>
          {data.companions.map((c, i) => (
            <fieldset key={i} className="card companion">
              <legend>{t('comp.guest', { n: i + 1 })}</legend>
              <div className="grid">
                <TextInput label={t('f.fullName')} value={c.full_name} onChange={(v) => patchCompanion(i, { full_name: v })}
                  error={err(`companions.${i}.full_name`)} wide />
              </div>
              <IdentityFields value={c} onChange={(p) => patchCompanion(i, p)} errors={errors} prefix={`companions.${i}.`}
                definitions={definitions} scanStatus={scanStatus(i + 1)} onScan={() => setScanner(i + 1)} />
            </fieldset>
          ))}
        </>
      )}

      {current === 'rules' && (
        <>
          <h1>{t('rules.title')}</h1>
          <p className="lead">{t('rules.subtitle')}</p>
          {rules && (
            <div className="tabs" role="tablist">
              {Object.entries(rules).map(([code, doc]) => (
                <button key={code} role="tab" aria-selected={code === rulesLang} className={code === rulesLang ? 'active' : ''}
                  onClick={() => setRulesLang(code)}>{doc.label}</button>
              ))}
            </div>
          )}
          {rulesDoc && (
            <div className="rules" lang={rulesLang}>
              {rulesDoc.sections.map((s) => (
                <section key={s.title}>
                  <h3>{s.title}</h3>
                  {s.intro && <p>{s.intro}</p>}
                  <ol>{s.items.map((it) => <li key={it}>{it}</li>)}</ol>
                </section>
              ))}
              {rulesDoc.notes.map((n) => <p key={n} className="note">{n}</p>)}
              <section>
                <h3>{rulesDoc.authorization.title}</h3>
                <p>{rulesDoc.authorization.text}</p>
                <p>{rulesDoc.authorization.acceptance}</p>
              </section>
            </div>
          )}
          <label className={`check ${err('rules_accepted') ? 'has-error' : ''}`}>
            <input type="checkbox" checked={data.rules_accepted} onChange={(e) => set('rules_accepted')(e.target.checked)} />
            <span>{t('rules.accept')}</span>
          </label>
          <label className={`check ${err('data_authorized') ? 'has-error' : ''}`}>
            <input type="checkbox" checked={data.data_authorized} onChange={(e) => set('data_authorized')(e.target.checked)} />
            <span>{t('rules.data')}</span>
          </label>
          <div className="sign-block">
            <div className="field-label">{t('rules.signature')} — {r.first_name} {r.last_name}</div>
            <SignaturePad onChange={setSignature} invalid={!!err('signature')} />
            <div className="muted small">{t('rules.date')}: {formatDate(new Date().toISOString(), lang)}</div>
          </div>
        </>
      )}

      {formError && <p className="error-text" role="alert">{formError}</p>}

      <div className="nav-actions">
        {step > 0 ? <button className="btn ghost" onClick={() => go(step - 1)} disabled={busy}>{t('back')}</button> : <span />}
        <button className="btn primary" onClick={next} disabled={busy}>
          {busy ? <span className="spinner light" /> : current === 'rules' ? t('submit') : t('next')}
        </button>
      </div>

      {scanner !== null && definitions[guestDoc(scanner).doc_type] && (
        <DocumentScanner
          docType={guestDoc(scanner).doc_type}
          definition={definitions[guestDoc(scanner).doc_type]}
          guestIndex={scanner}
          expectedName={scanner === 0 ? `${r.first_name} ${r.last_name}` : data.companions[scanner - 1].full_name}
          onResult={(res) => onScanResult(scanner, res)}
          onClose={() => setScanner(null)}
        />
      )}
    </section>
  )
}
