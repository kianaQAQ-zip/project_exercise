import { useState, useEffect, useCallback } from "react"
import { Outlet } from "react-router-dom"
import Sidebar from "./Sidebar"
import StatusBar from "./StatusBar"
import { mailAPI, knowledgeAPI } from "../services/api"
import { useAuth } from "../contexts/AuthContext"

export default function Layout() {
  const { user } = useAuth()
  const [newMailCount, setNewMailCount] = useState(0)
  const [pendingDocs, setPendingDocs] = useState(0)

  const fetchCounts = useCallback(async () => {
    try {
      const [mailRes, docRes] = await Promise.all([
        mailAPI.getUnreadCount(user?.id || "default_user").catch(() => ({ code: 200, data: { count: 0 } })),
        knowledgeAPI.getPendingCount(user?.department || "default_dept").catch(() => ({ code: 200, data: { count: 0 } })),
      ])
      setNewMailCount(mailRes.data?.count ?? 0)
      setPendingDocs(docRes.data?.count ?? 0)
    } catch {
      // 静默失败
    }
  }, [user])

  useEffect(() => {
    fetchCounts()
    // 每 30 秒刷新一次
    const interval = setInterval(fetchCounts, 30000)
    return () => clearInterval(interval)
  }, [fetchCounts])

  return (
    <div style={styles.shell}>
      <Sidebar />
      <div style={styles.mainArea}>
        <StatusBar newMailCount={newMailCount} pendingDocs={pendingDocs} />
        <div style={styles.content}>
          <Outlet />
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: "flex",
    height: "100vh",
    overflow: "hidden",
  },
  mainArea: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    marginLeft: "var(--sidebar-width)",
  },
  content: {
    flex: 1,
    overflow: "auto",
    padding: "24px",
  },
}