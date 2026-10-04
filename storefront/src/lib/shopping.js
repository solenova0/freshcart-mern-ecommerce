import { createContext, useContext } from 'react'

export const ShoppingContext = createContext(null)
export const useShopping = () => useContext(ShoppingContext)
export function rememberAge() { try { localStorage.setItem('freshcart-age-confirmed', 'true') } catch { return false } return true }
export function hasConfirmedAge() { try { return localStorage.getItem('freshcart-age-confirmed') === 'true' } catch { return false } }
export const unitLabel = (attributes = {}) => attributes.unit || (attributes.weightKg ? `${attributes.weightKg} kg` : attributes.weightGrams ? `${attributes.weightGrams} g` : attributes.volumeMl ? `${attributes.volumeMl} ml` : attributes.packSize ? `Pack of ${attributes.packSize}` : 'Each')