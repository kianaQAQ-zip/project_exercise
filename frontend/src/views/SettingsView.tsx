import { useState, useEffect, useCallback } from "react"
import { useToast } from "../hooks/useToast"
import ToastContainer from "../components/ToastContainer"
import { healthAPI, configAPI } from "../services/api"
import { useAuth } from "../contexts/AuthContext"

const ENV_LABEL_MAP: Record<string, { label: string; bg: string; color: string }> = {
  development: { label: "development", bg: "#EBF0FF", color: "#2B5AED" },
  staging: { label: "staging", bg: "#FEF8F0", color: "#E8983E" },
  production: { label: "production", bg: "#EDF8F3", color: "#2DAF7F" },
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

const PlugIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M7 2v6h10V2M11 8v4l-3 4v4h8v-4l-3-4V8M8 22h8"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const SlidersIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="3" width="20" height="4" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
    <rect x="4" y="10" width="16" height="4" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
    <rect x="2" y="17" width="20" height="4" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
    <circle cx="16" cy="5" r="2" fill="currentColor" />
    <circle cx="8" cy="12" r="2" fill="currentColor" />
    <circle cx="16" cy="19" r="2" fill="currentColor" />
  </svg>
)

const CheckIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 8l3.5 3.5L13 5" stroke="#2DAF7F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const SaveIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M13 14H3a1 1 0 01-1-1V3a1 1 0 011-1h7l4 4v8a1 1 0 01-1 1z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M5 14V8h6v6M5 2v4h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const InfoIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" fill="none" />
    <path d="M12 11v5M12 8v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

