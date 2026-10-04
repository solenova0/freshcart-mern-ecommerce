import { useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { ArrowRight, Check, Mail, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Button, Input } from '@freshcart/design-system'
import toast from 'react-hot-toast'
import { z } from 'zod'
import { api, errorMessage } from '../lib/api.js'
import { useAuth } from '../lib/auth.js'

const emailSchema = z.string().trim().toLowerCase().pipe(z.email())
const passwordSchema = z.string().min(8, 'Use at least 8 characters').refine((value) => new TextEncoder().encode(value).length <= 72, 'Use at most 72 UTF-8 bytes')

export function AuthPage({ register = false }) {
  const auth = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [errors, setErrors] = useState({})
  const mutation = useMutation({ mutationFn: async (values) => (await api.post(`/auth/${register ? 'register' : 'login'}`, values)).data,
    onSuccess: (data, values) => { if (register) { toast.success('Check your email'); navigate(`/verify-email?email=${encodeURIComponent(values.email)}`) } else { auth.signIn(data.user); navigate(location.state?.from?.startsWith('/') && !location.state.from.startsWith('//') ? location.state.from : '/shop', { replace: true }) } },
  })
  function submit(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const schema = register ? z.object({ name: z.string().trim().min(1, 'Enter your name').max(100), email: emailSchema, password: passwordSchema, ageConfirmed: z.boolean() }) : z.object({ email: emailSchema, password: passwordSchema })
    const values = { email: String(form.get('email')), password: String(form.get('password')), ...(register ? { name: String(form.get('name')), ageConfirmed: form.get('ageConfirmed') === 'on' } : {}) }
    const parsed = schema.safeParse(values)
    if (!parsed.success) { setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path[0], issue.message]))); return }
    setErrors({}); mutation.mutate(parsed.data)
  }
  return <div className="auth-layout page"><section><p className="eyebrow">YOUR EVERYDAY MARKET</p><h1 className="page-heading">{register ? 'A fresh start.' : 'Good to see you.'}</h1><p className="muted mt-4">{register ? 'Make yourself at home.' : 'Your next market run starts here.'}</p><img className="auth-photo" src="/produce.jpg" alt="Fresh seasonal produce" /></section><form className="auth-form" onSubmit={submit} noValidate><h2>{register ? 'Create an account' : 'Sign in'}</h2>{register && <Input label="Name" name="name" autoComplete="name" required maxLength={100} error={errors.name} />}<Input label="Email" name="email" type="email" autoComplete="email" required maxLength={254} error={errors.email} /><Input label="Password" name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required maxLength={72} error={errors.password} />{register && <label className="checkbox-label"><input type="checkbox" name="ageConfirmed" /><span>I confirm I am 18 or older and of legal age to purchase hookah accessories.</span></label>}{mutation.isError && <p className="field-error" role="alert">{errorMessage(mutation.error)}</p>}<Button type="submit" variant="accent" loading={mutation.isPending}>{register ? 'Create account' : 'Sign in'}<ArrowRight size={18} /></Button><p className="muted text-sm">{register ? 'Already a customer?' : 'New to the market?'} <Link className="text-link" to={register ? '/login' : '/register'}>{register ? 'Sign in' : 'Create an account'}</Link></p>{!register && <Link to="/verify-email" className="text-link">Resend verification email</Link>}</form></div>
}

export function VerifyEmail() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [emailError, setEmailError] = useState('')
  const verification = useMutation({ mutationFn: () => api.get('/auth/verify-email', { params: { token: params.get('token') } }), onSuccess: () => { toast.success('Email verified'); navigate('/verify-email?verified=1', { replace: true }) } })
  const resend = useMutation({ mutationFn: (email) => api.post('/auth/resend-verification', { email }), onSuccess: () => toast.success('If eligible, a new link is on its way') })
  const success = params.get('verified') === '1'
  const expired = verification.isError && verification.error.response?.status === 400
  return <div className="page verification"><div className="verification-icon">{success ? <ShieldCheck size={32} /> : expired ? <TriangleAlert size={32} /> : <Mail size={32} />}</div><h1 className="page-heading">{success ? 'You’re verified.' : expired ? 'This link has expired' : verification.isPending ? 'Checking your email...' : 'Verify your email'}</h1><p className="muted mt-4" role="status">{success ? 'Your account is ready. Your next fresh find is waiting.' : expired ? 'The link is invalid, expired, or already used. Request a new one below.' : params.get('token') ? 'Confirm your email to activate your account.' : 'Open the verification link in your inbox, or request a new one.'}</p>{success ? <Link to="/login" className="btn accent mt-8">Sign in<Check size={18} /></Link> : params.get('token') && !expired && <Button className="mt-8" variant="accent" loading={verification.isPending} onClick={() => verification.mutate()}>Confirm email address</Button>}{verification.isError && !expired && <p role="alert" className="field-error mt-4">{errorMessage(verification.error)}</p>}{!success && <form className="auth-form mt-10" noValidate onSubmit={(event) => { event.preventDefault(); const parsed = emailSchema.safeParse(new FormData(event.currentTarget).get('email')); if (!parsed.success) { setEmailError('Enter a valid email address'); return } setEmailError(''); resend.mutate(parsed.data) }}><Input label="Email" name="email" type="email" defaultValue={params.get('email') || ''} autoComplete="email" required error={emailError} />{resend.isError && <p role="alert" className="field-error">{errorMessage(resend.error)}</p>}<Button type="submit" variant="ghost" loading={resend.isPending}>Resend verification email</Button></form>}</div>
}