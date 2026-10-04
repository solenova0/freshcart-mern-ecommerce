import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Apple, ArrowRight, Coffee, Flame, Leaf, Milk, Package, Search } from 'lucide-react'
import { Badge, Button, EmptyState, Select } from '@freshcart/design-system'
import toast from 'react-hot-toast'
import { api } from '../lib/api.js'
import { money, useAuth } from '../lib/auth.js'
import { unitLabel } from '../lib/shopping.js'
import { Pagination, ProductCard, ProductSkeletons, QuantityStepper, QueryState } from '../components/ui.jsx'

export function Home() {
  const categories = useQuery({ queryKey: ['categories'], queryFn: async () => (await api.get('/categories')).data.categories })
  const newest = useQuery({ queryKey: ['new-arrivals'], queryFn: async () => (await api.get('/products', { params: { limit: 4, sort: 'newest' } })).data })
  const best = useQuery({ queryKey: ['best-sellers'], queryFn: async () => (await api.get('/products/best-sellers')).data })
  return <><section className="home-hero"><img src="/produce.jpg" alt="Fresh seasonal produce at the market" /><div className="hero-copy"><p className="eyebrow">FRESH FINDS, EVERY DAY</p><h1>FreshCart</h1><p>Your everyday essentials.<br />A little fresher, a little easier.</p><Link to="/shop" className="btn accent">Shop the market<ArrowRight size={18} /></Link></div></section>
    <section className="page section-band"><div className="section-title"><h2>Shop by category</h2><Link to="/shop" className="text-link">Explore all<ArrowRight size={16} /></Link></div><QueryState query={categories} empty={categories.data?.length === 0} message="New categories are coming soon." /><div className="category-tiles">{categories.data?.map((category, index) => {
      const hookah = /hookah/i.test(category.slug)
      const icons = [Apple, Milk, Coffee, Package]
      const Icon = hookah ? Flame : icons[index % icons.length]
      return <Link key={category._id} to={hookah ? `/hookah?category=${category._id}` : `/shop?category=${category._id}`} className="category-tile"><Icon size={28} /><span>{category.name}</span><ArrowRight size={16} /></Link>
    })}</div></section>
    {[['Best sellers', best, 'Customer favorites will appear after the first paid orders.'], ['New arrivals', newest, 'The shelves are being stocked.']].map(([title, query, message]) => <section className="page section-band" key={title}><div className="section-title"><div><p className="eyebrow">PICKED FOR YOUR EVERYDAY</p><h2>{title}</h2></div><Link to="/shop" className="text-link">View all<ArrowRight size={16} /></Link></div>{query.isPending ? <ProductSkeletons /> : <><QueryState query={query} empty={query.data?.products.length === 0} message={message} /><div className="product-grid">{query.data?.products.map((product) => <ProductCard key={product._id} product={product} />)}</div></>}</section>)}
    <section className="benefits"><div className="page"><p><Leaf size={22} />Fresh everyday essentials</p><p><Package size={22} />Carefully stocked shelves</p><p><Flame size={22} />Accessories for adults 18+</p></div></section></>
}

