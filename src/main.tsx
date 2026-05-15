import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import App from './App.tsx'
import { loadPricingFromAPI } from './config/pricing'

// Initialize pricing from the API (reads from Google Sheets)
loadPricingFromAPI(window.location.origin);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
