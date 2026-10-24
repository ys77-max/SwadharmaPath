import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { setApi } from './lib/api'
import { DEMO_MODE } from './lib/supabase'

async function boot() {
  // The demo data layer is a separate chunk that production builds never load.
  setApi(DEMO_MODE ? (await import('./lib/api/demoApi')).demoApi : (await import('./lib/api/supabaseApi')).supabaseApi)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

boot()
