import { Link, NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { createElement, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { LayoutDashboard, ShoppingBag, Folder, Package, LogOut, Menu, Leaf, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Badge, Button } from '@freshcart/design-system'
import { useAuth } from './lib/auth.js'
import { Modal } from './components/ui.jsx'
import { Dashboard, Login } from './pages/Overview.jsx'
import Orders from './pages/Orders.jsx'
import { CatalogManagement } from './pages/Management.jsx'

function Navigation({ onNavigate }) {
  return <nav aria-label="Administration" className="sidebar-nav">{[['/', 'Dashboard', LayoutDashboard], ['/orders', 'Orders', ShoppingBag], ['/categories', 'Categories', Folder], ['/products', 'Products', Package]].map(([path, label, icon]) => <NavLink key={path} to={path} end={path === '/'} title={label} aria-label={label} onClick={onNavigate}>{createElement(icon, { size: 20 })}<span>{label}</span></NavLink>)}</nav>
}

function AdminLayout() {
  const auth = useAuth()
  const [menu, setMenu] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const logout = useMutation({ mutationFn: auth.signOut })
  if (auth.loading) return <div className="empty-state">Checking account...</div>
  if (auth.error && ![401, 403].includes(auth.error.response?.status)) return <div role="alert" className="empty-state"><p>Cannot reach your account.</p><button className="btn" onClick={auth.refresh}>Retry</button></div>
  if (!auth.user) return <Navigate to="/login" replace />
  if (auth.user.role !== 'admin') return <div className="empty-state"><h1>Administrator access required</h1><button className="btn" onClick={() => logout.mutate()}>Sign out</button></div>
  return <div className={`admin-layout ${collapsed ? 'collapsed' : ''}`}><a href="#admin-main" className="skip-link">Skip to content</a><aside className="admin-sidebar"><Link to="/" className="sidebar-brand" aria-label="FreshCart Admin"><Leaf size={28} /><span>FreshCart<small>ADMIN</small></span></Link><button className="sidebar-collapse" title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}</button><Navigation /><div className="sidebar-bottom"><p>{auth.user.name}</p><span>{auth.user.email}</span></div></aside><div className="admin-content"><header className="admin-topbar"><button className="icon-btn mobile-menu" title="Open navigation" aria-label="Open navigation" onClick={() => setMenu(true)}><Menu size={20} /></button><span className="topbar-title">Store operations</span><div className="topbar-account"><span>{auth.user.name}</span><Badge>Admin</Badge><button className="icon-btn" title="Sign out" aria-label="Sign out" disabled={logout.isPending} onClick={() => logout.mutate()}><LogOut size={20} /></button></div></header><main id="admin-main" tabIndex={-1} className="admin-main"><Outlet /></main></div>{menu && <Modal title="Navigation" onClose={() => setMenu(false)}><Navigation onNavigate={() => setMenu(false)} /><Button variant="ghost" className="mt-6" onClick={() => logout.mutate()}>Sign out</Button></Modal>}</div>
}

export default function Admin() {
  return <Routes><Route path="/login" element={<Login />} /><Route element={<AdminLayout />}><Route path="/" element={<Dashboard />} /><Route path="/orders" element={<Orders />} /><Route path="/categories" element={<CatalogManagement resource="categories" />} /><Route path="/products" element={<CatalogManagement />} /><Route path="*" element={<div><h1>Page not found</h1><Link to="/">Back to dashboard</Link></div>} /></Route></Routes>
}