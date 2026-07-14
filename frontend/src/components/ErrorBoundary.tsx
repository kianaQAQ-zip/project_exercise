import { Component, type ErrorInfo, type ReactNode } from "react"

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary] 捕获到未处理错误:", error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <>
          <style>{`
            .error-boundary-wrapper {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              min-height: 60vh;
              text-align: center;
              padding: 48px 24px;
            }

            .error-boundary-icon {
              width: 56px;
              height: 56px;
              border-radius: 50%;
              background: var(--semantic-urgent-bg);
              display: flex;
              align-items: center;
              justify-content: center;
              margin-bottom: 20px;
              color: var(--semantic-urgent);
            }

            .error-boundary-title {
              font-size: 20px;
              font-weight: 600;
              color: var(--text-primary);
              margin-bottom: 8px;
            }

            .error-boundary-desc {
              font-size: 14px;
              color: var(--text-tertiary);
              margin-bottom: 24px;
              max-width: 400px;
            }

            .error-boundary-detail {
              font-size: 12px;
              color: var(--text-tertiary);
              background: var(--bg-input);
              padding: 12px 16px;
              border-radius: var(--radius-sm);
              max-width: 480px;
              overflow: auto;
              text-align: left;
              margin-bottom: 24px;
              font-family: "SF Mono", "Fira Code", monospace;
              line-height: 1.6;
              word-break: break-all;
            }

            .error-boundary-btn {
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
              transition: background 150ms ease;
            }

            .error-boundary-btn:hover {
              background: var(--brand-400);
            }
          `}</style>
          <div className="error-boundary-wrapper">
            <div className="error-boundary-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <h2 className="error-boundary-title">页面出现了意外错误</h2>
            <p className="error-boundary-desc">
              应用遇到了一个未预期的错误，请尝试刷新页面。如果问题持续存在，请联系系统管理员。
            </p>
            {this.state.error && (
              <div className="error-boundary-detail">
                {this.state.error.message}
              </div>
            )}
            <button className="error-boundary-btn" onClick={this.handleReset}>
              重试
            </button>
          </div>
        </>
      )
    }

    return this.props.children
  }
}