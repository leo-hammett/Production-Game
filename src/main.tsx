import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Amplify } from 'aws-amplify'
// import outputs from '../amplify_outputs.json'  // Uncomment after running 'npx amplify sandbox'
import './index.css'
import App from './App.tsx'

// Amplify.configure(outputs)  // Uncomment after running 'npx amplify sandbox'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
