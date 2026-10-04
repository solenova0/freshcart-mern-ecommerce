import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ShoppingBag, Wallet, Clock, PackageCheck, ArrowRight } from 'lucide-react'
import { Badge, Button, Card, Input } from '@freshcart/design-system'
import { z } from 'zod'
import { api, errorMessage, money } from '../lib/api.js'
import { useAuth } from '../lib/auth.js'
import { QueryState } from '../components/ui.jsx'

export function Login() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [errors, setErrors] = useState({})
  const login = useMutation({ mutationFn: async (values) => { const { data } = await api.post('/auth/login', values); if (data.user.role !== 'admin') { await api.post('/auth/logout'); throw new Error('Administrator access required') } return data.user }, onSuccess: (user) => { auth.signIn(user); navigate('/', { replace: true }) } })
  return <div className="login-page"><div className="login-brand">FreshCart <span>Admin</span></div><form className="login-form" noValidate onSubmit={(event) => { event.preventDefault(); const parsed = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()), password: z.string().min(8).refine((value) => new TextEncoder().encode(value).length <= 72, 'Use at most 72 bytes') }).safeParse(Object.fromEntries(new FormData(event.currentTarget))); if (!parsed.success) { setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path[0], issue.message]))); return } setErrors({}); login.mutate(parsed.data) }}><p className="eyebrow">STORE OPERATIONS</p><h1>Sign in</h1><Input label="Email" name="email" type="email" autoComplete="email" error={errors.email} required /><Input label="Password" name="password" type="password" autoComplete="current-password" error={errors.password} required />{login.isError && <p className="field-error" role="alert">{errorMessage(login.error)}</p>}<Button type="submit" variant="accent" loading={login.isPending}>Sign in<ArrowRight size={18} /></Button></form></div>
}

export function Dashboard() {
  const stats = useQuery({ queryKey: ['admin-stats'], queryFn: async () => (await api.get('/orders/admin/stats')).data.stats })
  const recent = useQuery({ queryKey: ['admin-recent'], queryFn: async () => (await api.get('/orders/admin', { params: { limit: 5 } })).data })
  return <><div className="page-title"><div><p className="eyebrow">STORE AT A GLANCE</p><h1>Dashboard</h1></div><span className="muted text-sm">{new Date().toLocaleDateString(undefined, { dateStyle: 'medium' })}</span></div><QueryState query={stats} />{stats.data && <div className="stats-grid"><Card className="stat"><ShoppingBag size={22} /><span>Orders today</span><strong>{stats.data.ordersToday ?? '—'}</strong></Card><Card className="stat"><Wallet size={22} /><span>Paid revenue</span><strong>{money(stats.data.revenue)}</strong></Card><Card className="stat"><Clock size={22} /><span>Pending orders</span><strong>{stats.data.pending}</strong></Card><Card className="stat"><PackageCheck size={22} /><span>Low stock</span><strong>{stats.data.lowStock ?? '—'}</strong></Card></div>}<div className="section-heading"><h2>Recent orders</h2><span className="muted text-sm">Latest 5</span></div><QueryState query={recent} empty={recent.data?.orders.length === 0} />{recent.data?.orders.length > 0 && <div className="table-wrap" tabIndex={0} role="region" aria-label="Recent orders table"><table><caption className="sr-only">Recent orders</caption><thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Status</th><th>Total</th></tr></thead><tbody>{recent.data.orders.map((order) => <tr key={order._id}><td>#{order._id.slice(-8).toUpperCase()}</td><td>{order.address.fullName}</td><td>{new Date(order.createdAt).toLocaleDateString()}</td><td><Badge status={order.orderStatus} /></td><td>{money(order.total)}</td></tr>)}</tbody></table></div>}</>
}