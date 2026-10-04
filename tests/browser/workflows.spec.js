import { test, expect } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'

async function fixtures(page, { admin = false } = {}) {
  let signedIn = false
  let cart = []
  const calls = []
  const category = { _id: 'a'.repeat(24), name: 'Groceries', slug: 'groceries', description: 'Fresh everyday staples' }
  const hookahCategory = { _id: '9'.repeat(24), name: 'Hookah Accessories', slug: 'hookah-accessories', description: 'Adults only' }
  const products = ['Apples', 'Bananas', 'Tomatoes', 'Rice', 'Carrots', 'Milk', 'Eggs', 'Bread', 'Potatoes', 'Oranges', 'Avocados', 'Lemons', 'Green Apples'].map((name, index) => ({
    _id: String(index + 1).padStart(24, '0'), name,
    description: 'Fresh market essentials, carefully selected for your everyday basket.',
    price: [2.5, 1.8, 2.1, 5.5][index % 4], stock: 50, reservedStock: 0,
    images: [`http://localhost:5273/${['apples.jpg', 'bananas.jpg', 'tomatoes.jpg', 'produce.jpg'][index % 4]}`],
    category, productType: 'grocery', attributes: { unit: 'kg', origin: 'ET' },
  }))
  products[1].stock = 3
  products[2].stock = 0
  products.push({ ...products[0], _id: '8'.repeat(24), name: 'Ceramic Bowl', productType: 'hookah', category: hookahCategory, images: [], stock: 3, attributes: { material: 'ceramic' } })
  const address = { fullName: 'Alex Morgan', phone: '555123456', line1: '12 Market Road', line2: '', city: 'Addis Ababa', state: '', postalCode: '', country: 'ET' }
  const user = { id: 'c'.repeat(24), name: admin ? 'Demo Administrator' : 'Alex Morgan', email: admin ? 'admin@freshcart.test' : 'alex@example.com', role: admin ? 'admin' : 'user', isVerified: true, ageConfirmed: true, address }
  const orders = [{ _id: 'b'.repeat(24), createdAt: '2026-10-02T10:00:00Z', user: user.id, address, total: 24.5, paymentMethod: 'cod', paymentStatus: 'pending', orderStatus: 'pending', items: [{ product: products[0]._id, name: 'Apples', price: 2.5, quantity: 2, productType: 'grocery' }] }]
  const categories = [category, hookahCategory]
  await page.route('http://localhost:5000/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.slice(4)
    const method = request.method()
    const headers = {
      'access-control-allow-origin': request.headers().origin || 'http://localhost:5273',
      'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    }
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const body = request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() || {} : {}
    calls.push({ path, method, body, contentType: request.headers()['content-type'] })
    let data = {}
    let status = 200
    if (path === '/auth/me') { if (signedIn) data = { user }; else { status = 401; data = { error: { message: 'Authentication required' } } } }
    else if (path === '/auth/login') { signedIn = true; data = { user } }
    else if (path === '/auth/logout') { signedIn = false; status = 204 }
    else if (path === '/auth/register' || path === '/auth/resend-verification') { status = 202; data = { message: 'Check your email' } }
    else if (path === '/auth/verify-email') { if (url.searchParams.get('token') === 'b'.repeat(64)) { status = 400; data = { error: { message: 'Invalid or expired verification link' } } } else data = { message: 'Email verified' } }
    else if (path === '/categories') {
      if (method === 'POST') { const created = { ...category, ...body, _id: 'd'.repeat(24) }; categories.push(created); status = 201; data = { category: created } }
      else data = { categories }
    }
    else if (path.startsWith('/categories/')) {
      const current = categories.find((item) => item._id === path.split('/')[2])
      if (method === 'DELETE') { categories.splice(categories.indexOf(current), 1); status = 204 }
      else { Object.assign(current, body); data = { category: current } }
    }
    else if (path === '/products' && method === 'GET') {
      const search = url.searchParams.get('search')
      let items = products.filter((item) => !search || item.name.toLowerCase().includes(search.toLowerCase()))
      if (url.searchParams.get('productType')) items = items.filter((item) => item.productType === url.searchParams.get('productType'))
      if (url.searchParams.get('category')) items = items.filter((item) => item.category._id === url.searchParams.get('category'))
      if (url.searchParams.get('sort') === 'price_asc') items = [...items].sort((first, second) => first.price - second.price)
      const limit = Number(url.searchParams.get('limit') || 20)
      const current = Number(url.searchParams.get('page') || 1)
      data = { products: items.slice((current - 1) * limit, current * limit), pagination: { page: current, limit, total: items.length, pages: Math.ceil(items.length / limit) } }
    }
    else if (path === '/products/best-sellers') data = { products: products.slice(0, 4) }
    else if (path === '/products' && method === 'POST') { const created = { ...products[0], ...body, _id: 'e'.repeat(24), category }; products.push(created); status = 201; data = { product: created } }
    else if (path.endsWith('/images')) data = { product: products.find((item) => item._id === path.split('/')[2]), cleanupFailed: false }
    else if (path.startsWith('/products/')) { const current = products.find((item) => item._id === path.split('/')[2]); if (method === 'DELETE') { products.splice(products.indexOf(current), 1); status = 204 } else { Object.assign(current, body); data = { product: current } } }
    else if (path.startsWith('/cart')) {
      if (method === 'POST') { const current = cart.find((item) => item.productId === body.productId); if (current) current.quantity += body.quantity; else cart.push({ productId: body.productId, quantity: body.quantity }) }
      if (method === 'PATCH') cart.find((item) => item.productId === path.split('/')[3]).quantity = body.quantity
      if (method === 'DELETE') cart = path === '/cart' ? [] : cart.filter((item) => item.productId !== path.split('/')[3])
      data = { cart: { id: 'cart', items: cart.map((item) => ({ ...item, product: products.find((product) => product._id === item.productId), lineTotal: products.find((product) => product._id === item.productId).price * item.quantity, available: true })), total: cart.reduce((total, item) => total + products.find((product) => product._id === item.productId).price * item.quantity, 0) } }
    }
    else if (path === '/users/me/address') { expect(body).not.toHaveProperty('payment-choice'); data = { address: body } }
    else if (path === '/orders' && method === 'POST') {
      const created = { ...orders[0], _id: 'f'.repeat(24), address: body.address, paymentMethod: body.paymentMethod, total: cart.reduce((total, item) => total + products.find((product) => product._id === item.productId).price * item.quantity, 0), items: cart.map((item) => ({ ...products.find((product) => product._id === item.productId), quantity: item.quantity, product: item.productId })) }
      orders.unshift(created); cart = []; status = 201; data = { order: created }
    }
    else if (path === '/orders/admin/stats') data = { stats: { orders: 128, ordersToday: 8, revenue: 4268.5, pending: 12, lowStock: 3 } }
    else if (path === '/orders/admin' || path === '/orders/history') { const items = url.searchParams.get('orderStatus') ? orders.filter((order) => order.orderStatus === url.searchParams.get('orderStatus')) : orders; data = { orders: items, pagination: { page: 1, limit: 15, total: items.length, pages: 1 } } }
    else if (path.endsWith('/status')) { const order = orders.find((item) => item._id === path.split('/')[3]); order.orderStatus = body.orderStatus; data = { order } }
    else if (path.endsWith('/checkout-session')) { status = 503; data = { error: { message: 'Card payments unavailable in browser fixture' } } }
    else if (path.endsWith('/cancel-payment')) { const order = orders.find((item) => item._id === path.split('/')[2]); order.orderStatus = 'cancelled'; order.paymentStatus = 'failed'; data = { order } }
    else { status = 404; data = { error: { message: `Unmocked route ${path}` } } }
    await route.fulfill({ status, headers, contentType: 'application/json', body: status === 204 ? undefined : JSON.stringify(data) })
  })
  return { products, calls }
}

