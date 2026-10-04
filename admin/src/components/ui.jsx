import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Star, Trash2, Upload } from 'lucide-react'
import { Button, EmptyState, Input, Modal as SharedModal, Skeleton } from '@freshcart/design-system'
import { errorMessage } from '../lib/api.js'

export function QueryState({ query, empty }) {
  if (query.isPending) return <div role="status" aria-label="Loading" className="loading-skeletons"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
  if (query.isError) return <div role="alert" className="empty-state"><p>{errorMessage(query.error)}</p><button className="btn secondary" onClick={() => query.refetch()}>Retry</button></div>
  if (empty) return <EmptyState title="No records found" message="Try changing your filters, or add a new record." />
  return null
}

export function Modal({ title, onClose, children, drawer = false }) {
  return <SharedModal title={title} onClose={onClose} drawer={drawer}>{children}</SharedModal>
}

export function ConfirmDialog({ title, pending, onCancel, onConfirm, cancelOrder = false }) {
  return <Modal title={title} onClose={onCancel}><p className="muted mb-6">{cancelOrder ? 'The order will be cancelled and reserved stock released or restored.' : 'This action cannot be undone.'}</p><div className="flex justify-end gap-4"><Button variant="ghost" onClick={onCancel} disabled={pending}>{cancelOrder ? 'Keep order' : 'Keep record'}</Button><Button variant="danger" onClick={onConfirm} loading={pending}>{cancelOrder ? 'Confirm cancellation' : 'Delete'}</Button></div></Modal>
}

export function Field({ label, ...props }) {
  return <Input label={label} {...props} />
}

export function ImagePreview({ file }) {
  const [url] = useState(() => URL.createObjectURL(file))
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return <figure className="preview"><img src={url} alt={file.name} /><figcaption>{file.name}</figcaption></figure>
}

export function ImageUploader({ files, onChange, existing = [] }) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  function accept(next) {
    if (next.length > 5 || next.some((file) => file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) { setError('Choose up to 5 JPEG, PNG, or WebP images, 5 MB each.'); return }
    setError(''); onChange(next)
  }
  return <div><label className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); accept([...event.dataTransfer.files]) }}><Upload size={28} /><strong>Drop images here</strong><span>or choose files · up to 5 images, 5 MB each</span><input type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="Choose images" onChange={(event) => { accept([...event.target.files]); event.target.value = '' }} /></label>{error && <p className="field-error mt-2" role="alert">{error}</p>}<div className="previews">{files.length ? files.map((file, index) => <div key={`${file.name}-${file.lastModified}-${index}`}><ImagePreview file={file} /><div className="preview-actions"><button type="button" className="icon-btn" title={index === 0 ? 'Primary image' : 'Set as primary'} aria-label={`Set ${file.name} as primary`} aria-pressed={index === 0} onClick={() => onChange([file, ...files.filter((_, position) => position !== index)])}><Star size={17} fill={index === 0 ? 'currentColor' : 'none'} /></button><button type="button" className="icon-btn" title="Remove image" aria-label={`Remove ${file.name}`} onClick={() => onChange(files.filter((_, position) => position !== index))}><Trash2 size={17} /></button></div>{index === 0 && <span className="primary-marker">Primary image</span>}</div>) : existing.map((image, index) => <figure key={image}><img className="existing-preview" src={image} alt={`Existing image ${index + 1}`} />{index === 0 && <figcaption className="primary-marker">Primary image</figcaption>}</figure>)}</div></div>
}

export function Pagination({ pagination, onPage }) {
  if (!pagination || pagination.pages <= 1) return null
  return <nav aria-label="Pagination" className="flex gap-4 items-center justify-end py-5"><button className="icon-btn" title="Previous page" aria-label="Previous page" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}><ArrowLeft size={17} /></button><span className="text-sm">{pagination.page} / {pagination.pages}</span><button className="icon-btn" title="Next page" aria-label="Next page" disabled={pagination.page >= pagination.pages} onClick={() => onPage(pagination.page + 1)}><ArrowRight size={17} /></button></nav>
}