export function Shop({ hookah = false }) {
  const [params, setParams] = useSearchParams()
  const filters = { search: params.get('search') || undefined, category: params.get('category') || undefined, productType: hookah ? 'hookah' : params.get('productType') || undefined, sort: params.get('sort') || 'newest', page: params.get('page') || '1', limit: '12' }
  const categories = useQuery({ queryKey: ['categories'], queryFn: async () => (await api.get('/categories')).data.categories })
  const products = useQuery({ queryKey: ['products', filters], queryFn: async () => (await api.get('/products', { params: filters })).data })
  function change(key, value) { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); next.delete('page'); setParams(next) }
  return <div className="page section-band"><p className="eyebrow">{hookah ? 'THE ADULT COLLECTION' : 'FRESH FINDS, ALL IN ONE PLACE'}</p><h1 className="page-heading">{hookah ? 'Hookah essentials' : 'The market'}</h1><div className="shop-controls"><form className="search-box" onSubmit={(event) => { event.preventDefault(); change('search', String(new FormData(event.currentTarget).get('search')).trim()) }}><Search size={20} /><input key={filters.search || ''} name="search" defaultValue={filters.search} placeholder="Search the market" aria-label="Search products" maxLength={200} /><button type="submit" className="icon-btn" title="Search" aria-label="Search"><ArrowRight size={18} /></button></form><Select label="Sort" aria-label="Sort products" value={filters.sort} onChange={(event) => change('sort', event.target.value)}><option value="newest">Newest arrivals</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option>{filters.search && <option value="relevance">Best match</option>}</Select></div>
    <nav className="category-chips" aria-label="Category filters"><button className={`chip ${!filters.category ? 'active' : ''}`} aria-pressed={!filters.category} onClick={() => change('category', '')}>All categories</button>{categories.data?.map((category) => <Link key={category._id} to={/hookah/i.test(category.slug) ? `/hookah?category=${category._id}` : `/shop?category=${category._id}`} className={`chip ${filters.category === category._id ? 'active' : ''}`} aria-current={filters.category === category._id ? 'page' : undefined}>{category.name}</Link>)}</nav><QueryState query={categories} />
    <div className="listing-meta"><p>{products.data ? `${products.data.pagination.total} products` : 'Finding fresh picks...'}</p><Button variant="ghost" onClick={() => setParams({})}>Clear filters</Button></div>
    {products.isPending ? <ProductSkeletons count={8} /> : products.data?.products.length === 0 ? <EmptyState title="No matches, just yet" message="Try a different search or explore another category." action={<Button onClick={() => setParams({})}>Explore all products</Button>} /> : <><QueryState query={products} /><div className="product-grid">{products.data?.products.map((product) => <ProductCard key={product._id} product={product} />)}</div></>}
    <Pagination pagination={products.data?.pagination} onPage={(page) => { const next = new URLSearchParams(params); next.set('page', String(page)); setParams(next); window.scrollTo({ top: 0 }) }} /></div>
}

export function ProductDetail() {
  const { id } = useParams()
  const auth = useAuth()
  const navigate = useNavigate()
  const client = useQueryClient()
  const [quantity, setQuantity] = useState(1)
  const [selected, setSelected] = useState(0)
  const query = useQuery({ queryKey: ['product', id], queryFn: async () => (await api.get(`/products/${id}`)).data.product })
  const add = useMutation({ mutationFn: () => api.post('/cart/items', { productId: id, quantity }), onSuccess: () => { client.invalidateQueries({ queryKey: ['cart'] }); toast.success('Added to cart') } })
  const product = query.data
  if (!product) return <div className="page section-band"><QueryState query={query} /></div>
  const available = Math.max(0, product.stock - (product.reservedStock || 0))
  return <div className="page section-band"><Link to={product.productType === 'hookah' ? '/hookah' : '/shop'} className="text-link">Back to the market</Link><div className="product-detail"><div><div className="detail-image">{product.images[0] ? <img src={product.images[selected] || product.images[0]} alt={product.name} /> : <EmptyState title="No image available" />}</div><div className="gallery">{product.images.map((image, index) => <button key={image} className={selected === index ? 'active' : ''} aria-label={`View image ${index + 1} of ${product.name}`} aria-pressed={selected === index} onClick={() => setSelected(index)}><img src={image} alt={`${product.name}, view ${index + 1}`} /></button>)}</div></div><section><p className="eyebrow">{product.category?.name || product.productType}</p><h1 className="page-heading">{product.name}</h1><p className="muted mt-4">{unitLabel(product.attributes)}</p><p className="price detail-price">{money(product.price)}</p><Badge status={available === 0 ? 'error' : available <= 3 ? 'warning' : 'success'}>{available === 0 ? 'Out of stock' : available <= 3 ? `Only ${available} left` : 'In stock'}</Badge><p className="description">{product.description || 'An everyday essential for your next market run.'}</p><div className="detail-actions"><QuantityStepper name={product.name} value={quantity} onChange={setQuantity} maximum={Math.min(available, 999)} disabled={available === 0} /><Button variant="accent" loading={add.isPending} disabled={available === 0 || quantity > available} onClick={() => auth.user ? add.mutate() : navigate('/login', { state: { from: `/products/${id}` } })}>Add to cart<PlusIcon /></Button></div>{product.productType === 'hookah' && <p className="muted mt-4">18+ only. Your account must also be age-confirmed.</p>}<h2 className="mt-8 mb-4">Product details</h2><dl className="attributes">{Object.entries(product.attributes || {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd></div>)}</dl></section></div></div>
}

function PlusIcon() { return <ArrowRight size={18} aria-hidden="true" /> }