import 'ses'
import '../core/lockdown'
import { createRoot } from 'react-dom/client'

import { StandaloneClient } from './standalone-world'

function App() {
  return <StandaloneClient />
}

const root = createRoot(document.getElementById('root'))
root.render(<App />)
