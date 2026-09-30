import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, setToken } from './lib/api'
import { I18nContext, translator } from './lib/i18n'
import Login from './pages/Login'
import Wizard from './pages/Wizard'
import Done from './pages/Done'

const LANG_KEY = 'plathost.lang'

function initialLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved) return saved
  } catch { /* ignore */ }
  return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en'
}

export default function App() {
  const [lang, setLangState] = useState(initialLang)
  const [session, setSession] = useState(null) // { reservation, data, status, scans, submitted_at }
  const [definitions, setDefinitions] = useState(null)
  const [loading, setLoading] = useState(api.hasSession())

  const setLang = useCallback((l) => {
    setLangState(l)
    try { localStorage.setItem(LANG_KEY, l) } catch { /* ignore */ }
  }, [])

  useEffect(() => { document.documentElement.lang = lang }, [lang])

  const i18n = useMemo(() => ({ lang, setLang, t: translator(lang) }), [lang, setLang])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, defs] = await Promise.all([api.load(), definitions ? null : api.documentTypes()])
      if (defs) setDefinitions(Object.fromEntries(defs.map((d) => [d.code, d])))
      setSession(s)
    } catch {
      setToken(null)
      setSession(null)
    } finally {
      setLoading(false)
    }
  }, [definitions])

  useEffect(() => {
    if (api.hasSession()) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const logout = () => {
    setToken(null)
    setSession(null)
  }

  let page
  if (loading) page = <div className="center-state"><span className="spinner" /></div>
  else if (!session) page = <Login onLoggedIn={load} />
  else if (session.status === 'submitted') page = <Done session={session} />
  else page = <Wizard session={session} definitions={definitions} onSubmitted={load} onSessionLost={logout} />

  return (
    <I18nContext.Provider value={i18n}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="wordmark">PlatHost</span>
            <span className="brand-sep" />
            <span className="brand-tag">{session?.reservation?.property || i18n.t('tagline')}</span>
          </div>
          <div className="topbar-actions">
            <div className="lang-switch" role="group" aria-label="Language">
              {['es', 'en'].map((l) => (
                <button key={l} className={l === lang ? 'active' : ''} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
              ))}
            </div>
            {session && <button className="link-btn" onClick={logout}>{i18n.t('logout')}</button>}
          </div>
        </header>
        <main className="content">{page}</main>
        <footer className="footer">PlatHost · {new Date().getFullYear()}</footer>
      </div>
    </I18nContext.Provider>
  )
}
