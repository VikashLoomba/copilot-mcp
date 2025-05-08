import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { VscodeApiProvider } from './contexts/VscodeApiContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VscodeApiProvider>
      <App />
    </VscodeApiProvider>
  </StrictMode>,
)
