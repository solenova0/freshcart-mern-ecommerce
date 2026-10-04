import { useEffect, useId, useRef, useState } from 'react'
import { Eye, EyeOff, LoaderCircle, PackageOpen, X } from 'lucide-react'
import { Toaster } from 'react-hot-toast'

export function Button({ variant = 'primary', loading, disabled, children, className = '', type = 'button', ...props }) {
  return <button type={type} className={`btn ${variant} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>{loading && <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />}{children}</button>
}

export function Input({ label, error, id, type = 'text', className = '', ...props }) {
  const generated = useId()
  const inputId = id || generated
  const [visible, setVisible] = useState(false)
  const password = type === 'password'
  return <div className={`field ${className}`}><label htmlFor={inputId}>{label}</label><div className={password ? 'input-wrap' : undefined}><input id={inputId} type={password && visible ? 'text' : type} aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : undefined} {...props} />{password && <button type="button" className="icon-btn" title={visible ? 'Hide password' : 'Show password'} aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button>}</div>{error && <span className="field-error" id={`${inputId}-error`}>{error}</span>}</div>
}

export function Select({ label, error, id, children, ...props }) {
  const generated = useId()
  const selectId = id || generated
  return <div className="field"><label htmlFor={selectId}>{label}</label><select id={selectId} aria-invalid={Boolean(error)} aria-describedby={error ? `${selectId}-error` : undefined} {...props}>{children}</select>{error && <span className="field-error" id={`${selectId}-error`}>{error}</span>}</div>
}

export function Badge({ status, children, className = '' }) {
  return <span className={`badge ${className}`} data-status={status} data-literal={children ? true : undefined}>{children || (status === 'shipped' ? 'Out for delivery' : status)}</span>
}
export function Card({ children, className = '', ...props }) { return <div className={`card ${className}`} {...props}>{children}</div> }

export function Modal({ title, onClose, children, drawer = false, theme }) {
  const ref = useRef(null)
  const id = useId()
  useEffect(() => {
    const dialog = ref.current
    const before = document.body.style.overflow
    const trigger = document.activeElement
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    return () => { dialog.close(); document.body.style.overflow = before; trigger?.focus?.() }
  }, [])
  function trapFocus(event) {
    if (event.key !== 'Tab' || event.defaultPrevented || event.target.closest('dialog') !== event.currentTarget) return
    const elements = [...event.currentTarget.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter((element) => element.getClientRects().length > 0)
    const first = elements[0]
    const last = elements.at(-1)
    if (!first) { event.preventDefault(); return }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  return <dialog ref={ref} data-theme={theme} className={drawer ? 'modal drawer' : 'modal'} aria-labelledby={id} onKeyDown={trapFocus} onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => { if (event.target !== event.currentTarget) return; const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose() }}><header className="modal-header"><h2 id={id}>{title}</h2><button className="icon-btn" aria-label="Close dialog" title="Close" onClick={onClose}><X size={18} /></button></header><div className="modal-body">{children}</div></dialog>
}
export function Drawer(props) { return <Modal {...props} drawer /> }
export function Toast() { return <Toaster position="top-right" toastOptions={{ duration: 4500, style: { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '12px', fontFamily: 'var(--font-body)' }, success: { iconTheme: { primary: '#15803D', secondary: '#FFFFFF' } } }} /> }
export function Skeleton({ className = '', ...props }) { return <div className={`skeleton ${className}`} aria-hidden="true" {...props} /> }
export function EmptyState({ title = 'Nothing here yet', message, action, icon }) { return <div className="empty-state">{icon || <PackageOpen size={36} aria-hidden="true" />}<h3>{title}</h3>{message && <p>{message}</p>}{action}</div> }