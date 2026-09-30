import { useI18n } from '../lib/i18n'
import { countryOptions } from '../lib/countries'

const ERROR_KEYS = { invalid: 'f.invalid', age_doc: 'f.age_doc', nat_doc: 'f.nat_doc', required: 'f.required' }

export function Field({ label, error, hint, optional, children, wide }) {
  const { t } = useI18n()
  return (
    <label className={`field ${error ? 'has-error' : ''} ${wide ? 'wide' : ''}`}>
      <span className="field-label">
        {label}
        {optional && <em>{t('f.optional')}</em>}
      </span>
      {children}
      {error ? <span className="field-error">{t(ERROR_KEYS[error] || 'f.required')}</span>
        : hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function TextInput({ label, value, onChange, error, optional, hint, wide, ...rest }) {
  return (
    <Field label={label} error={error} optional={optional} hint={hint} wide={wide}>
      <input value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />
    </Field>
  )
}

export function SelectInput({ label, value, onChange, options, error, optional, wide }) {
  const { t } = useI18n()
  return (
    <Field label={label} error={error} optional={optional} wide={wide}>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>{t('f.select')}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  )
}

export function CountrySelect(props) {
  const { lang } = useI18n()
  return <SelectInput {...props} options={countryOptions(lang)} />
}

export const REASONS = ['vacation', 'business', 'event', 'family', 'health', 'other']

const DOC_GROUPS = [
  ['national', ['CC', 'TI']],
  ['foreign', ['CE', 'PA']],
]

export function DocTypeSelect({ label, value, onChange, error }) {
  const { t } = useI18n()
  return (
    <Field label={label} error={error}>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>{t('f.select')}</option>
        {DOC_GROUPS.map(([group, codes]) => (
          <optgroup key={group} label={t(`doc.group.${group}`)}>
            {codes.map((c) => <option key={c} value={c}>{t(`doc.${c}`)}</option>)}
          </optgroup>
        ))}
      </select>
    </Field>
  )
}

export function ScanBadge({ status }) {
  const { t } = useI18n()
  const s = status || 'none'
  return <span className={`badge badge-${s}`}>{t(`scan.badge.${s}`)}</span>
}
