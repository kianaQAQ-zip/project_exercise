import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../contexts/AuthContext"

const LogoIcon = (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" rx="10" fill="var(--brand-500)" />
    <path
      d="M12 20l5.5 5.5L28 15"
      stroke="white"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const UserIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
    <path d="M4 20c0-4 3.5-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

const LockIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 11V7a4 4 0 018 0v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

const AlertIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="8" r="7" stroke="#E84C3D" strokeWidth="1.5" />
    <path d="M8 5v3M8 10.5v.5" stroke="#E84C3D" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

const SpinnerIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="login-spinner">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.3" />
    <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
)

export default function LoginView() {
  const { login } = useAuth()
  const navigate = useNavigate()

  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError("")

    if (!username.trim()) {
      setError("请输入用户名")
      return
    }
    if (!password) {
      setError("请输入密码")
      return
    }

    setLoading(true)
    try {
      await login(username.trim(), password)
      navigate("/", { replace: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "登录失败，请检查用户名和密码"
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <style>{loginStyles}</style>
      <div className="login-shell">
        <div className="login-card animate-fade-in">
          <div className="login-header">
            <div className="login-logo">
              {LogoIcon}
            </div>
            <h1 className="login-title">Enterprise AI</h1>
            <p className="login-subtitle">企业级智能办公平台</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            {error && (
              <div className="login-error">
                {AlertIcon}
                <span>{error}</span>
              </div>
            )}

            <div className="login-field">
              <label className="login-label" htmlFor="username">用户名</label>
              <div className="login-input-wrapper">
                <span className="login-input-icon">{UserIcon}</span>
                <input
                  id="username"
                  className="login-input"
                  type="text"
                  placeholder="请输入用户名"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  disabled={loading}
                />
              </div>
            </div>

            <div className="login-field">
              <label className="login-label" htmlFor="password">密码</label>
              <div className="login-input-wrapper">
                <span className="login-input-icon">{LockIcon}</span>
                <input
                  id="password"
                  className="login-input"
                  type="password"
                  placeholder="请输入密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  disabled={loading}
                />
              </div>
            </div>

            <button
              className="login-btn"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <>
                  {SpinnerIcon}
                  登录中...
                </>
              ) : (
                "登 录"
              )}
            </button>
          </form>

          <div className="login-footer">
            <span className="login-footer-text">演示账户</span>
            <div className="login-demo-accounts">
              <span className="login-demo-tag">admin / admin123</span>
              <span className="login-demo-tag">employee / emp123456</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

const loginStyles = `
  .login-shell {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: var(--bg-primary);
    padding: 24px;
  }

  .login-card {
    width: 100%;
    max-width: 420px;
    background: var(--bg-card);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    padding: 48px 40px 40px;
  }

  .login-header {
    text-align: center;
    margin-bottom: 36px;
  }

  .login-logo {
    display: inline-flex;
    margin-bottom: 20px;
  }

  .login-title {
    font-size: 22px;
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
    margin: 0 0 6px;
    letter-spacing: -0.3px;
  }

  .login-subtitle {
    font-size: var(--font-base);
    color: var(--text-tertiary);
    margin: 0;
  }

  .login-form {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .login-error {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: var(--semantic-urgent-bg);
    border-radius: var(--radius-sm);
    font-size: var(--font-sm);
    color: var(--semantic-urgent);
    animation: fadeIn var(--transition-fast) ease-out both;
  }

  .login-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .login-label {
    font-size: var(--font-sm);
    font-weight: var(--font-weight-medium);
    color: var(--text-secondary);
  }

  .login-input-wrapper {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    background: var(--bg-input);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  }

  .login-input-wrapper:focus-within {
    border-color: var(--border-focus);
    box-shadow: 0 0 0 3px var(--brand-50);
  }

  .login-input-icon {
    display: flex;
    align-items: center;
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .login-input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    padding: 12px 0;
    font-size: var(--font-base);
    color: var(--text-primary);
    line-height: 1.5;
  }

  .login-input::placeholder {
    color: var(--text-placeholder);
  }

  .login-input:disabled {
    opacity: 0.6;
  }

  .login-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 12px 24px;
    margin-top: 4px;
    background: var(--brand-500);
    color: var(--text-on-brand);
    border: none;
    border-radius: var(--radius-sm);
    font-size: var(--font-lg);
    font-weight: var(--font-weight-medium);
    cursor: pointer;
    transition: background var(--transition-fast), transform var(--transition-fast), box-shadow var(--transition-fast);
  }

  .login-btn:hover:not(:disabled) {
    background: var(--brand-400);
    box-shadow: 0 2px 12px rgba(43, 90, 237, 0.3);
  }

  .login-btn:active:not(:disabled) {
    transform: scale(0.98);
  }

  .login-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .login-spinner {
    animation: spin 0.8s linear infinite;
  }

  .login-footer {
    margin-top: 32px;
    padding-top: 20px;
    border-top: 1px solid var(--border-light);
    text-align: center;
  }

  .login-footer-text {
    font-size: var(--font-xs);
    color: var(--text-tertiary);
    display: block;
    margin-bottom: 8px;
  }

  .login-demo-accounts {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }

  .login-demo-tag {
    font-size: var(--font-xs);
    font-family: "SF Mono", "Fira Code", monospace;
    color: var(--text-secondary);
    background: var(--bg-hover);
    padding: 3px 10px;
    border-radius: var(--radius-xs);
  }
`