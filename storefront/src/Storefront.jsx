import { Link, NavLink, Route, Routes, useLocation, useMatch, useNavigate, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { ShoppingBasket, Leaf, LogOut, Search, UserRound, Home as HomeIcon, Grid2X2, Package, ArrowRight, Flame } from 'lucide-react'
import { Button, Drawer, Modal } from '@freshcart/design-system'
import { api } from './lib/api.js'
import { useAuth } from './lib/auth.js'
import { ProtectedRoute } from './components/ui.jsx'
import { AuthPage, VerifyEmail } from './pages/Account.jsx'
import { Checkout, Orders } from './pages/Commerce.jsx'
import { Home, ProductDetail, Shop } from './pages/Catalog.jsx'
import CartContents from './components/CartContents.jsx'
import { ShoppingContext, hasConfirmedAge, rememberAge } from './lib/shopping.js'

export default function Storefront() {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const match = useMatch('/products/:id')
  const [cartOpen, setCartOpen] = useState(false)
  const [ageConfirmed, setAgeConfirmed] = useState(hasConfirmedAge)
  const categories = useQuery({ queryKey: ['categories'], queryFn: async () => (await api.get('/categories')).data.categories })
  const detail = useQuery({ queryKey: ['product', match?.params.id], queryFn: async () => (await api.get(`/products/${match.params.id}`)).data.product, enabled: Boolean(match) })
  const selectedCategory = categories.data?.find((category) => category._id === params.get('category'))
  const hookah = location.pathname.startsWith('/hookah') || params.get('productType') === 'hookah' || /hookah/i.test(selectedCategory?.slug || '') || detail.data?.productType === 'hookah' && Boolean(match)
  const cart = useQuery({ queryKey: ['cart'], queryFn: async () => (await api.get('/cart')).data.cart, enabled: Boolean(auth.user) })
  const logout = useMutation({ mutationFn: auth.signOut })
  const theme = hookah ? 'hookah' : 'fresh'
  function leaveHookah() { navigate('/'); }
  return <ShoppingContext value={{ openCart: () => setCartOpen(true), theme }}><div className="storefront-shell" data-theme={theme}><a href="#main-content" className="skip-link">Skip to content</a><div className="top-strip">Fresh finds, delivered to your everyday.</div><header className="site-header"><nav className="page header-inner" aria-label="Main"><Link className="brand" to="/"><Leaf size={28} />FreshCart<span>.</span></Link><form className="header-search search-box" onSubmit={(event) => { event.preventDefault(); const search = String(new FormData(event.currentTarget).get('search')).trim(); navigate(`/shop${search ? `?search=${encodeURIComponent(search)}` : ''}`) }}><Search size={20} /><input name="search" placeholder="Search groceries and essentials" aria-label="Search the store" maxLength={200} /><button type="submit" className="icon-btn" title="Search" aria-label="Search the store"><ArrowRight size={18} /></button></form><div className="account-nav"><Link to={auth.user ? '/orders' : '/login'} className="icon-btn" title="Account" aria-label="Account"><UserRound size={21} /></Link><button className="basket-link icon-btn" title="Open basket" aria-label="Open cart" onClick={() => setCartOpen(true)}><ShoppingBasket size={22} /><span aria-label="Cart item count">{cart.data?.items.reduce((total, item) => total + item.quantity, 0) || 0}</span></button>{auth.user && <button className="icon-btn" title="Sign out" aria-label="Sign out" disabled={logout.isPending} onClick={() => logout.mutate()}><LogOut size={18} /></button>}</div></nav><nav className="desktop-nav page" aria-label="Shop navigation"><NavLink to="/" end>Home</NavLink><NavLink to="/shop">Shop all</NavLink><NavLink to="/hookah"><Flame size={16} />Hookah 18+</NavLink><NavLink to="/orders">My orders</NavLink><span className="muted">Good things for your everyday.</span></nav></header>
    <main id="main-content" tabIndex={-1}>{hookah && !ageConfirmed ? <div className="state">Age confirmation required.</div> : <Routes><Route path="/" element={<Home />} /><Route path="/shop" element={<Shop />} /><Route path="/hookah" element={<Shop hookah />} /><Route path="/products/:id" element={<ProductDetail />} /><Route path="/login" element={<AuthPage />} /><Route path="/register" element={<AuthPage register />} /><Route path="/verify-email" element={<VerifyEmail />} /><Route element={<ProtectedRoute />}><Route path="/cart" element={<div className="page section-band"><h1 className="page-heading mb-8">Your basket</h1><CartContents /></div>} /><Route path="/checkout" element={<Checkout />} /><Route path="/orders" element={<Orders />} /></Route><Route path="*" element={<div className="page section-band"><h1 className="page-heading">Page not found</h1><Link to="/" className="text-link">Back to FreshCart</Link></div>} /></Routes>}</main>
    <footer className="site-footer"><div className="page footer-grid"><div><Link to="/" className="brand"><Leaf size={24} />FreshCart.</Link><p className="muted mt-4">A fresher kind of everyday.</p></div><nav aria-label="Footer"><Link to="/shop">Shop the market</Link><Link to="/cart">Your basket</Link><Link to="/orders">Track your orders</Link><Link to="/login">Your account</Link></nav><p className="muted">© {new Date().getFullYear()} FreshCart<br />Everyday essentials, thoughtfully selected.</p></div></footer>
    <nav className="bottom-nav" aria-label="Mobile navigation"><NavLink to="/" end><HomeIcon size={21} />Home</NavLink><NavLink to="/shop"><Grid2X2 size={21} />Categories</NavLink><button aria-label="Open cart" onClick={() => setCartOpen(true)}><ShoppingBasket size={21} />Cart</button><NavLink to="/orders"><Package size={21} />Orders</NavLink><NavLink to={auth.user ? '/orders' : '/login'}><UserRound size={21} />Account</NavLink></nav>
    {cartOpen && <Drawer title="Your basket" theme={theme} onClose={() => setCartOpen(false)}><CartContents compact onNavigate={() => setCartOpen(false)} /></Drawer>}
    {hookah && !ageConfirmed && <Modal title="Adults only · 18+" theme="hookah" onClose={leaveHookah}><Flame size={40} className="mb-6" /><p className="mb-8">Please confirm that you are 18 or older before exploring the hookah collection.</p><div className="flex flex-wrap gap-4"><Button variant="accent" onClick={() => { rememberAge(); setAgeConfirmed(true) }}>I am 18 or older</Button><Button variant="ghost" onClick={leaveHookah}>No, take me home</Button></div></Modal>}
  </div></ShoppingContext>
}