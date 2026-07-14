import { useState, useEffect } from "react"
import { useAuth } from "../contexts/AuthContext"
import { authAPI, mailAPI } from "../services/api"
import { useToast } from "../hooks/useToast"
import ToastContainer from "../components/ToastContainer"

export default function ProfileView() {
  const { user } = useAuth()
  const { toasts, addToast, removeToast } = useToast()

  const [editDisplayName, setEditDisplayName] = useState(user?.display_name || "")
  const [savingProfile, setSavingProfile] = useState(false)

  // 使用与邮件中心一致的 user_id 确保数据互通
  const MAIL_USER_ID = "default_user"

  // 邮件账户绑定状态
  const [mailAccount, setMailAccount] = useState<{
    email_address: string; provider: string; is_active: boolean
  } | null>(null)
  const [loadingMailAccount, setLoadingMailAccount] = useState(true)
  const [bindEmail, setBindEmail] = useState("")
  const [bindPassword, setBindPassword] = useState("")
  const [bindProvider, setBindProvider] = useState("qq")
  const [binding, setBinding] = useState(false)
  const [showBindForm, setShowBindForm] = useState(false)

  // 同步用户信息
  useEffect(() => {
    setEditDisplayName(user?.display_name || "")
  }, [user])

  // 加载邮件账户（使用与邮件中心相同的 user_id）
  useEffect(() => {
    const loadMailAccount = async () => {
      setLoadingMailAccount(true)
      try {
        const res = await mailAPI.getAccount(MAIL_USER_ID)
        if (res && (res as any).email_address) {
          setMailAccount({
            email_address: (res as any).email_address,
            provider: (res as any).provider || "qq",
            is_active: (res as any).is_active ?? true,
          })
          setBindEmail((res as any).email_address)
        }
      } catch {
        // 无绑定账户
      } finally {
        setLoadingMailAccount(false)
      }
    }
    loadMailAccount()
  }, [MAIL_USER_ID])

  const handleSaveProfile = async () => {
    if (!editDisplayName.trim()) {
      addToast("error", "显示名称不能为空")
      return
    }
    setSavingProfile(true)
    try {
      const res = await authAPI.updateProfile({
        display_name: editDisplayName.trim(),
      })
      // 更新 localStorage
      const stored = localStorage.getItem("auth_user")
      if (stored) {
        const parsed = JSON.parse(stored)
        parsed.email = res.email
        parsed.display_name = res.display_name
        localStorage.setItem("auth_user", JSON.stringify(parsed))
      }
      addToast("success", "个人信息已更新")
    } catch (err: any) {
      addToast("error", err?.message || "更新失败")
    } finally {
      setSavingProfile(false)
    }
  }

  const handleBindMailAccount = async () => {
    if (!bindEmail.trim() || !bindPassword.trim()) {
      addToast("error", "请填写邮箱地址和授权码")
      return
    }
    setBinding(true)
    try {
      const providerConfigs: Record<string, { imap_host: string; imap_port: number; smtp_host: string; smtp_port: number }> = {
        qq: { imap_host: "imap.qq.com", imap_port: 993, smtp_host: "smtp.qq.com", smtp_port: 465 },
        "163": { imap_host: "imap.163.com", imap_port: 993, smtp_host: "smtp.163.com", smtp_port: 465 },
        gmail: { imap_host: "imap.gmail.com", imap_port: 993, smtp_host: "smtp.gmail.com", smtp_port: 465 },
      }
      const cfg = providerConfigs[bindProvider] || providerConfigs.qq
      await mailAPI.bindAccount({
        user_id: MAIL_USER_ID,
        provider: bindProvider,
        email_address: bindEmail.trim(),
        password: bindPassword,
        ...cfg,
      })
      setMailAccount({
        email_address: bindEmail.trim(),
        provider: bindProvider,
        is_active: true,
      })
      addToast("success", "邮件账户已绑定")
      setShowBindForm(false)
    } catch (err: any) {
      addToast("error", err?.message || "绑定失败")
    } finally {
      setBinding(false)
    }
  }

  const handleUnbindMailAccount = async () => {
    try {
      await mailAPI.unbindAccount(MAIL_USER_ID)
      setMailAccount(null)
      setBindEmail("")
      addToast("success", "邮件账户已解绑")
    } catch (err: any) {
      addToast("error", err?.message || "解绑失败")
    }
  }

  const getProviderLabel = (p: string) => {
    const map: Record<string, string> = { qq: "QQ邮箱", "163": "163邮箱", gmail: "Gmail" }
    return map[p] || p
  }

  return (
    <>
      <style>{cssStyles}</style>
      <div style={styles.page}>
        <div style={styles.header}>
          <h1 style={styles.title}>个人信息</h1>
          <p style={styles.subtitle}>管理您的个人资料和邮件账户绑定</p>
        </div>

        <div style={styles.cards}>
          {/* 基本信息 */}
          <div style={styles.card}>
            <div style={styles.cardSection}>
              <div style={styles.cardTitleRow}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
                </svg>
                <h3 style={styles.cardTitle}>基本信息</h3>
              </div>
              <div style={styles.divider} />

              <div style={styles.readonlyFields}>
                <div style={styles.fieldRow}>
                  <span style={styles.fieldLabel}>用户名</span>
                  <span style={styles.fieldValue}>{user?.username}</span>
                </div>
                <div style={styles.fieldRow}>
                  <span style={styles.fieldLabel}>角色</span>
                  <span style={styles.fieldValue}>
                    <span style={{
                      ...styles.roleBadge,
                      background: user?.role === "admin" ? "var(--brand-50)" : "var(--semantic-normal-bg)",
                      color: user?.role === "admin" ? "var(--brand-500)" : "var(--semantic-normal)",
                    }}>
                      {user?.role === "admin" ? "管理员" : "员工"}
                    </span>
                  </span>
                </div>
                <div style={styles.fieldRow}>
                  <span style={styles.fieldLabel}>部门</span>
                  <span style={styles.fieldValue}>{user?.department || "未设置"}</span>
                </div>
              </div>

              <div style={{ ...styles.divider, margin: "var(--space-3) 0" }} />

              <div style={styles.editFields}>
                <div style={styles.editField}>
                  <label style={styles.editLabel} htmlFor="profile-display-name">显示名称</label>
                  <input
                    id="profile-display-name"
                    className="profile-input"
                    value={editDisplayName}
                    onChange={(e) => setEditDisplayName(e.target.value)}
                    placeholder="请输入显示名称"
                  />
                </div>
                <button
                  className="profile-save-btn"
                  style={{
                    ...styles.saveBtn,
                    opacity: savingProfile ? 0.7 : 1,
                  }}
                  disabled={savingProfile}
                  onClick={handleSaveProfile}
                >
                  {savingProfile ? "保存中..." : "保存个人信息"}
                </button>
              </div>
            </div>
          </div>

          {/* 邮件账户绑定 */}
          <div style={styles.card}>
            <div style={styles.cardSection}>
              <div style={styles.cardTitleRow}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M22 4l-10 7-10-7" />
                </svg>
                <h3 style={styles.cardTitle}>邮件账户绑定</h3>
              </div>
              <div style={styles.divider} />

              {loadingMailAccount ? (
                <div style={styles.loadingState}>加载中...</div>
              ) : mailAccount ? (
                <div style={styles.boundAccount}>
                  <div style={styles.boundHeader}>
                    <div style={styles.boundStatus}>
                      <span style={styles.statusDot} />
                      <span style={styles.boundLabel}>已绑定</span>
                    </div>
                    <span style={styles.boundProvider}>{getProviderLabel(mailAccount.provider)}</span>
                  </div>
                  <div style={styles.boundEmail}>{mailAccount.email_address}</div>
                  <button
                    className="profile-unbind-btn"
                    style={styles.unbindBtn}
                    onClick={handleUnbindMailAccount}
                  >
                    解绑并更换邮箱
                  </button>
                </div>
              ) : (
                <div style={styles.unboundState}>
                  <div style={styles.unboundHint}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <path d="M22 4l-10 7-10-7" />
                    </svg>
                    <p style={styles.unboundText}>尚未绑定邮件账户，绑定后可在邮件中心收发邮件</p>
                  </div>

                  {!showBindForm ? (
                    <button
                      className="profile-save-btn"
                      style={styles.saveBtn}
                      onClick={() => setShowBindForm(true)}
                    >
                      绑定邮件账户
                    </button>
                  ) : (
                    <div style={styles.bindForm}>
                      <div style={styles.editField}>
                        <label style={styles.editLabel}>邮箱服务商</label>
                        <select
                          className="profile-input"
                          value={bindProvider}
                          onChange={(e) => setBindProvider(e.target.value)}
                          style={{ cursor: "pointer" }}
                        >
                          <option value="qq">QQ邮箱</option>
                          <option value="163">163邮箱</option>
                          <option value="gmail">Gmail</option>
                        </select>
                      </div>
                      <div style={styles.editField}>
                        <label style={styles.editLabel}>邮箱地址</label>
                        <input
                          className="profile-input"
                          type="email"
                          value={bindEmail}
                          onChange={(e) => setBindEmail(e.target.value)}
                          placeholder="example@qq.com"
                        />
                      </div>
                      <div style={styles.editField}>
                        <label style={styles.editLabel}>
                          授权码/密码
                          <span style={styles.hintText}>
                            （{bindProvider === "qq" ? "QQ邮箱设置→账户→POP3/SMTP服务→生成授权码" : "邮箱的SMTP授权码"}）
                          </span>
                        </label>
                        <input
                          className="profile-input"
                          type="password"
                          value={bindPassword}
                          onChange={(e) => setBindPassword(e.target.value)}
                          placeholder="请输入授权码"
                        />
                      </div>
                      <div style={styles.bindActions}>
                        <button
                          className="profile-save-btn"
                          style={{ ...styles.saveBtn, opacity: binding ? 0.7 : 1 }}
                          disabled={binding}
                          onClick={handleBindMailAccount}
                        >
                          {binding ? "绑定中..." : "确认绑定"}
                        </button>
                        <button
                          className="profile-cancel-btn"
                          style={styles.cancelBtn}
                          onClick={() => setShowBindForm(false)}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </>
  )
}

const cssStyles = `
  .profile-input {
    flex: 1;
    padding: 10px 14px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    font-size: var(--font-base);
    color: var(--text-primary);
    background: var(--bg-input, #F9FAFB);
    outline: none;
    transition: border-color 150ms ease, box-shadow 150ms ease;
    font-family: inherit;
    width: 100%;
    box-sizing: border-box;
  }
  .profile-input:focus {
    border-color: var(--border-focus);
    box-shadow: 0 0 0 3px var(--brand-50);
  }
  .profile-input::placeholder {
    color: var(--text-placeholder);
  }
  .profile-save-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: 10px 20px;
    background: var(--brand-500);
    color: var(--text-on-brand);
    border: none;
    border-radius: var(--radius-sm);
    font-size: var(--font-base);
    font-weight: 500;
    cursor: pointer;
    transition: background 150ms ease;
    font-family: inherit;
  }
  .profile-save-btn:hover {
    background: var(--brand-400);
  }
  .profile-cancel-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 10px 20px;
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    font-size: var(--font-base);
    font-weight: 500;
    cursor: pointer;
    transition: background 150ms ease, color 150ms ease;
    font-family: inherit;
  }
  .profile-cancel-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .profile-unbind-btn {
    background: none;
    border: none;
    font-size: var(--font-sm);
    color: var(--brand-500);
    cursor: pointer;
    padding: 0;
    font-family: inherit;
  }
  .profile-unbind-btn:hover {
    color: var(--semantic-urgent);
  }
`

const styles: Record<string, React.CSSProperties> = {
  page: {
    width: "100%",
    maxWidth: 640,
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
    border: "1px solid var(--border-default)",
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
  divider: {
    width: "100%",
    height: 1,
    background: "var(--border-light)",
    margin: "var(--space-3) 0",
  },
  readonlyFields: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-2)",
  },
  fieldRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 0",
    gap: "var(--space-3)",
  },
  fieldLabel: {
    fontSize: "var(--font-sm)",
    color: "var(--text-secondary)",
    flexShrink: 0,
  },
  fieldValue: {
    fontSize: "var(--font-base)",
    color: "var(--text-primary)",
    fontWeight: 500,
  },
  roleBadge: {
    fontSize: "var(--font-xs)",
    fontWeight: 500,
    padding: "2px 8px",
    borderRadius: "var(--radius-xs)",
  },
  editFields: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-3)",
  },
  editField: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-1)",
  },
  editLabel: {
    fontSize: "var(--font-sm)",
    color: "var(--text-secondary)",
    fontWeight: 500,
  },
  saveBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
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
    marginTop: "var(--space-1)",
  },
  loadingState: {
    padding: "var(--space-4)",
    textAlign: "center",
    color: "var(--text-tertiary)",
    fontSize: "var(--font-sm)",
  },
  boundAccount: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-2)",
  },
  boundHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  boundStatus: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "var(--radius-full)",
    background: "#2DAF7F",
    display: "inline-block",
  },
  boundLabel: {
    fontSize: "var(--font-sm)",
    color: "#2DAF7F",
    fontWeight: 500,
  },
  boundProvider: {
    fontSize: "var(--font-xs)",
    color: "var(--text-tertiary)",
    background: "var(--bg-hover, #F3F4F6)",
    padding: "2px 8px",
    borderRadius: "var(--radius-xs)",
  },
  boundEmail: {
    fontSize: "var(--font-lg)",
    color: "var(--text-primary)",
    fontWeight: 600,
  },
  unbindBtn: {
    background: "none",
    border: "none",
    fontSize: "var(--font-sm)",
    color: "var(--brand-500)",
    cursor: "pointer",
    padding: 0,
    textAlign: "left" as const,
    width: "fit-content",
  },
  unboundState: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
  },
  unboundHint: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "var(--space-2)",
    padding: "var(--space-4) 0",
  },
  unboundText: {
    fontSize: "var(--font-sm)",
    color: "var(--text-tertiary)",
    margin: 0,
    textAlign: "center" as const,
  },
  bindForm: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-3)",
    padding: "var(--space-4)",
    background: "var(--bg-primary, #F9FAFB)",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--border-default)",
  },
  hintText: {
    fontSize: "var(--font-xs)",
    color: "var(--text-tertiary)",
    fontWeight: 400,
    marginLeft: "var(--space-1)",
  },
  bindActions: {
    display: "flex",
    gap: "var(--space-3)",
    marginTop: "var(--space-1)",
  },
  cancelBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
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
}