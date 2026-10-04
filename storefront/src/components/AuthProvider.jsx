import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AuthContext } from '../lib/auth.js'
import { api } from '../lib/api.js'

export default function AuthProvider({ children }) {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['me'], queryFn: async () => (await api.get('/auth/me')).data.user, retry: false })
  return <AuthContext value={{ user: query.data, loading: query.isPending, error: query.error, refresh: query.refetch,
    signIn(user) { client.cancelQueries({ queryKey: ['me'] }); client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' }); client.setQueryData(['me'], user) },
    async signOut() { await api.post('/auth/logout'); client.cancelQueries({ queryKey: ['me'] }); client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' }); client.setQueryData(['me'], null) },
  }}>{children}</AuthContext>
}