async function login(page, admin = false) {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://localhost:${admin ? 5274 : 5273}/login`)
  try { await page.getByLabel('Email', { exact: true }).waitFor({ timeout: 10000 }) } catch (error) { throw new Error(`Login: ${errors.join('; ') || error.message}`) }
  await page.getByLabel('Email', { exact: true }).fill(admin ? 'admin@freshcart.test' : 'alex@example.com')
  await page.getByLabel('Password', { exact: true }).fill('FreshCartDemo!2026')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(admin ? 'http://localhost:5274/' : 'http://localhost:5273/shop')
}

test('storefront home/shop pagination, product details, login, cart and COD checkout', async ({ page }) => {
  await mkdir('docs/screenshots', { recursive: true })
  const state = await fixtures(page)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://localhost:5273/')
  await expect(page.getByRole('link', { name: 'Apples', exact: true }).first()).toBeVisible()
  await page.locator('img').first().evaluate((image) => image.decode())
  await page.screenshot({ path: 'docs/screenshots/storefront-home.png', fullPage: true })
  await page.goto('http://localhost:5273/shop')
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Green Apples', exact: true }).first()).toBeVisible()
  await page.goto(`http://localhost:5273/products/${state.products[0]._id}`)
  await expect(page.getByRole('heading', { name: 'Apples', exact: true })).toBeVisible()
  await login(page)
  await page.getByRole('button', { name: 'Add Apples to cart', exact: true }).click()
  await expect(page.getByText('Added to cart', { exact: true })).toBeVisible()
  await page.goto('http://localhost:5273/cart')
  await page.getByRole('link', { name: 'Checkout', exact: true }).click()
  await page.getByRole('button', { name: 'Place order', exact: true }).click()
  await expect(page).toHaveURL('http://localhost:5273/orders')
  await expect(page.getByText('Order #FFFFFFFF', { exact: true })).toBeVisible()
  expect(state.calls.find((call) => call.path === '/orders' && call.method === 'POST').body.paymentMethod).toBe('cod')
  await page.goto('http://localhost:5273/shop')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('link', { name: 'Apples', exact: true }).first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.screenshot({ path: 'docs/screenshots/storefront-mobile.png', fullPage: true })
  expect(errors).toEqual([])
})

