import { createContext, useContext } from 'react'

export const AuthContext = createContext(null)
export function useAuth() { return useContext(AuthContext) }
export const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0)