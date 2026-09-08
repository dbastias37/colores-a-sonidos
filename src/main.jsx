import { Component, StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
class ErrorBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <main className="app-shell" style={{ paddingTop: 60 }}><h1>No pudimos abrir el estudio.</h1><p style={{ margin: '20px 0' }}>Recarga la página para volver a intentarlo.</p><button className="play-button" onClick={() => location.reload()}>Recargar</button></main> : this.props.children
  }
}
ReactDOM.createRoot(document.getElementById('root')).render(<StrictMode><ErrorBoundary><App/></ErrorBoundary></StrictMode>)
