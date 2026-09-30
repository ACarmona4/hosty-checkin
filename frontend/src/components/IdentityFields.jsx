import { useI18n } from '../lib/i18n'
import { CountrySelect, DocTypeSelect, ScanBadge, TextInput } from './fields'

/** Document type/number, nationality, birth date and the document photo for one guest. */
export default function IdentityFields({ value, onChange, errors, prefix = '', definitions, scanStatus, onScan }) {
  const { t } = useI18n()
  const def = definitions[value.doc_type]
  const err = (k) => errors[`${prefix}${k}`]
  const set = (k) => (v) => onChange({ [k]: v })

  const setDocType = (docType) => {
    const d = definitions[docType]
    const patch = { doc_type: docType }
    // Colombian documents imply Colombian nationality
    if (d?.nationality === 'COL') patch.nationality = 'COL'
    else if (d?.nationality === '!COL' && value.nationality === 'COL') patch.nationality = ''
    onChange(patch)
  }

  const photoError = err('document_photo')

  return (
    <>
      <div className="grid">
        <DocTypeSelect label={t('f.docType')} value={value.doc_type} onChange={setDocType} error={err('doc_type')} />
        <TextInput label={t('f.docNumber')} value={value.doc_number} onChange={set('doc_number')}
          error={err('doc_number')} autoComplete="off" spellCheck={false}
          inputMode={def && /^\\d/.test(def.pattern) ? 'numeric' : 'text'} />
        <CountrySelect label={t('f.nationality')} value={value.nationality} onChange={set('nationality')}
          error={err('nationality')} />
        <TextInput label={t('f.birthDate')} type="date" value={value.birth_date} onChange={set('birth_date')}
          error={err('birth_date')} max={new Date().toISOString().slice(0, 10)} />
      </div>

      <div className={`doc-photo ${photoError ? 'has-error' : ''}`}>
        <div>
          <div className="doc-photo-title">
            {t('doc.photo')} <ScanBadge status={scanStatus} />
          </div>
          <p className="muted small">
            {def ? t(`doc.photoHint.${def.verification}`) : t('doc.pickType')}
          </p>
          {photoError && <span className="field-error">{t('f.photoRequired')}</span>}
        </div>
        <button type="button" className={`btn ${scanStatus ? 'ghost' : 'accent'}`} disabled={!def} onClick={onScan}>
          {scanStatus ? t('scan.again') : def?.verification === 'mrz' ? t('scan.cta') : t('scan.ctaPhoto')}
        </button>
      </div>
    </>
  )
}
