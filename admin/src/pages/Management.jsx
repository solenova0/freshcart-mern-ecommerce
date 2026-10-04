import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { Badge, Button, Input, Modal, Select } from '@freshcart/design-system'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { api, errorMessage, money } from '../lib/api.js'
import { ConfirmDialog, ImageUploader, Pagination, QueryState } from '../components/ui.jsx'

function EntityForm({ resource, entity, categories, onClose }) {
  const product = resource === 'products'
  const singular = product ? 'product' : 'category'
  const [files, setFiles] = useState([])
  const [savedId, setSavedId] = useState(null)
  const [errors, setErrors] = useState({})
  const client = useQueryClient()
  const save = useMutation({ mutationFn: async (values) => {
    const id = entity?._id || savedId
    const { data } = await api({ method: id ? 'patch' : 'post', url: id ? `/${resource}/${id}` : `/${resource}`, data: values })
    const created = data[singular]; setSavedId(created._id)
    if (files.length) { const form = new FormData(); files.forEach((file) => form.append('images', file)); try { const upload = await api.post(`/${resource}/${created._id}/images`, form); if (upload.data.cleanupFailed) toast.error('Saved; old-image cleanup needs attention') } catch { throw new Error(`${singular} saved; upload failed. Retry to upload your images.`) } }
  }, onSuccess: () => { client.invalidateQueries({ queryKey: [`admin-${resource}`] }); toast.success(`${product ? 'Product' : 'Category'} saved`); onClose() }, onError: () => client.invalidateQueries({ queryKey: [`admin-${resource}`] }) })
  function submit(event) {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    const categorySchema = z.object({ name: z.string().trim().min(1, 'Enter a name').max(100), slug: z.string().trim().toLowerCase().max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase words separated by hyphens'), description: z.string().max(4000) })
    const productSchema = z.object({ name: z.string().trim().min(1, 'Enter a name').max(200), description: z.string().max(10000), price: z.preprocess((value) => value === '' ? undefined : value, z.coerce.number().nonnegative()), stock: z.preprocess((value) => value === '' ? undefined : value, z.coerce.number().int().nonnegative()), category: z.string().regex(/^[a-f0-9]{24}$/i, 'Select a category'), productType: z.enum(['grocery', 'hookah']), attributes: z.record(z.string(), z.json()) })
    if (product) { try { values.attributes = JSON.parse(values.attributes) } catch { setErrors({ attributes: 'Enter a valid JSON object' }); return } }
    const parsed = (product ? productSchema : categorySchema).safeParse(values)
    if (!parsed.success) { setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path[0], issue.message]))); return }
    setErrors({}); save.mutate(parsed.data)
  }
  return <Modal title={`${entity ? 'Edit' : 'New'} ${singular}`} onClose={onClose}><form className="form-stack" noValidate onSubmit={submit}><Input label="Name" name="name" defaultValue={entity?.name || ''} required error={errors.name} />{!product && <Input label="Slug" name="slug" defaultValue={entity?.slug || ''} required error={errors.slug} />}<label className="field"><span>Description</span><textarea name="description" rows={3} defaultValue={entity?.description || ''} aria-invalid={Boolean(errors.description)} />{errors.description && <span className="field-error">{errors.description}</span>}</label>{product && <><div className="form-grid"><Input label="Price (USD)" name="price" type="number" required min={0} step="0.01" defaultValue={entity?.price ?? ''} error={errors.price} /><Input label="Stock" name="stock" type="number" required min={entity?.reservedStock || 0} step={1} defaultValue={entity?.stock ?? 0} error={errors.stock} /></div><div className="form-grid"><Select label="Category" name="category" required defaultValue={entity?.category?._id || entity?.category || ''} error={errors.category}><option value="">Select category</option>{categories.map((category) => <option key={category._id} value={category._id}>{category.name}</option>)}</Select><Select label="Product type" name="productType" defaultValue={entity?.productType || 'grocery'}><option value="grocery">Grocery</option><option value="hookah">Hookah</option></Select></div><label className="field"><span>Attributes (JSON)</span><textarea className="font-mono text-xs" name="attributes" rows={4} defaultValue={JSON.stringify(entity?.attributes || {}, null, 2)} aria-invalid={Boolean(errors.attributes)} />{errors.attributes && <span className="field-error" role="alert">{errors.attributes}</span>}</label></>}<ImageUploader files={files} onChange={setFiles} existing={entity?.images?.length ? entity.images : entity?.image ? [entity.image] : []} />{save.isError && <p className="field-error" role="alert">{errorMessage(save.error)}</p>}<div className="form-actions"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Save {singular}</Button></div></form></Modal>
}

