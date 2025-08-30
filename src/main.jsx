import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

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
    return (<div className="container"><div className="card"><h1>Ocurrió un error</h1><pre className="small">{String(err?.message||err)}</pre><button className="btn blue" onClick={()=>location.reload()}>Recargar</button></div></div>)
  }
  return children
}

const root = ReactDOM.createRoot(document.getElementById('root'))
root.render(<React.StrictMode><ErrorBoundary><App/></ErrorBoundary></React.StrictMode>)
if (window.__hidePreboot) window.__hidePreboot()
