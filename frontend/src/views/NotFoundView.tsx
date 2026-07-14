import { Link } from "react-router-dom"

export default function NotFoundView() {
  return (
    <>
      <style>{`
        .notfound-wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 60vh;
          text-align: center;
          padding: 48px 24px;
        }

        .notfound-code {
          font-size: 72px;
          font-weight: 700;
          color: var(--brand-100);
          line-height: 1;
          margin-bottom: 16px;
          user-select: none;
        }

        .notfound-title {
          font-size: 20px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 8px;
        }

        .notfound-desc {
          font-size: 14px;
          color: var(--text-tertiary);
          margin-bottom: 32px;
          max-width: 360px;
        }

        .notfound-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
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

        .notfound-btn:hover {
          background: var(--brand-400);
        }
      `}</style>
      <div className="notfound-wrapper">
        <div className="notfound-code">404</div>
        <h2 className="notfound-title">页面不存在</h2>
        <p className="notfound-desc">
          您访问的页面可能已被移除、名称已更改或暂时不可用。
        </p>
        <Link to="/knowledge" className="notfound-btn">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 8h10M7 4l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          返回知识库
        </Link>
      </div>
    </>
  )
}