export function CatalogManagement({ resource = 'products' }) {
  const product = resource === 'products'
  const singular = product ? 'product' : 'category'
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [edit, setEdit] = useState(undefined)
  const [remove, setRemove] = useState(null)
  const client = useQueryClient()
  const query = useQuery({ queryKey: [`admin-${resource}`, page, search], queryFn: async () => (await api.get(`/${resource}`, { params: product ? { page, limit: 15, search: search || undefined } : undefined })).data })
  const categories = useQuery({ queryKey: ['admin-categories-options'], queryFn: async () => (await api.get('/categories')).data.categories, enabled: product })
  const deletion = useMutation({ mutationFn: (id) => api.delete(`/${resource}/${id}`), onSuccess: (response) => { client.invalidateQueries({ queryKey: [`admin-${resource}`] }); setRemove(null); response.data?.cleanupFailed ? toast.error('Deleted; image cleanup needs attention') : toast.success('Record deleted') } })
  const rows = product ? query.data?.products : query.data?.categories.filter((category) => category.name.toLowerCase().includes(search.toLowerCase()))
  return <><div className="page-title"><div><p className="eyebrow">CATALOG</p><h1>{product ? 'Products' : 'Categories'}</h1></div><Button disabled={product && !categories.data?.length} onClick={() => setEdit(null)}><Plus size={18} />New {singular}</Button></div><form className="admin-search" onSubmit={(event) => { event.preventDefault(); setSearch(String(new FormData(event.currentTarget).get('search')).trim()); setPage(1) }}><Search size={18} /><input aria-label={`Search ${resource}`} name="search" placeholder={`Search ${resource}`} maxLength={200} /><button className="icon-btn" aria-label={`Search ${resource}`} title="Search"><Search size={18} /></button></form>{product && <QueryState query={categories} />}<QueryState query={query} empty={rows?.length === 0} />{rows?.length > 0 && <div className="table-wrap"><table><caption className="sr-only">{product ? 'Products' : 'Categories'}</caption><thead><tr><th>Name</th>{product ? <><th>Category</th><th>Type</th><th>Price</th><th>Stock</th></> : <><th>Slug</th><th>Description</th></>}<th><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.map((row) => <tr key={row._id}><td><div className="table-product">{(row.images?.[0] || row.image) && <img src={row.images?.[0] || row.image} alt={row.name} />}<span className="font-semibold">{row.name}</span></div></td>{product ? <><td>{row.category?.name || '—'}</td><td><Badge>{row.productType}</Badge></td><td>{money(row.price)}</td><td>{row.stock}<span className="subtext">{row.reservedStock || 0} reserved</span></td></> : <><td>{row.slug}</td><td className="description-cell">{row.description || '—'}</td></>}<td><div className="flex gap-2"><button className="icon-btn" title={`Edit ${singular}`} aria-label={`Edit ${row.name}`} onClick={() => setEdit(row)}><Pencil size={18} /></button><button className="icon-btn danger-text" title={`Delete ${singular}`} aria-label={`Delete ${row.name}`} onClick={() => setRemove(row)}><Trash2 size={18} /></button></div></td></tr>)}</tbody></table></div>}{product && <Pagination pagination={query.data?.pagination} onPage={setPage} />}{edit !== undefined && <EntityForm resource={resource} entity={edit} categories={categories.data || []} onClose={() => setEdit(undefined)} />}{remove && <ConfirmDialog title={`Delete ${remove.name}?`} pending={deletion.isPending} onCancel={() => setRemove(null)} onConfirm={() => deletion.mutate(remove._id)} />}</>
}