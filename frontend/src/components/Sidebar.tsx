import { NavLink, useNavigate } from "react-router-dom"
import { useAuth } from "../contexts/AuthContext"
import { useTheme } from "../contexts/ThemeContext"

const navItems = [
  {
    to: "/",
    label: "仪表盘",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      </svg>
    ),
  },
  {
    to: "/knowledge",
    label: "知识库",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6.465a1 1 0 01-.832-.445L10.465 5H5a2 2 0 00-2 2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    ),
  },
  {
    to: "/chat",
    label: "智能问答",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    ),
  },
  {
    to: "/mail",
    label: "邮件中心",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M22 4l-10 7L2 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    ),
  },
  {
    to: "/settings",
    label: "系统设置",
    adminOnly: true,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    ),
  },
]

const LogoutIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export default function Sidebar() {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const isAdmin = user?.role === "admin"

  const visibleItems = navItems.filter(
    (item) => !item.adminOnly || isAdmin
  )

  const sidebarStyle = `
    .sidebar {
      width: var(--sidebar-width);
      height: 100vh;
      background: var(--bg-sidebar);
      border-right: 1px solid var(--border-default);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      position: fixed;
      left: 0;
      top: 0;
      z-index: 100;
    }

    .sidebar-brand {
      height: 40px;
      display: flex;
      align-items: center;
      padding: 0 var(--space-4);
      font-size: 18px;
      font-weight: var(--font-weight-semibold);
      color: var(--brand-500);
      flex-shrink: 0;
      margin-top: var(--space-4);
    }

    .sidebar-nav {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: var(--space-6) 0;
      overflow-y: auto;
    }

    .sidebar-nav-item {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      margin: 0 var(--space-2);
      border-radius: var(--radius-sm);
      font-size: var(--font-base);
      color: var(--text-secondary);
      text-decoration: none;
      transition: background var(--transition-fast), color var(--transition-fast);
      position: relative;
    }

    .sidebar-nav-item svg {
      flex-shrink: 0;
    }

    .sidebar-nav-item:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .sidebar-nav-item.active {
      background: var(--brand-50);
      color: var(--brand-500);
    }

    .sidebar-nav-item.active::before {
      content: "";
      position: absolute;
      left: -8px;
      top: 50%;
      transform: translateY(-50%);
      width: 3px;
      height: 20px;
      background: var(--brand-500);
      border-radius: 0 2px 2px 0;
    }

    .sidebar-user {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-4);
      border-top: 1px solid var(--border-default);
      flex-shrink: 0;
      cursor: pointer;
      transition: background var(--transition-fast);
    }

    .sidebar-user:hover {
      background: var(--bg-hover);
    }

    .sidebar-user-avatar {
      width: 32px;
      height: 32px;
      border-radius: var(--radius-full);
      background: ${isAdmin ? "var(--brand-500)" : "var(--semantic-normal)"};
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--font-sm);
      color: var(--text-on-brand);
      flex-shrink: 0;
    }

    .sidebar-user-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
    }

    .sidebar-user-name {
      font-size: var(--font-base);
      color: var(--text-primary);
      font-weight: var(--font-weight-medium);
    }

    .sidebar-user-dept {
      font-size: var(--font-sm);
      color: var(--text-tertiary);
    }

    .sidebar-user-role {
      font-size: 10px;
      font-weight: 500;
      padding: 1px 6px;
      border-radius: var(--radius-xs);
      background: ${isAdmin ? "var(--brand-50)" : "var(--semantic-normal-bg)"};
      color: ${isAdmin ? "var(--brand-500)" : "var(--semantic-normal)"};
    }

    .sidebar-logout-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: none;
      background: none;
      cursor: pointer;
      color: var(--text-tertiary);
      border-radius: var(--radius-xs);
      transition: color var(--transition-fast), background var(--transition-fast);
      flex-shrink: 0;
    }

    .sidebar-logout-btn:hover {
      color: var(--semantic-urgent);
      background: var(--semantic-urgent-bg);
    }

    .sidebar-theme-toggle {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      margin: 0 var(--space-2);
      border-radius: var(--radius-sm);
      font-size: var(--font-base);
      color: var(--text-secondary);
      border: none;
      background: none;
      cursor: pointer;
      width: calc(100% - var(--space-4));
      transition: background var(--transition-fast), color var(--transition-fast);
    }

    .sidebar-theme-toggle:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .sidebar-theme-divider {
      height: 1px;
      background: var(--border-default);
      margin: var(--space-2) var(--space-4);
    }
  `

  return (
    <>
      <style>{sidebarStyle}</style>
      <aside className="sidebar">
        <div className="sidebar-brand">Enterprise AI</div>

        <nav className="sidebar-nav">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `sidebar-nav-item${isActive ? " active" : ""}`
              }
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-theme-divider" />
        <button className="sidebar-theme-toggle" onClick={toggleTheme} title={theme === "light" ? "切换为暗色模式" : "切换为亮色模式"}>
          {theme === "light" ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
          <span>{theme === "light" ? "暗色模式" : "亮色模式"}</span>
        </button>

        <div className="sidebar-user" onClick={() => navigate("/profile")} title="点击查看个人信息">
          <div className="sidebar-user-avatar">
            {user?.display_name?.charAt(0) || "U"}
          </div>
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">{user?.display_name || "用户"}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="sidebar-user-dept">{user?.department || ""}</span>
              <span className="sidebar-user-role">
                {isAdmin ? "管理员" : "员工"}
              </span>
            </div>
          </div>
          <button
            className="sidebar-logout-btn"
            onClick={(e) => { e.stopPropagation(); logout(); }}
            title="退出登录"
          >
            {LogoutIcon}
          </button>
        </div>
      </aside>
    </>
  )
}