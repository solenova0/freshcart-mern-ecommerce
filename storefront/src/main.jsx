import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './app.css'
import Storefront from './Storefront.jsx'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { Toast } from '@freshcart/design-system'
import AuthProvider from './components/AuthProvider.jsx'
import { errorMessage } from './lib/api.js'

const queryClient = new QueryClient({
  mutationCache: new MutationCache({ onError: (error) => toast.error(errorMessage(error)) }),
  defaultOptions: { queries: { retry: 1, staleTime: 15000, refetchOnWindowFocus: false } },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}><BrowserRouter><AuthProvider><Storefront /><Toast /></AuthProvider></BrowserRouter></QueryClientProvider>
  </StrictMode>,
)
