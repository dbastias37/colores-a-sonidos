import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

function ErrorBoundary({ children }) {
  const [err, setErr] = React.useState(null)
  React.useEffect(() => {
    const onErr = (ev) => setErr(ev?.error || ev)
    const onRej = (ev) => setErr(ev?.reason || ev)
    window.addEventListener('error', onErr)
    window.addEventListener('unhandledrejection', onRej)
    return () => {
      window.removeEventListener('error', onErr)
      window.removeEventListener('unhandledrejection', onRej)
    }
  }, [])
  if (err) {
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center">
        <div className="max-w-xl bg-white/5 border border-white/10 rounded-2xl p-6">
          <h1 className="text-2xl font-bold mb-2">Ocurrió un error</h1>
          <pre className="text-sm opacity-80 whitespace-pre-wrap">{String(err?.message || err)}</pre>
          <button className="mt-4 px-4 py-2 bg-purple-600 rounded-lg" onClick={()=>location.reload()}>Recargar</button>
        </div>
      </div>
    )
  }
  return children
}

const root = ReactDOM.createRoot(document.getElementById('root'))
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)

if (window.__hidePreboot) window.__hidePreboot()
