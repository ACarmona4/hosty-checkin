import { useState } from 'react'
import { api, setToken } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { TextInput } from '../components/fields'

export default function Login({ onLoggedIn }) {
  const { t } = useI18n()
  const [reservation, setReservation] = useState('')
  const [lastName, setLastName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!reservation.trim() || !lastName.trim()) return
    setBusy(true)
    setError('')
    try {
      const { token } = await api.login(reservation.trim(), lastName.trim())
      setToken(token)
      await onLoggedIn()
    } catch (err) {
      // 503 = the API can't reach the database; show the server's message
      setError(err.status === 401 ? t('login.error') : err.status === 503 ? err.message : t('error.generic'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="login">
      <p className="eyebrow">{t('tagline')}</p>
      <h1>{t('login.title')}</h1>
      <p className="lead">{t('login.subtitle')}</p>
      <form onSubmit={submit} className="stack" noValidate>
        <TextInput label={t('login.reservation')} value={reservation} onChange={setReservation}
          hint={t('login.hint')} autoComplete="off" autoCapitalize="characters" spellCheck={false} required />
        <TextInput label={t('login.lastName')} value={lastName} onChange={setLastName}
          autoComplete="family-name" required />
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn primary block" disabled={busy || !reservation.trim() || !lastName.trim()}>
          {busy ? <span className="spinner light" /> : t('login.submit')}
        </button>
      </form>
    </section>
  )
}
