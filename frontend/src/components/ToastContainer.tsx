import type { ToastMessage } from "../types"

interface ToastContainerProps {
  toasts: ToastMessage[]
  removeToast: (id: string) => void
}

const iconMap: Record<ToastMessage["type"], React.ReactNode> = {
  success: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="9" stroke="#2DAF7F" strokeWidth="1.5" />
      <path d="M6 10l2.5 2.5L14 7" stroke="#2DAF7F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  error: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="9" stroke="#E84C3D" strokeWidth="1.5" />
      <path d="M7 7l6 6M13 7l-6 6" stroke="#E84C3D" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  warning: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 2L1 18h18L10 2z" stroke="#E8983E" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 8v4M10 15v1" stroke="#E8983E" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  info: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="9" stroke="#2B5AED" strokeWidth="1.5" />
      <path d="M10 9v5M10 6v1" stroke="#2B5AED" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
}

export default function ToastContainer({ toasts, removeToast }: ToastContainerProps) {
  const toastStyle = `
    .toast-container {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    }

    .toast-item {
      display: flex;
      align-items: flex-start;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      background: var(--bg-card);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-md);
      min-width: 280px;
      max-width: 400px;
      pointer-events: auto;
      animation: toastIn 300ms ease-out both;
    }

    .toast-item.removing {
      animation: toastOut 300ms ease-in forwards;
    }

    .toast-icon {
      flex-shrink: 0;
      margin-top: 1px;
    }

    .toast-body {
      flex: 1;
      min-width: 0;
      font-size: var(--font-base);
      color: var(--text-primary);
      line-height: 1.5;
      word-break: break-word;
    }

    .toast-close {
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: none;
      cursor: pointer;
      color: var(--text-tertiary);
      padding: 0;
      margin-top: 1px;
      border-radius: var(--radius-xs);
      transition: color var(--transition-fast), background var(--transition-fast);
    }

    .toast-close:hover {
      color: var(--text-primary);
      background: var(--bg-hover);
    }
  `

  return (
    <>
      <style>{toastStyle}</style>
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast-item">
            <span className="toast-icon">{iconMap[toast.type]}</span>
            <span className="toast-body">{toast.message}</span>
            <button
              className="toast-close"
              onClick={() => removeToast(toast.id)}
              aria-label="关闭"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </>
  )
}