test('registration, verification, protected routes, and Stripe retry/cancel controls', async ({ page }) => {
  const state = await fixtures(page)
  await page.goto('http://localhost:5273/cart')
  await expect(page).toHaveURL('http://localhost:5273/login')
  await page.goto('http://localhost:5273/register')
  await page.getByLabel('Name', { exact: true }).fill('New Customer')
  await page.getByLabel('Email', { exact: true }).fill('new@example.com')
  await page.getByLabel('Password', { exact: true }).fill('password123')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page).toHaveURL(/verify-email\?email=/)
  await page.goto(`http://localhost:5273/verify-email?token=${'a'.repeat(64)}`)
  await page.getByRole('button', { name: 'Confirm email address', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'You’re verified.' })).toBeVisible()
  await login(page)
  await page.getByRole('button', { name: 'Add Apples to cart', exact: true }).click()
  await page.goto('http://localhost:5273/checkout')
  await page.getByRole('radio', { name: 'Card with Stripe' }).check()
  await page.getByRole('button', { name: 'Continue to Stripe', exact: true }).click()
  await expect(page).toHaveURL('http://localhost:5273/orders')
  await page.getByRole('button', { name: 'Cancel payment', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click()
  await expect(page.getByText('cancelled', { exact: true }).first()).toBeVisible()
  expect(state.calls.some((call) => call.path.endsWith('/checkout-session'))).toBe(true)
})

