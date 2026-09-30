const KEY = 'plathost.token'

function token() {
  try { return sessionStorage.getItem(KEY) } catch { return null }
}

export function setToken(t) {
  try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY) } catch { /* ignore */ }
}

export class ApiError extends Error {
  constructor(status, detail) {
    super(typeof detail === 'string' ? detail : detail?.message || 'Error')
    this.status = status
    this.detail = detail
  }
}

async function request(path, { method = 'GET', body, form } = {}) {
  const headers = {}
  const t = token()
  if (t) headers.Authorization = `Bearer ${t}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(path, {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/session') setToken(null)
    throw new ApiError(res.status, data.detail)
  }
  return data
}

export const api = {
  hasSession: () => !!token(),
  login: (reservation, last_name) => request('/api/session', { method: 'POST', body: { reservation, last_name } }),
  load: () => request('/api/checkin'),
  saveDraft: (data) => request('/api/checkin', { method: 'PUT', body: data }),
  submit: (data, signature) => request('/api/checkin/submit', { method: 'POST', body: { data, signature } }),
  rules: () => request('/api/rules'),
  documentTypes: () => request('/api/document-types'),
  verifyDocument: ({ guestIndex, docType, ocrText, expectedName, image }) => {
    const form = new FormData()
    form.append('guest_index', guestIndex)
    form.append('doc_type', docType)
    form.append('ocr_text', ocrText)
    form.append('expected_name', expectedName || '')
    form.append('image', image, 'document.jpg')
    return request('/api/documents/verify', { method: 'POST', form })
  },
}
