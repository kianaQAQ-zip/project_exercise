import { useState, useCallback } from "react"
import type { ToastMessage } from "../types"

let toastId = 0

export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const addToast = useCallback(
    (type: ToastMessage["type"], message: string, duration = 3000) => {
      const id = String(++toastId)
      setToasts((prev) => [...prev, { id, type, message }])
      if (duration > 0) {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id))
        }, duration)
      }
    },
    []
  )

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return { toasts, addToast, removeToast }
}