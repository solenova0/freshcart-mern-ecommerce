import axios from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  withCredentials: true,
  timeout: 20000,
})

export function errorMessage(error) {
  return error.response?.data?.error?.message || error.message || 'Request failed'
}