test('admin dashboard, status update/detail drawer, CRUD forms, previews, and mobile navigation', async ({ page }) => {
  const state = await fixtures(page, { admin: true })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await login(page, true)
  await expect(page.getByText('$4,268.50', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'docs/screenshots/admin-dashboard.png', fullPage: true })
  await page.getByRole('link', { name: 'Orders', exact: true }).click()
  await page.getByRole('button', { name: 'View order bbbbbbbb' }).click()
  await page.getByLabel('Status for order bbbbbbbb').selectOption('confirmed')
  await expect(page.getByLabel('Status for order bbbbbbbb')).toHaveValue('confirmed')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').getByText('Delivery address', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'docs/screenshots/admin-orders.png', fullPage: true })
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('link', { name: 'Categories', exact: true }).click()
  await page.getByRole('button', { name: 'New category', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill('Pantry')
  await page.getByLabel('Slug', { exact: true }).fill('pantry')
  await page.getByRole('button', { name: 'Save category', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'Pantry', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Delete Pantry', exact: true }).click()
  await page.getByRole('button', { name: 'Keep record', exact: true }).click()
  await page.getByRole('link', { name: 'Products', exact: true }).click()
  await page.getByRole('button', { name: 'Edit Apples', exact: true }).click()
  await page.getByLabel('Price (USD)').fill('3.25')
  const dropped = await page.evaluateHandle(() => { const data = new DataTransfer(); const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXMsAAAAASUVORK5CYII='), (letter) => letter.charCodeAt(0)); data.items.add(new File([bytes], 'dropped.png', { type: 'image/png' })); return data })
  await page.locator('.dropzone').dispatchEvent('drop', { dataTransfer: dropped })
  await expect(page.getByAltText('dropped.png', { exact: true })).toBeVisible()
  await page.locator('input[type=file]').setInputFiles(['storefront/public/apples.jpg', 'storefront/public/bananas.jpg'])
  await expect(page.getByAltText('apples.jpg', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Set bananas.jpg as primary' }).click()
  await expect(page.getByRole('button', { name: 'Set bananas.jpg as primary' })).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({ path: 'docs/screenshots/admin-products.png', fullPage: true })
  await page.getByRole('button', { name: 'Save product', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(state.calls.some((call) => call.path.endsWith('/images') && call.contentType.includes('multipart/form-data'))).toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await page.getByRole('dialog').getByRole('link', { name: 'Dashboard', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  expect(errors).toEqual([])
})

test('admin login refuses a customer role', async ({ page }) => {
  await fixtures(page)
  await page.goto('http://localhost:5274/login')
  await page.getByLabel('Email', { exact: true }).fill('alex@example.com')
  await page.getByLabel('Password', { exact: true }).fill('password123')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('alert').getByText('Administrator access required', { exact: true })).toBeVisible()
  await expect(page).toHaveURL('http://localhost:5274/login')
})

test('cart drawer, in-place stepper, inline errors, password visibility and age-gate lifecycle', async ({ page }) => {
  await fixtures(page)
  await page.goto('http://localhost:5273/login')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await page.getByRole('button', { name: 'Show password' }).click()
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text')
  await login(page)
  await page.getByRole('button', { name: 'Add Apples to cart', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Increase Apples', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Increase Apples', exact: true }).click()
  await expect(page.getByLabel('Apples quantity', { exact: true })).toHaveText('2')
  await page.getByRole('button', { name: 'Open cart', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Delivery fee', { exact: true })).toBeVisible()
  const drawerAudit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(drawerAudit.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.target) }))).toEqual([])
  for (let index = 0; index < 12; index += 1) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => document.querySelector('dialog[open]').contains(document.activeElement))).toBe(true) }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open cart', exact: true }).first()).toBeFocused()
  await page.goto('http://localhost:5273/hookah')
  await expect(page.getByRole('dialog')).toBeVisible()
  const gateAudit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(gateAudit.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.target) }))).toEqual([])
  await page.getByRole('button', { name: 'No, take me home' }).click()
  await expect(page).toHaveURL('http://localhost:5273/')
  await page.goto('http://localhost:5273/hookah')
  await page.getByRole('button', { name: 'I am 18 or older' }).click()
  await expect(page.getByRole('heading', { name: 'Hookah essentials' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('freshcart-age-confirmed'))).toBe('true')
  await page.reload()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto(`http://localhost:5273/verify-email?token=${'b'.repeat(64)}`)
  await page.getByRole('button', { name: 'Confirm email address' }).click()
  await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resend verification email' })).toBeVisible()
})

test('age gate handles unavailable localStorage without crashing', async ({ page }) => {
  await fixtures(page)
  await page.addInitScript(() => { Storage.prototype.getItem = () => { throw new Error('Blocked') }; Storage.prototype.setItem = () => { throw new Error('Blocked') } })
  await page.goto('http://localhost:5273/hookah')
  await page.getByRole('button', { name: 'I am 18 or older' }).click()
  await expect(page.getByRole('heading', { name: 'Hookah essentials' })).toBeVisible()
})

test('shared contrast tokens meet text and focus/input boundary thresholds', async () => {
  const css = await readFile('packages/design-system/theme.css', 'utf8')
  expect(css).toContain('--focus-ring: #C9A227')
  expect(css).toContain('border: 1px solid #8C837C')
  function luminance(hex) {
    const channels = hex.match(/[a-f0-9]{2}/gi).map((value) => parseInt(value, 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  }
  for (const [foreground, background, minimum] of [['15803D', 'FFFFFF', 4.5], ['1C1917', 'F97316', 4.5], ['6B625D', 'FAFAF7', 4.5], ['C9A227', '39264A', 4.5], ['8C837C', 'FFFFFF', 3], ['6D28D9', 'EDE9FE', 4.5], ['F97316', '0F2A1A', 3]]) {
    const first = luminance(foreground), second = luminance(background)
    expect((Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)).toBeGreaterThanOrEqual(minimum)
  }
})

for (const width of [360, 768, 1280]) {
  test(`storefront accessibility and responsive geometry at ${width}px`, async ({ page }) => {
    await fixtures(page)
    await page.setViewportSize({ width, height: 900 })
    await login(page)
    const card = page.locator('.product-card').filter({ has: page.getByRole('link', { name: 'Apples', exact: true }) })
    const before = await card.boundingBox()
    await page.getByRole('button', { name: 'Add Apples to cart', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Increase Apples', exact: true })).toBeVisible()
    const after = await card.boundingBox()
    expect(after.height).toBe(before.height)
    for (const route of ['/', '/shop', '/products/000000000000000000000001', '/cart', '/checkout', '/orders', '/login', '/register', '/verify-email']) {
      await page.goto(`http://localhost:5273${route}`)
      await page.locator('h1').waitFor()
      await page.evaluate(() => document.fonts.ready)
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), route).toBe(false)
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
      expect(result.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.target) })), route).toEqual([])
      if (route === '/') await page.screenshot({ path: `docs/screenshots/ui-storefront-${width}.png`, fullPage: true })
    }
    await page.goto('http://localhost:5273/hookah')
    await page.getByRole('button', { name: 'I am 18 or older' }).click()
    await expect(page.getByRole('heading', { name: 'Hookah essentials' })).toBeVisible()
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    expect(result.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.target) }))).toEqual([])
    await page.screenshot({ path: `docs/screenshots/ui-hookah-${width}.png`, fullPage: true })
  })

  test(`admin accessibility and responsive geometry at ${width}px`, async ({ page }) => {
    await fixtures(page, { admin: true })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width, height: 900 })
    await login(page, true)
    for (const route of ['/', '/orders', '/products', '/categories']) {
      await page.goto(`http://localhost:5274${route}`)
      try { await page.getByRole('heading', { name: route === '/' ? 'Dashboard' : route.slice(1)[0].toUpperCase() + route.slice(2), exact: true }).waitFor({ timeout: 10000 }) } catch (error) { throw new Error(`${route}: ${errors.join('; ') || error.message}`) }
      await page.evaluate(() => document.fonts.ready)
      const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, oversized: [...document.querySelectorAll('body *')].filter((element) => element.getBoundingClientRect().right > innerWidth).slice(0, 15).map((element) => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right, overflow: getComputedStyle(element).overflowX })) }))
      expect(geometry.scroll > geometry.width, JSON.stringify({ route, ...geometry })).toBe(false)
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
      expect(result.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.target) })), route).toEqual([])
      if (route === '/') await page.screenshot({ path: `docs/screenshots/ui-admin-${width}.png`, fullPage: true })
    }
  })
}