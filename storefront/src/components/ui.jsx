import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Leaf, Minus, Plus, ArrowLeft, ArrowRight } from 'lucide-react'
import { Badge, Button, EmptyState, Input, Skeleton } from '@freshcart/design-system'
import toast from 'react-hot-toast'
import { api, errorMessage } from '../lib/api.js'
import { money, useAuth } from '../lib/auth.js'
import { unitLabel } from '../lib/shopping.js'

export function QueryState({ query, empty, message = 'Nothing here yet.' }) {
  if (query.isPending) return <div role="status" aria-label="Loading" className="loading-skeletons"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
  if (query.isError) return <div role="alert" className="state"><p>{errorMessage(query.error)}</p><button className="btn secondary" onClick={() => query.refetch()}>Try again</button></div>
  if (empty) return <EmptyState title="A fresh start" message={message} />
  return null
}

export function ProtectedRoute() {
  const auth = useAuth()
  const location = useLocation()
  if (auth.loading) return <div className="state" role="status">Checking your account...</div>
  if (auth.error && ![401, 403].includes(auth.error.response?.status)) return <div role="alert" className="state"><p>Unable to reach your account.</p><button className="btn" onClick={auth.refresh}>Try again</button></div>
  if (!auth.user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  return <Outlet />
}

export function ProductCard({ product }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const client = useQueryClient()
  const cart = useQuery({ queryKey: ['cart'], queryFn: async () => (await api.get('/cart')).data.cart, enabled: Boolean(user) })
  const quantity = cart.data?.items.find((item) => item.productId === product._id)?.quantity || 0
  const add = useMutation({ mutationFn: () => api.post('/cart/items', { productId: product._id, quantity: 1 }),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['cart'] }); toast.success('Added to cart') },
  })
  const update = useMutation({ mutationFn: (next) => next === 0 ? api.delete(`/cart/items/${product._id}`) : api.patch(`/cart/items/${product._id}`, { quantity: next }), onSuccess: () => client.invalidateQueries({ queryKey: ['cart'] }) })
  const available = product.stock - (product.reservedStock || 0)
  return <article className="product-card">
    <Link to={`/products/${product._id}`} className="product-image" aria-label={product.name}>
      {product.images?.[0] ? <img src={product.images[0]} alt={product.name} loading="lazy" /> : <div className="image-placeholder"><Leaf size={38} /><span>No image</span></div>}
    </Link>
    <div className="product-card-body"><Link to={`/products/${product._id}`} className="product-name">{product.name}</Link><p className="product-unit">{unitLabel(product.attributes)}</p>
      {available > 0 && available <= 3 && <Badge status="warning">Only {available} left</Badge>}
      {available < 1 && <Badge status="error">Out of stock</Badge>}
      <div className="product-card-actions"><strong className="price">{money(product.price)}</strong>{quantity > 0 ? <div className="stepper"><button aria-label={`Decrease ${product.name}`} title="Decrease quantity" disabled={update.isPending || add.isPending} onClick={() => update.mutate(quantity - 1)}><Minus size={16} /></button><output aria-label={`${product.name} quantity`}>{quantity}</output><button aria-label={`Increase ${product.name}`} title="Increase quantity" disabled={update.isPending || add.isPending || quantity >= available} onClick={() => update.mutate(quantity + 1)}><Plus size={16} /></button></div> : <button className="icon-btn add-button" title="Add to cart" aria-label={`Add ${product.name} to cart`} disabled={add.isPending || available < 1} onClick={() => user ? add.mutate() : navigate('/login', { state: { from: '/shop' } })}><Plus size={18} /></button>}</div>
    </div>
  </article>
}

export function Pagination({ pagination, onPage }) {
  if (!pagination || pagination.pages <= 1) return null
  return <nav className="flex justify-center items-center gap-4 py-8" aria-label="Pagination">
    <button className="icon-btn" title="Previous page" aria-label="Previous page" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}><ArrowLeft size={18} /></button>
    <span className="text-sm">Page {pagination.page} of {pagination.pages}</span>
    <button className="icon-btn" title="Next page" aria-label="Next page" disabled={pagination.page >= pagination.pages} onClick={() => onPage(pagination.page + 1)}><ArrowRight size={18} /></button>
  </nav>
}

export function Field({ label, ...props }) {
  return <Input label={label} {...props} />
}

export function QuantityStepper({ value, onChange, maximum = 999, disabled, name = 'product' }) {
  return <div className="stepper"><button aria-label={`Decrease ${name}`} title="Decrease quantity" disabled={disabled || value <= 1} onClick={() => onChange(value - 1)}><Minus size={16} /></button><output aria-live="polite" aria-label={`${name} quantity`}>{value}</output><button aria-label={`Increase ${name}`} title="Increase quantity" disabled={disabled || value >= maximum} onClick={() => onChange(value + 1)}><Plus size={16} /></button></div>
}

export function Totals({ subtotal, fee = 0 }) {
  return <dl className="totals"><div><dt>Subtotal</dt><dd>{money(subtotal)}</dd></div><div><dt>Delivery fee</dt><dd>{fee === 0 ? 'Free' : money(fee)}</dd></div><div className="total-line"><dt>Total</dt><dd className="price">{money(subtotal + fee)}</dd></div></dl>
}

export function ProductSkeletons({ count = 4 }) {
  return <div role="status" aria-label="Loading products" className="product-grid">{Array.from({ length: count }, (_, index) => <article className="product-card" key={index}><Skeleton className="aspect-square" /><div className="p-4 space-y-4"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/3" /><Skeleton className="h-10" /></div></article>)}</div>
}

export function FormError({ error }) { return error ? <p className="field-error" role="alert">{errorMessage(error)}</p> : null }
export function ConfirmAction({ title, onCancel, onConfirm, pending }) { return <div className="state"><h3>{title}</h3><div className="flex gap-4"><Button variant="ghost" onClick={onCancel}>Keep items</Button><Button variant="accent" loading={pending} onClick={onConfirm}>Confirm</Button></div></div> }