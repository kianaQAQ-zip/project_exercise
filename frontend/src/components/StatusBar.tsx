interface StatusBarProps {
  connectionStatus?: "connected" | "disconnected"
  newMailCount?: number
  pendingDocs?: number
}

export default function StatusBar({
  connectionStatus = "connected",
  newMailCount = 0,
  pendingDocs = 0,
}: StatusBarProps) {
  const statusBarStyle = `
    .statusbar {
      height: var(--statusbar-height);
      background: var(--bg-card);
      border-bottom: 1px solid var(--border-default);
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding: 0 var(--space-4);
      flex-shrink: 0;
      gap: var(--space-4);
    }

    .statusbar-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .statusbar-dot {
      width: 8px;
      height: 8px;
      border-radius: var(--radius-full);
      flex-shrink: 0;
    }

    .statusbar-dot.connected {
      background: #2DAF7F;
    }

    .statusbar-dot.disconnected {
      background: #959CA6;
    }

    .statusbar-label {
      font-size: var(--font-xs);
      color: var(--text-tertiary);
      white-space: nowrap;
    }

    .statusbar-pill {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: var(--radius-full);
      background: var(--brand-50);
      color: var(--brand-500);
      font-size: var(--font-xs);
      font-weight: var(--font-weight-medium);
      white-space: nowrap;
    }
  `

  return (
    <>
      <style>{statusBarStyle}</style>
      <div className="statusbar">
        <div className="statusbar-item">
          <span
            className={`statusbar-dot ${connectionStatus}`}
          />
          <span className="statusbar-label">
            {connectionStatus === "connected" ? "已连接" : "离线"}
          </span>
        </div>

        <div className="statusbar-item">
          <span className="statusbar-label">新邮件</span>
          <span className="statusbar-pill">{newMailCount}</span>
        </div>

        <div className="statusbar-item">
          <span className="statusbar-label">待处理文档</span>
          <span className="statusbar-pill">{pendingDocs}</span>
        </div>
      </div>
    </>
  )
}