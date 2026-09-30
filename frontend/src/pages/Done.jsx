import { formatDate, useI18n } from '../lib/i18n'

export default function Done({ session }) {
  const { t, lang } = useI18n()
  const r = session.reservation
  const companions = session.data.companions || []
  return (
    <section className="done">
      <div className="done-mark" aria-hidden>✓</div>
      <h1>{t('done.title')}</h1>
      <p className="lead">{t('done.body', { name: r.first_name })}</p>

      <div className="card">
        <h3 className="card-title">{t('done.summary')}</h3>
        <dl className="kv">
          <div><dt>{t('res.property')}</dt><dd>{r.property}</dd></div>
          <div><dt>{t('res.room')}</dt><dd>{r.room}</dd></div>
          <div><dt>{t('res.checkIn')}</dt><dd>{formatDate(r.check_in, lang)}</dd></div>
          <div><dt>{t('res.checkOut')}</dt><dd>{formatDate(r.check_out, lang)}</dd></div>
          <div><dt>{t('res.holder')}</dt><dd>{r.first_name} {r.last_name}</dd></div>
          <div><dt>{t('res.guests')}</dt><dd>{r.guests}</dd></div>
        </dl>
        {companions.length > 0 && (
          <ul className="plain-list">
            {companions.map((c, i) => <li key={i}>{c.full_name} <span className="muted">· {c.doc_type} {c.doc_number}</span></li>)}
          </ul>
        )}
        {session.submitted_at && (
          <p className="muted small">{t('done.submittedAt')} {formatDate(session.submitted_at, lang)}</p>
        )}
      </div>
    </section>
  )
}
