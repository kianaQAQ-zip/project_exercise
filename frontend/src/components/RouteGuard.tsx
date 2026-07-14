import { Navigate, Outlet, useLocation } from "react-router-dom"
import { useAuth } from "../contexts/AuthContext"

const SpinnerIcon = (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" stroke="var(--brand-500)" strokeWidth="2" opacity="0.3" />
    <path d="M12 2a10 10 0 019.95 9" stroke="var(--brand-500)" strokeWidth="2" strokeLinecap="round">
      <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
    </path>
  </svg>
)

export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "var(--bg-primary)",
      }}>
        {SpinnerIcon}
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <Outlet />
}

export function AdminRoute() {
  const { user, isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "var(--bg-primary)",
      }}>
        {SpinnerIcon}
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (user?.role !== "admin") {
    return (
      <>
        <style>{`
          .forbidden-page {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            background: var(--bg-primary);
            text-align: center;
            padding: 24px;
          }
          .forbidden-icon {
            width: 64px;
            height: 64px;
            border-radius: 50%;
            background: var(--semantic-urgent-bg);
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 20px;
            color: var(--semantic-urgent);
          }
          .forbidden-title {
            font-size: 20px;
            font-weight: 600;
            color: var(--text-primary);
            margin-bottom: 8px;
          }
          .forbidden-desc {
            font-size: 14px;
            color: var(--text-tertiary);
            margin-bottom: 24px;
            max-width: 400px;
          }
          .forbidden-link {
            display: inline-flex;
            align-items: center;
            padding: 10px 24px;
            background: var(--brand-500);
            color: var(--text-on-brand);
            border: none;
            border-radius: var(--radius-sm);
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            text-decoration: none;
            transition: background 150ms ease;
          }
          .forbidden-link:hover {
            background: var(--brand-400);
          }
        `}</style>
        <div className="forbidden-page">
          <div className="forbidden-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
              <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <h2 className="forbidden-title">访问受限</h2>
          <p className="forbidden-desc">
            您没有访问此页面的权限，仅系统管理员可以查看系统设置。
          </p>
          <a className="forbidden-link" href="/">返回首页</a>
        </div>
      </>
    )
  }

  return <Outlet />
}

export function GuestRoute() {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "var(--bg-primary)",
      }}>
        {SpinnerIcon}
      </div>
    )
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}