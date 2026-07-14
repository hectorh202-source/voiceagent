import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// The server sends Cache-Control: no-store on this page specifically to
// keep it out of the browser's back/forward cache (bfcache) — but some
// browsers (notably Safari) can still restore a page from bfcache despite
// that header. If that happens, `persisted` is true and every bit of this
// app's in-memory state (React Query's cache, whatever user was logged in
// when the page was frozen) is stale — force a real reload so the app
// re-fetches /api/session and everything else fresh, rather than silently
// showing a previous session's data after a login/logout in the same tab.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    window.location.reload()
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