export default function SettingsView() {
  const { toasts, addToast, removeToast } = useToast()
  useAuth()

  const [vectorStoreConnected, setVectorStoreConnected] = useState(false)
  const [pgConnected, setPgConnected] = useState(false)
  const [redisConnected, setRedisConnected] = useState(false)

  const [vectorStoreLoading, setVectorStoreLoading] = useState(false)
  const [pgLoading, setPgLoading] = useState(false)
  const [redisLoading, setRedisLoading] = useState(false)

  const [uptime, setUptime] = useState(0)
  const [serverUptime, setServerUptime] = useState(0)
  const [checking, setChecking] = useState(true)
  const [modelConfig, setModelConfig] = useState<{
    model_name: string; api_endpoint: string; temperature: string; embedding_model: string
  }>({ model_name: "加载中...", api_endpoint: "加载中...", temperature: "-", embedding_model: "加载中..." })

  const checkHealth = useCallback(async () => {
    setChecking(true)
    try {
      const res = await healthAPI.check()
      if (res.code === 200 && res.data) {
        setVectorStoreConnected(res.data.vector_store)
        setPgConnected(res.data.postgres)
        setRedisConnected(res.data.redis)
        setServerUptime(res.data.uptime)
      }
    } catch {
      setVectorStoreConnected(false)
      setPgConnected(false)
      setRedisConnected(false)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    checkHealth()
  }, [checkHealth])

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const res = await configAPI.get()
        if (res.code === 200 && res.data) {
          setModelConfig(res.data as typeof modelConfig)
        }
      } catch {
        // 保持默认值
      }
    }
    loadConfig()
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      setUptime((prev) => prev + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const handleRetry = async (
    setLoading: (v: boolean) => void,
    setConnected: (v: boolean) => void
  ) => {
    setLoading(true)
    try {
      const res = await healthAPI.check()
      if (res.code === 200 && res.data) {
        setVectorStoreConnected(res.data.vector_store)
        setPgConnected(res.data.postgres)
        setRedisConnected(res.data.redis)
        setServerUptime(res.data.uptime)
        addToast("success", "连接状态已刷新")
      } else {
        addToast("warning", "部分服务离线")
      }
    } catch {
      setConnected(false)
      addToast("error", "无法连接到后端服务")
    } finally {
      setLoading(false)
    }
  }

  const envKey = "staging" as const
  const envInfo = ENV_LABEL_MAP[envKey]

  const displayUptime = serverUptime > 0 ? serverUptime : uptime

  return (
    <>
      <style>{cssStyles}</style>
      <div style={styles.page}>
        <div style={styles.header}>
          <h1 style={styles.title}>系统设置</h1>
          <p style={styles.subtitle}>管理应用配置与连接状态</p>
        </div>

        <div style={styles.cards}>
          <div style={styles.card}>
            <div style={styles.cardSection}>
              <div style={styles.cardTitleRow}>
                {PlugIcon}
                <h3 style={styles.cardTitle}>服务连接状态</h3>
                {checking && (
                  <span style={styles.checkingBadge}>检测中...</span>
                )}
              </div>
              <div style={styles.divider} />

              {[
                {
                  name: "向量存储 (PG)",
                  connected: vectorStoreConnected,
                  loading: vectorStoreLoading,
                  endpoint: "内嵌 PostgreSQL",
                  onRetry: () => handleRetry(setVectorStoreLoading, setVectorStoreConnected),
                },
                {
                  name: "PostgreSQL 数据库",
                  connected: pgConnected,
                  loading: pgLoading,
                  endpoint: "localhost:5432",
                  onRetry: () => handleRetry(setPgLoading, setPgConnected),
                },
                {
                  name: "Redis 缓存",
                  connected: redisConnected,
                  loading: redisLoading,
                  endpoint: "localhost:6379",
                  onRetry: () => handleRetry(setRedisLoading, setRedisConnected),
                },
              ].map((service) => (
                <div key={service.name} className="settings-connection-row" style={styles.connectionRow}>
                  <div style={styles.connectionInfo}>
                    <span
                      style={{
                        ...styles.statusDot,
                        background: service.connected ? "#2DAF7F" : "#959CA6",
                      }}
                    />
                    <span style={styles.connectionName}>{service.name}</span>
                    <span
                      style={{
                        ...styles.connectionText,
                        color: service.connected
                          ? "var(--text-secondary)"
                          : "var(--text-tertiary)",
                      }}
                    >
                      {service.connected
                        ? `已连接 · ${service.endpoint}`
                        : "离线 · 点击重试"}
                    </span>
                  </div>
                  {!service.connected && (
                    <button
                        className="settings-retry-btn"
                        style={{
                          ...styles.retryButton,
                          opacity: service.loading ? 0.6 : 1,
                        }}
                        disabled={service.loading}
                        onClick={service.onRetry}
                      >
                      {service.loading ? "连接中..." : "重试"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardSection}>
              <div style={styles.cardTitleRow}>
                {SlidersIcon}
                <h3 style={styles.cardTitle}>AI 模型配置</h3>
              </div>
              <div style={styles.divider} />

              {[ 
                { label: "模型名称", value: modelConfig.model_name },
                { label: "API 端点", value: modelConfig.api_endpoint },
                { label: "温度参数", value: modelConfig.temperature },
                { label: "Embedding 模型", value: modelConfig.embedding_model },
              ].map((item) => (
                <div key={item.label} style={styles.kvGroup}>
                  <div style={styles.kvRow}>
                    <span style={styles.kvLabel}>{item.label}</span>
                    <span style={styles.kvValue}>{item.value}</span>
                  </div>
                </div>
              ))}

              <div style={{ ...styles.divider, margin: "var(--space-3) 0" }} />

              <div style={styles.kvRow}>
                <span style={styles.kvLabel}>备用模型状态</span>
                <span style={styles.kvValue}>
                  <span style={styles.badgeConfigured}>
                    {CheckIcon}
                    已配置
                  </span>
                </span>
              </div>
            </div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardSection}>
              <div style={styles.cardTitleRow}>
                {InfoIcon}
                <h3 style={styles.cardTitle}>应用信息</h3>
              </div>
              <div style={styles.divider} />

              <div style={styles.kvGroup}>
                <div style={styles.kvRow}>
                  <span style={styles.kvLabel}>应用版本</span>
                  <span style={styles.kvValue}>v1.0.0</span>
                </div>
              </div>

              <div style={styles.kvGroup}>
                <div style={styles.kvRow}>
                  <span style={styles.kvLabel}>运行环境</span>
                  <span
                    style={{
                      ...styles.envTag,
                      background: envInfo.bg,
                      color: envInfo.color,
                    }}
                  >
                    {envInfo.label}
                  </span>
                </div>
              </div>

              <div style={styles.kvGroup}>
                <div style={styles.kvRow}>
                  <span style={styles.kvLabel}>分块大小</span>
                  <span style={styles.kvValue}>500</span>
                </div>
              </div>

              <div style={styles.kvGroup}>
                <div style={styles.kvRow}>
                  <span style={styles.kvLabel}>分块重叠</span>
                  <span style={styles.kvValue}>50</span>
                </div>
              </div>

              <div style={styles.kvGroup}>
                <div style={styles.kvRow}>
                  <span style={styles.kvLabel}>上传上限</span>
                  <span style={styles.kvValue}>50MB</span>
                </div>
              </div>

              <div style={{ ...styles.divider, margin: "var(--space-3) 0" }} />

              <div style={styles.uptimeRow}>
                <span style={styles.uptimeLabel}>系统已运行</span>
                <span style={styles.uptimeValue}>{formatUptime(displayUptime)}</span>
              </div>
            </div>
          </div>
        </div>

        <div style={styles.actions}>
          <button
            className="settings-save-btn"
            style={styles.saveButton}
            onClick={() => addToast("success", "设置已保存")}
          >
            {SaveIcon}
            保存设置
          </button>
          <button
            className="settings-reset-btn"
            style={styles.resetButton}
            onClick={() => addToast("info", "已重置为默认设置")}
          >
            重置默认
          </button>
        </div>
      </div>

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </>
  )
}

const cssStyles = `
  .settings-connection-row:hover {
    background: var(--bg-hover);
  }

  .settings-retry-btn:hover {
    background: var(--bg-hover);
  }

  .settings-save-btn:hover {
    background: var(--brand-400);
  }

  .settings-reset-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .settings-input {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    font-size: var(--font-base);
    color: var(--text-primary);
    background: var(--bg-input);
    outline: none;
    transition: border-color 150ms ease, box-shadow 150ms ease;
    font-family: inherit;
  }

  .settings-input:focus {
    border-color: var(--border-focus);
    box-shadow: 0 0 0 3px var(--brand-50);
  }

  .settings-input::placeholder {
    color: var(--text-placeholder);
  }
`

const styles: Record<string, React.CSSProperties> = {
  page: {
    width: "100%",
    maxWidth: 800,
    margin: "0 auto",
    padding: "var(--space-6) 0",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-6)",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-1)",
  },
  title: {
    fontSize: "var(--font-3xl)",
    fontWeight: 600,
    color: "var(--text-primary)",
    margin: 0,
    lineHeight: 1.3,
  },
  subtitle: {
    fontSize: "var(--font-base)",
    color: "var(--text-secondary)",
    margin: 0,
    lineHeight: 1.6,
  },
  cards: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
  },
  card: {
    background: "var(--bg-card)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-sm)",
    padding: 24,
  },
  cardSection: {
    display: "flex",
    flexDirection: "column",
    gap: 0,
  },
  cardTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
    color: "var(--text-primary)",
  },
  cardTitle: {
    fontSize: "var(--font-lg)",
    fontWeight: 500,
    color: "var(--text-primary)",
    margin: 0,
    lineHeight: 1.4,
  },
  checkingBadge: {
    fontSize: "var(--font-xs)",
    color: "var(--brand-500)",
    background: "var(--brand-50)",
    padding: "1px 8px",
    borderRadius: "var(--radius-full)",
    fontWeight: 500,
  },
  divider: {
    width: "100%",
    height: 1,
    background: "var(--border-light)",
    margin: "var(--space-3) 0",
  },
  connectionRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px",
    borderRadius: "var(--radius-sm)",
    transition: "background 150ms ease",
  },
  connectionInfo: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "var(--radius-full)",
    flexShrink: 0,
    display: "inline-block",
  },
  connectionName: {
    fontSize: "var(--font-base)",
    fontWeight: 500,
    color: "var(--text-primary)",
  },
  connectionText: {
    fontSize: "var(--font-sm)",
  },
  retryButton: {
    background: "none",
    border: "none",
    fontSize: "var(--font-sm)",
    color: "var(--brand-500)",
    cursor: "pointer",
    padding: "2px 6px",
    borderRadius: "var(--radius-sm)",
    transition: "background 150ms ease",
  },
  kvGroup: {
    padding: "4px 0",
  },
  kvRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 0",
  },
  kvLabel: {
    fontSize: "12px",
    color: "var(--text-secondary)",
  },
  kvValue: {
    fontSize: "14px",
    color: "var(--text-primary)",
    fontWeight: 500,
  },
  badgeConfigured: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    color: "#2DAF7F",
    fontSize: "14px",
    fontWeight: 500,
  },
  envTag: {
    display: "inline-block",
    padding: "2px 10px",
    borderRadius: "var(--radius-sm)",
    fontSize: "12px",
    fontWeight: 500,
  },
  uptimeRow: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
    padding: "6px 0",
  },
  uptimeLabel: {
    fontSize: "12px",
    color: "var(--text-secondary)",
  },
  uptimeValue: {
    fontSize: "16px",
    fontWeight: 600,
    color: "var(--text-primary)",
    fontVariantNumeric: "tabular-nums",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    paddingTop: "var(--space-2)",
  },
  saveButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--space-2)",
    padding: "10px 20px",
    background: "var(--brand-500)",
    color: "var(--text-on-brand)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--font-base)",
    fontWeight: 500,
    cursor: "pointer",
    transition: "background 150ms ease",
  },
  resetButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--space-2)",
    padding: "10px 20px",
    background: "transparent",
    color: "var(--text-secondary)",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--font-base)",
    fontWeight: 500,
    cursor: "pointer",
    transition: "background 150ms ease, color 150ms ease",
  },
  profileInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-2)",
  },
  profileField: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "4px 0",
    gap: "var(--space-3)",
  },
  profileLabel: {
    fontSize: "var(--font-sm)",
    color: "var(--text-secondary)",
    flexShrink: 0,
  },
  profileValue: {
    fontSize: "var(--font-base)",
    color: "var(--text-primary)",
    fontWeight: 500,
  },
  profileEdit: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-3)",
  },
  profileInput: {
    flex: 1,
    padding: "8px 12px",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--font-base)",
    color: "var(--text-primary)",
    background: "var(--bg-input)",
    outline: "none",
    fontFamily: "inherit",
  },
}