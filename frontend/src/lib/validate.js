// Client-side mirror of backend/app/documents.py — the server remains the authority.

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export const normalizeNumber = (v) => (v || '').replace(/[\s.-]/g, '').toUpperCase()

function ageOn(birthIso, onIso) {
  const [by, bm, bd] = birthIso.split('-').map(Number)
  const [oy, om, od] = String(onIso).slice(0, 10).split('-').map(Number)
  return oy - by - (om < bm || (om === bm && od < bd) ? 1 : 0)
}

/** Validate one guest's identity data. Keys are prefixed (e.g. "companions.0."). */
export function validateIdentity(g, defs, onIso, prefix = '') {
  const errors = {}
  const def = defs[g.doc_type]
  if (!def) {
    errors[`${prefix}doc_type`] = 'required'
    return errors
  }
  const num = normalizeNumber(g.doc_number)
  if (!num) errors[`${prefix}doc_number`] = 'required'
  else if (!new RegExp(`^(?:${def.pattern})$`).test(num)) errors[`${prefix}doc_number`] = 'invalid'

  if (!g.birth_date) errors[`${prefix}birth_date`] = 'required'
  else {
    const age = ageOn(g.birth_date, onIso)
    const today = new Date().toISOString().slice(0, 10)
    if (Number.isNaN(age) || g.birth_date >= today || age > 120) errors[`${prefix}birth_date`] = 'invalid'
    else if ((def.min_age != null && age < def.min_age) || (def.max_age != null && age > def.max_age)) {
      errors[`${prefix}birth_date`] = 'age_doc'
    }
  }

  if (!g.nationality) errors[`${prefix}nationality`] = 'required'
  else if (def.nationality === 'COL' && g.nationality !== 'COL') errors[`${prefix}nationality`] = 'nat_doc'
  else if (def.nationality === '!COL' && g.nationality === 'COL') errors[`${prefix}nationality`] = 'nat_doc'
  return errors
}

export function required(obj, keys, prefix = '') {
  const errors = {}
  for (const k of keys) if (!String(obj[k] ?? '').trim()) errors[`${prefix}${k}`] = 'required'
  return errors
}
