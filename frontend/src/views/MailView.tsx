import { useState, useEffect, useCallback } from "react"
import type { MailItem } from "../types"
import { mailAPI } from "../services/api"
import { useToast } from "../hooks/useToast"
import ToastContainer from "../components/ToastContainer"

const USER_ID = "default_user"

const PROVIDERS: Record<string, string> = {
  qq: "QQ邮箱",
  "163": "网易邮箱",
  gmail: "Gmail",
  outlook: "Outlook",
}

const CATEGORY_LABEL: Record<string, string> = {
  URGENT: "紧急",
  INQUIRY: "咨询",
  NOTIFICATION: "通知",
  SPAM: "垃圾",
  UNKNOWN: "未分类",
}

const CATEGORY_COLOR: Record<string, string> = {
  URGENT: "var(--semantic-urgent)",
  INQUIRY: "var(--semantic-reply)",
  NOTIFICATION: "var(--semantic-normal)",
  SPAM: "var(--semantic-spam)",
  UNKNOWN: "var(--text-tertiary)",
}

const CATEGORY_BG: Record<string, string> = {
  URGENT: "var(--semantic-urgent-bg)",
  INQUIRY: "var(--semantic-reply-bg)",
  NOTIFICATION: "var(--semantic-normal-bg)",
  SPAM: "var(--semantic-spam-bg)",
  UNKNOWN: "var(--bg-primary)",
}

type TabType = "unread" | "read" | "all"

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  const time = `${hours}:${minutes}`

  if (target.getTime() === today.getTime()) return time
  if (target.getTime() === yesterday.getTime()) return `昨天 ${time}`

  const month = (date.getMonth() + 1).toString().padStart(2, "0")
  const day = date.getDate().toString().padStart(2, "0")
  return `${month}-${day}`
}

export default function MailView() {
  const { toasts, addToast, removeToast } = useToast()
  const [activeTab, setActiveTab] = useState<TabType>("unread")
  const [mails, setMails] = useState<MailItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [readCount, setReadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const [selectedMail, setSelectedMail] = useState<MailItem | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const [showAccountForm, setShowAccountForm] = useState(false)
  const [account, setAccount] = useState<{
    provider: string; email_address: string; imap_host: string; imap_port: number
  } | null>(null)
  const [accountForm, setAccountForm] = useState({
    provider: "qq", email_address: "", password: "",
  })
  const [accountBinding, setAccountBinding] = useState(false)

  // AI 起草邮件相关状态
  const [showComposeForm, setShowComposeForm] = useState(false)
  const [composeForm, setComposeForm] = useState({ to: "", subject: "", context: "" })
  const [draftResult, setDraftResult] = useState<{ to: string; subject: string; body: string } | null>(null)
  const [showDraftReview, setShowDraftReview] = useState(false)
  const [editedDraft, setEditedDraft] = useState("")
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)

  // AI 分析邮件详情相关状态
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState<string | null>(null)

  // 从邮件详情中起草回复
  const [showReplyForm, setShowReplyForm] = useState(false)
  const [replyForm, setReplyForm] = useState({ topic: "", context: "" })

  const loadAccount = useCallback(async () => {
    try {
      const acc = await mailAPI.getAccount(USER_ID)
      if (acc) {
        setAccount({ provider: acc.provider, email_address: acc.email_address, imap_host: acc.imap_host, imap_port: acc.imap_port })
      }
    } catch { /* no account */ }
  }, [])

  useEffect(() => {
    loadAccount()
  }, [loadAccount])

  const fetchMails = useCallback(async () => {
    setLoading(true)
    try {
      let isReadParam: boolean | undefined
      if (activeTab === "unread") isReadParam = false
      else if (activeTab === "read") isReadParam = true
      // activeTab === "all" -> undefined

      // 并行获取：当前 tab 列表 + 未读数 + 总数（全部无筛选，用于计算已读数）
      const [mailRes, unreadRes, totalRes] = await Promise.all([
        mailAPI.fetch(USER_ID, isReadParam, 50),
        mailAPI.getUnreadCount(USER_ID),
        isReadParam !== undefined ? mailAPI.fetch(USER_ID, undefined, 1) : Promise.resolve(null),
      ])

      if (mailRes.code === 200 && Array.isArray(mailRes.data)) {
        setMails(mailRes.data as MailItem[])
      }
      if (unreadRes.code === 200) {
        setUnreadCount(unreadRes.data.count)
      }
      // 用无筛选的总数计算已读数，避免在过滤 tab 下 total 被截断
      const totalCount = isReadParam !== undefined && totalRes && totalRes.total !== undefined
        ? totalRes.total
        : (mailRes.total ?? 0)
      setReadCount(totalCount - (unreadRes.data?.count ?? 0))
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "获取邮件失败")
    } finally {
      setLoading(false)
    }
  }, [activeTab, addToast])

  useEffect(() => {
    fetchMails()
  }, [fetchMails])

  const handleSync = async () => {
    if (!account) {
      addToast("warning", "请先绑定邮箱账户")
      return
    }
    setSyncing(true)
    try {
      const res = await mailAPI.sync(USER_ID, 7)
      if (res.code === 200) {
        const d = res.data
        if (d.error) {
          addToast("error", d.error)
        } else {
          addToast("success", `同步完成：新增 ${d.synced} 封，跳过 ${d.skipped} 封`)
          fetchMails()
        }
      }
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "同步失败")
    } finally {
      setSyncing(false)
    }
  }

  const handleBindAccount = async () => {
    if (!accountForm.email_address || !accountForm.password) {
      addToast("error", "请填写邮箱地址和授权码")
      return
    }
    setAccountBinding(true)
    try {
      const res = await mailAPI.bindAccount({
        user_id: USER_ID,
        provider: accountForm.provider,
        email_address: accountForm.email_address,
        password: accountForm.password,
      })
      addToast("success", res.message)
      setShowAccountForm(false)
      loadAccount()
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "绑定失败")
    } finally {
      setAccountBinding(false)
    }
  }

  const handleUnbind = async () => {
    try {
      const res = await mailAPI.unbindAccount(USER_ID)
      addToast("success", res.message)
      setAccount(null)
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "解绑失败")
    }
  }

  const handleMarkAllAsRead = async () => {
    try {
      const res = await mailAPI.markAllAsRead(USER_ID)
      addToast("success", res.message)
      fetchMails()
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "操作失败")
    }
  }

  const openDrawer = async (mail: MailItem) => {
    setSelectedMail(mail)
    setDrawerOpen(true)
    // 标记为已读
    if (!mail.is_read) {
      try {
        await mailAPI.markAsRead(mail.id)
        // 更新本地状态
        setMails((prev) => prev.map((m) => m.id === mail.id ? { ...m, is_read: true } : m))
        setUnreadCount((c) => Math.max(0, c - 1))
      } catch {
        // 静默失败
      }
    }
    // 同时触发 AI 深度分析
    if (mail.body) {
      setAnalyzing(true)
      setAnalysis(null)
      mailAPI.analyze({ subject: mail.subject, sender: mail.sender, body: mail.body })
        .then((res) => {
          if (res.code === 200 && res.data) {
            setAnalysis(res.data.analysis)
          }
        })
        .catch(() => setAnalysis("AI 分析暂时不可用"))
        .finally(() => setAnalyzing(false))
    }
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    setTimeout(() => {
      setSelectedMail(null)
      setAnalysis(null)
    }, 300)
  }

  const handleOpenReplyDraft = () => {
    setReplyForm({ topic: "", context: "" })
    setDraftResult(null)
    setEditedDraft("")
    setShowReplyForm(true)
  }

  const handleGenerateReplyDraft = async () => {
    if (!selectedMail || !replyForm.topic) {
      addToast("error", "请填写回复主题")
      return
    }
    setGenerating(true)
    try {
      const res = await mailAPI.draftReply({
        original_subject: selectedMail.subject,
        original_body: selectedMail.body || selectedMail.summary,
        original_sender: selectedMail.sender,
        topic: replyForm.topic,
        context: replyForm.context || undefined,
      })
      if (res.code === 200 && res.data) {
        setDraftResult(res.data)
        setEditedDraft(res.data.body)
      } else {
        addToast("error", "AI 起草回复失败")
        return
      }
      setShowReplyForm(false)
      setShowDraftReview(true)
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "AI 起草回复失败")
    } finally {
      setGenerating(false)
    }
  }

  const handleOpenCompose = () => {
    setComposeForm({ to: "", subject: "", context: "" })
    setDraftResult(null)
    setEditedDraft("")
    setShowComposeForm(true)
  }

  const handleGenerateDraft = async () => {
    if (!composeForm.to || !composeForm.subject) {
      addToast("error", "请填写收件人和主题")
      return
    }
    setGenerating(true)
    try {
      const res = await mailAPI.draft({
        to: composeForm.to,
        subject: composeForm.subject,
        context: composeForm.context || undefined,
      })
      if (res.code === 200 && res.data) {
        setDraftResult(res.data)
        setEditedDraft(res.data.body)
      } else {
        addToast("error", "AI 起草失败")
        return
      }
      setShowComposeForm(false)
      setShowDraftReview(true)
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "AI 起草失败")
    } finally {
      setGenerating(false)
    }
  }

  const handleCancelDraft = () => {
    setShowDraftReview(false)
    setDraftResult(null)
    setEditedDraft("")
  }

  const handleSendDraft = async () => {
    if (!draftResult || !editedDraft.trim()) {
      addToast("error", "邮件内容不能为空")
      return
    }
    setSending(true)
    try {
      await mailAPI.send({
        to: draftResult.to,
        subject: draftResult.subject,
        body: editedDraft,
      })
      addToast("success", "邮件发送成功")
      setShowDraftReview(false)
      setDraftResult(null)
      setEditedDraft("")
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "发送失败")
    } finally {
      setSending(false)
    }
  }

  const urgentCount = mails.filter((m) => m.category === "URGENT").length
  const inquiryCount = mails.filter((m) => m.category === "INQUIRY").length
  const notificationCount = mails.filter((m) => m.category === "NOTIFICATION").length

  const tabs: { key: TabType; label: string; count: number }[] = [
    { key: "unread", label: "未读邮件箱", count: unreadCount },
    { key: "read", label: "已读邮件箱", count: readCount },
    { key: "all", label: "全部邮件", count: unreadCount + readCount },
  ]

  return (
    <>
      <style>{animStyles}</style>
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div style={styles.page}>
        <div style={styles.header}>
          <h1 style={styles.pageTitle}>邮件中心</h1>
          <p style={styles.pageSubtitle}>AI驱动的智能邮件分类与处理</p>
        </div>

        <div style={styles.accountSection}>
          {account ? (
            <div style={styles.accountCard}>
              <div style={styles.accountInfo}>
                <span style={styles.accountProvider}>
                  {PROVIDERS[account.provider] || account.provider}
                </span>
                <span style={styles.accountEmail}>{account.email_address}</span>
                <span style={styles.accountServer}>
                  {account.imap_host}:{account.imap_port}
                </span>
              </div>
              <div style={styles.accountActions}>
                <button style={styles.accountBtnGhost} onClick={() => setShowAccountForm(true)}>
                  更换
                </button>
                <button style={styles.accountBtnDanger} onClick={handleUnbind}>
                  解绑
                </button>
              </div>
            </div>
          ) : (
            <div style={styles.accountPlaceholder}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
                <path d="M22 4l-10 7L2 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
              <span style={styles.accountPlaceholderText}>
                尚未绑定邮箱，无法获取邮件
              </span>
              <button style={styles.accountBtnPrimary} onClick={() => setShowAccountForm(true)}>
                绑定邮箱
              </button>
            </div>
          )}

          {showAccountForm && (
            <div style={styles.accountForm}>
              <div style={styles.accountFormHeader}>
                <span style={styles.accountFormTitle}>{account ? "更换邮箱" : "绑定邮箱"}</span>
                <button style={styles.accountFormClose} onClick={() => setShowAccountForm(false)}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              <div style={styles.formField}>
                <label style={styles.formLabel}>邮箱服务商</label>
                <select
                  style={styles.formSelect}
                  value={accountForm.provider}
                  onChange={(e) => setAccountForm((f) => ({ ...f, provider: e.target.value }))}
                >
                  {Object.entries(PROVIDERS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>

              <div style={styles.formField}>
                <label style={styles.formLabel}>邮箱地址</label>
                <input
                  style={styles.formInput}
                  type="email"
                  placeholder="your@example.com"
                  value={accountForm.email_address}
                  onChange={(e) => setAccountForm((f) => ({ ...f, email_address: e.target.value }))}
                />
              </div>

              <div style={styles.formField}>
                <label style={styles.formLabel}>授权码</label>
                <input
                  style={styles.formInput}
                  type="password"
                  placeholder="IMAP/SMTP 授权码（非登录密码）"
                  value={accountForm.password}
                  onChange={(e) => setAccountForm((f) => ({ ...f, password: e.target.value }))}
                />
                <span style={styles.formHint}>
                  QQ邮箱/网易邮箱需在设置中开启IMAP/SMTP并获取授权码
                </span>
              </div>

              <button
                style={styles.accountBtnSubmit}
                onClick={handleBindAccount}
                disabled={accountBinding}
              >
                {accountBinding ? "绑定中..." : account ? "更新" : "绑定"}
              </button>
            </div>
          )}
        </div>

        <div style={styles.toolbar}>
          <div style={styles.toolbarLeft}>
            <button
              style={styles.btnPrimary}
              onClick={handleSync}
              disabled={syncing || !account}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{ ...styles.btnIcon, animation: syncing ? "spin 1s linear infinite" : "none" }}
              >
                <path
                  d="M13.65 2.35A7.96 7.96 0 008 0a8 8 0 100 16 7.96 7.96 0 005.65-2.35 8 8 0 000-11.3zM8 14.67A6.67 6.67 0 118 1.33a6.67 6.67 0 010 13.34z"
                  fill="currentColor"
                />
                <path
                  d="M8 2.67v2.66l2-2-2-0.66z"
                  fill="currentColor"
                />
              </svg>
              {syncing ? "同步中..." : "同步邮件"}
            </button>
            {!loading && (
              <span style={styles.mailCount}>
                已加载 <strong>{mails.length}</strong> 封邮件
              </span>
            )}
          </div>
          <div style={styles.toolbarRight}>
            {unreadCount > 0 && (
              <button style={styles.btnGhost} onClick={handleMarkAllAsRead}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={styles.btnIcon}>
                  <path d="M3 8l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
                全部已读
              </button>
            )}
            <button
              style={styles.btnPrimary}
              onClick={handleOpenCompose}
              disabled={!account}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={styles.btnIcon}
              >
                <path
                  d="M2 3h12l-1 9H3L2 3z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                  fill="none"
                />
                <path d="M8 3v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <circle cx="11" cy="1.5" r="1.5" fill="var(--semantic-urgent)" />
                <path d="M14 7l-2 2-1-1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
              AI 起草邮件
            </button>
          </div>
        </div>

        {/* 邮件箱标签栏 */}
        <div style={styles.tabBar}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              style={{
                ...styles.tab,
                ...(activeTab === tab.key ? styles.tabActive : {}),
              }}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
              <span style={{
                ...styles.tabBadge,
                ...(activeTab === tab.key ? styles.tabBadgeActive : {}),
              }}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {!loading && mails.length > 0 && (
          <div style={styles.statsRow}>
            <div style={{ ...styles.statCard, background: "var(--semantic-urgent-bg)" }}>
              <div style={{ ...styles.statBar, background: "var(--semantic-urgent)" }} />
              <div style={styles.statContent}>
                <span style={{ ...styles.statCount, color: "var(--semantic-urgent)" }}>{urgentCount}</span>
                <span style={styles.statLabel}>封 紧急邮件</span>
              </div>
            </div>
            <div style={{ ...styles.statCard, background: "var(--semantic-reply-bg)" }}>
              <div style={{ ...styles.statBar, background: "var(--semantic-reply)" }} />
              <div style={styles.statContent}>
                <span style={{ ...styles.statCount, color: "var(--semantic-reply)" }}>{inquiryCount}</span>
                <span style={styles.statLabel}>封 咨询邮件</span>
              </div>
            </div>
            <div style={{ ...styles.statCard, background: "var(--semantic-normal-bg)" }}>
              <div style={{ ...styles.statBar, background: "var(--semantic-normal)" }} />
              <div style={styles.statContent}>
                <span style={{ ...styles.statCount, color: "var(--semantic-normal)" }}>{notificationCount}</span>
                <span style={styles.statLabel}>封 通知邮件</span>
              </div>
            </div>
          </div>
        )}

        <div style={styles.listArea}>
          {loading ? (
            <div style={styles.skeletonList}>
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="skeleton" style={styles.skeletonItem} />
              ))}
            </div>
          ) : mails.length === 0 ? (
            <div style={styles.emptyState}>
              <svg
                width="64"
                height="64"
                viewBox="0 0 64 64"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect
                  x="8"
                  y="12"
                  width="48"
                  height="40"
                  rx="4"
                  stroke="var(--text-tertiary)"
                  strokeWidth="1.5"
                  fill="none"
                />
                <path
                  d="M8 20l24 16 24-16"
                  stroke="var(--text-tertiary)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
              <p style={styles.emptyText}>
                {activeTab === "unread" ? "暂无未读邮件" : activeTab === "read" ? "暂无已读邮件" : "暂无邮件"}
              </p>
              {activeTab === "unread" && account && (
                <button style={styles.btnPrimary} onClick={handleSync} disabled={syncing}>
                  {syncing ? "同步中..." : "立即同步邮件"}
                </button>
              )}
            </div>
          ) : (
            <div style={styles.mailList}>
              {mails.map((mail) => (
                <div
                  key={mail.id}
                  className="mail-card"
                  style={{
                    ...styles.mailCard,
                    ...(mail.is_read ? styles.mailCardRead : {}),
                  }}
                  onClick={() => openDrawer(mail)}
                >
                  <div style={styles.mailLeft}>
                    {!mail.is_read && <div style={styles.unreadDot} />}
                    <span
                      style={{
                        ...styles.categoryDot,
                        background: CATEGORY_COLOR[mail.category] || "var(--text-tertiary)",
                      }}
                    />
                  </div>
                  <div style={styles.mailCenter}>
                    <div style={styles.mailSender}>
                      <span style={{
                        ...styles.mailSenderName,
                        fontWeight: mail.is_read ? 400 : 600,
                      }}>{mail.sender}</span>
                    </div>
                    <div style={{
                      ...styles.mailSubject,
                      fontWeight: mail.is_read ? 400 : 600,
                    }}>{mail.subject}</div>
                    <div style={styles.mailSummary}>{mail.summary}</div>
                    <span style={styles.mailTime}>{formatTime(mail.received_at)}</span>
                  </div>
                  <div style={styles.mailRight}>
                    <span
                      style={{
                        ...styles.categoryPill,
                        background: CATEGORY_BG[mail.category] || "var(--bg-primary)",
                        color: CATEGORY_COLOR[mail.category] || "var(--text-tertiary)",
                      }}
                    >
                      {CATEGORY_LABEL[mail.category] || mail.category}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {drawerOpen && selectedMail && (
          <>
            <div style={styles.overlay} onClick={closeDrawer} />
            <div
              className="drawer"
              style={{
                ...styles.drawer,
                animation: "drawerModalIn 300ms ease-out both",
              }}
            >
              <div style={styles.drawerHeader}>
                <h2 style={styles.drawerTitle}>邮件详情</h2>
                <button
                  style={styles.drawerCloseBtn}
                  onClick={closeDrawer}
                  aria-label="关闭"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M5 5l10 10M15 5l-10 10"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>

              <div style={styles.drawerBody}>
                <div style={styles.drawerField}>
                  <span style={styles.drawerLabel}>发件人</span>
                  <span style={styles.drawerValue}>{selectedMail.sender}</span>
                </div>
                <div style={styles.drawerField}>
                  <span style={styles.drawerLabel}>主题</span>
                  <span style={styles.drawerValue}>{selectedMail.subject}</span>
                </div>
                <div style={styles.drawerField}>
                  <span style={styles.drawerLabel}>时间</span>
                  <span style={styles.drawerValue}>{selectedMail.received_at}</span>
                </div>
                <div style={styles.drawerField}>
                  <span style={styles.drawerLabel}>分类</span>
                  <span
                    style={{
                      ...styles.categoryPill,
                      background: CATEGORY_BG[selectedMail.category] || "var(--bg-primary)",
                      color: CATEGORY_COLOR[selectedMail.category] || "var(--text-tertiary)",
                      display: "inline-flex",
                    }}
                  >
                    {CATEGORY_LABEL[selectedMail.category] || selectedMail.category}
                  </span>
                </div>
                <div style={styles.drawerField}>
                  <span style={styles.drawerLabel}>摘要</span>
                  <p style={styles.drawerSummary}>{selectedMail.summary}</p>
                </div>

                <div style={styles.drawerDivider} />

                <div style={styles.drawerField}>
                  <span style={styles.drawerLabel}>邮件正文</span>
                  <div style={styles.drawerBodyText}>
                    {selectedMail.body || selectedMail.summary}
                  </div>
                </div>

                <div style={styles.drawerDivider} />

                {/* AI 深度分析区域 */}
                <div style={styles.drawerField}>
                  <span style={styles.drawerLabel}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ marginRight: 4 }}>
                      <circle cx="8" cy="8" r="7" stroke="var(--brand-500)" strokeWidth="1.2" fill="none" />
                      <path d="M8 4v4M8 10.5v.5" stroke="var(--brand-500)" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                    AI 智能分析
                  </span>
                  {analyzing ? (
                    <div style={styles.analyzingHint}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ ...styles.btnIcon, animation: "spin 1s linear infinite" }}>
                        <path d="M13.65 2.35A7.96 7.96 0 008 0a8 8 0 100 16 7.96 7.96 0 005.65-2.35 8 8 0 000-11.3zM8 14.67A6.67 6.67 0 118 1.33a6.67 6.67 0 010 13.34z" fill="var(--brand-500)" />
                        <path d="M8 2.67v2.66l2-2-2-0.66z" fill="var(--brand-500)" />
                      </svg>
                      AI 正在阅读分析邮件...
                    </div>
                  ) : analysis ? (
                    <div style={styles.analysisBox}>{analysis}</div>
                  ) : (
                    <span style={{ fontSize: "var(--font-sm)", color: "var(--text-tertiary)" }}>暂无分析结果</span>
                  )}
                </div>

                {/* 底部 AI 起草回复按钮 */}
                <div style={styles.drawerFooter}>
                  <button
                    style={styles.drawerReplyBtn}
                    onClick={handleOpenReplyDraft}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={styles.btnIcon}>
                      <path d="M2 3h12l-1 9H3L2 3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none" />
                      <path d="M8 3v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                      <circle cx="11" cy="1.5" r="1.5" fill="var(--semantic-urgent)" />
                      <path d="M14 7l-2 2-1-1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </svg>
                    AI 起草回复
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* AI 起草邮件 - 输入表单 */}
        {showComposeForm && (
          <>
            <div style={styles.overlay} onClick={() => setShowComposeForm(false)} />
            <div style={styles.draftModal}>
              <div style={styles.draftModalHeader}>
                <h2 style={styles.draftModalTitle}>AI 起草邮件</h2>
                <button
                  style={styles.drawerCloseBtn}
                  onClick={() => setShowComposeForm(false)}
                  aria-label="关闭"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path d="M5 5l10 10M15 5l-10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div style={styles.draftModalBody}>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>收件人邮箱</label>
                  <input
                    style={styles.formInput}
                    type="email"
                    placeholder="recipient@example.com"
                    value={composeForm.to}
                    onChange={(e) => setComposeForm((f) => ({ ...f, to: e.target.value }))}
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>主题</label>
                  <input
                    style={styles.formInput}
                    type="text"
                    placeholder="邮件主题"
                    value={composeForm.subject}
                    onChange={(e) => setComposeForm((f) => ({ ...f, subject: e.target.value }))}
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>额外要求（可选）</label>
                  <textarea
                    style={styles.formTextarea}
                    placeholder="例如：语气正式、强调截止日期、包含附件说明等"
                    rows={3}
                    value={composeForm.context}
                    onChange={(e) => setComposeForm((f) => ({ ...f, context: e.target.value }))}
                  />
                </div>
                <button
                  style={{
                    ...styles.btnPrimary,
                    width: "100%",
                    justifyContent: "center",
                    padding: "12px 24px",
                    opacity: generating ? 0.7 : 1,
                  }}
                  onClick={handleGenerateDraft}
                  disabled={generating}
                >
                  {generating ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ ...styles.btnIcon, animation: "spin 1s linear infinite" }}>
                        <path d="M13.65 2.35A7.96 7.96 0 008 0a8 8 0 100 16 7.96 7.96 0 005.65-2.35 8 8 0 000-11.3zM8 14.67A6.67 6.67 0 118 1.33a6.67 6.67 0 010 13.34z" fill="currentColor" />
                        <path d="M8 2.67v2.66l2-2-2-0.66z" fill="currentColor" />
                      </svg>
                      AI 正在起草...
                    </>
                  ) : (
                    "生成草稿"
                  )}
                </button>
              </div>
            </div>
          </>
        )}

        {/* AI 起草回复（从邮件详情中触发）*/}
        {showReplyForm && selectedMail && (
          <>
            <div style={styles.overlay} onClick={() => setShowReplyForm(false)} />
            <div style={styles.draftModal}>
              <div style={styles.draftModalHeader}>
                <h2 style={styles.draftModalTitle}>AI 起草回复</h2>
                <button
                  style={styles.drawerCloseBtn}
                  onClick={() => setShowReplyForm(false)}
                  aria-label="关闭"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path d="M5 5l10 10M15 5l-10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div style={styles.draftModalBody}>
                <div style={styles.replyContextBox}>
                  <div style={styles.replyContextLabel}>回复对象</div>
                  <div style={styles.replyContextValue}>{selectedMail.sender}</div>
                  <div style={{ ...styles.replyContextLabel, marginTop: 8 }}>原邮件主题</div>
                  <div style={styles.replyContextValue}>{selectedMail.subject}</div>
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>回复主题</label>
                  <input
                    style={styles.formInput}
                    type="text"
                    placeholder="您想回复什么主题？"
                    value={replyForm.topic}
                    onChange={(e) => setReplyForm((f) => ({ ...f, topic: e.target.value }))}
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>补充要求（可选）</label>
                  <textarea
                    style={styles.formTextarea}
                    placeholder="例如：语气正式、强调截止日期、确认收到等"
                    rows={3}
                    value={replyForm.context}
                    onChange={(e) => setReplyForm((f) => ({ ...f, context: e.target.value }))}
                  />
                </div>
                <button
                  style={{
                    ...styles.btnPrimary,
                    width: "100%",
                    justifyContent: "center",
                    padding: "12px 24px",
                    opacity: generating ? 0.7 : 1,
                  }}
                  onClick={handleGenerateReplyDraft}
                  disabled={generating}
                >
                  {generating ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ ...styles.btnIcon, animation: "spin 1s linear infinite" }}>
                        <path d="M13.65 2.35A7.96 7.96 0 008 0a8 8 0 100 16 7.96 7.96 0 005.65-2.35 8 8 0 000-11.3zM8 14.67A6.67 6.67 0 118 1.33a6.67 6.67 0 010 13.34z" fill="currentColor" />
                        <path d="M8 2.67v2.66l2-2-2-0.66z" fill="currentColor" />
                      </svg>
                      AI 正在起草回复...
                    </>
                  ) : (
                    "生成回复草稿"
                  )}
                </button>
              </div>
            </div>
          </>
        )}

        {/* AI 起草邮件 - 草稿审阅 */}
        {showDraftReview && draftResult && (
          <>
            <div style={styles.overlay} />
            <div style={styles.draftModal}>
              <div style={styles.draftModalHeader}>
                <h2 style={styles.draftModalTitle}>审阅邮件草稿</h2>
                <button
                  style={styles.drawerCloseBtn}
                  onClick={handleCancelDraft}
                  aria-label="关闭"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path d="M5 5l10 10M15 5l-10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div style={styles.draftModalBody}>
                <div style={styles.draftFieldRow}>
                  <span style={styles.draftLabel}>收件人：</span>
                  <span style={styles.draftValue}>{draftResult.to}</span>
                </div>
                <div style={styles.draftFieldRow}>
                  <span style={styles.draftLabel}>主题：</span>
                  <span style={styles.draftValue}>{draftResult.subject}</span>
                </div>
                <div style={styles.draftFieldRow}>
                  <span style={styles.draftLabel}>正文：</span>
                </div>
                <textarea
                  style={styles.draftTextarea}
                  value={editedDraft}
                  onChange={(e) => setEditedDraft(e.target.value)}
                  rows={14}
                />
                <div style={styles.draftActions}>
                  <button
                    style={styles.draftCancelBtn}
                    onClick={handleCancelDraft}
                    disabled={sending}
                  >
                    取消
                  </button>
                  <button
                    style={styles.draftSendBtn}
                    onClick={handleSendDraft}
                    disabled={sending}
                  >
                    {sending ? (
                      <>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ ...styles.btnIcon, animation: "spin 1s linear infinite" }}>
                          <path d="M13.65 2.35A7.96 7.96 0 008 0a8 8 0 100 16 7.96 7.96 0 005.65-2.35 8 8 0 000-11.3zM8 14.67A6.67 6.67 0 118 1.33a6.67 6.67 0 010 13.34z" fill="currentColor" />
                          <path d="M8 2.67v2.66l2-2-2-0.66z" fill="currentColor" />
                        </svg>
                        发送中...
                      </>
                    ) : (
                      "发送"
                    )}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}

const animStyles = `
  @keyframes drawerModalIn {
    from { opacity: 0; transform: translate(-50%, -50%) scale(0.92); }
    to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  }

  .mail-card {
    transition: transform 200ms ease, box-shadow 200ms ease;
  }

  .mail-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-card-hover);
  }
`

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: "960px",
    margin: "0 auto",
  },
  header: {
    marginBottom: "var(--space-6)",
  },
  pageTitle: {
    fontSize: "var(--font-3xl)",
    fontWeight: 700,
    color: "var(--text-primary)",
    margin: 0,
  },
  pageSubtitle: {
    fontSize: "var(--font-base)",
    color: "var(--text-secondary)",
    margin: "var(--space-1) 0 0 0",
  },

  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "var(--space-4)",
    flexWrap: "wrap",
    gap: "var(--space-3)",
  },
  toolbarLeft: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
  },
  toolbarRight: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
  },
  mailCount: {
    fontSize: "var(--font-sm)",
    color: "var(--text-tertiary)",
  },
  btnPrimary: {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--space-2)",
    padding: "var(--space-2) var(--space-4)",
    background: "var(--brand-500)",
    color: "var(--text-on-brand)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--font-base)",
    fontWeight: 500,
    cursor: "pointer",
    transition: "background 150ms ease",
    lineHeight: 1.5,
  },
  btnIcon: {
    flexShrink: 0,
  },
  btnGhost: {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--space-2)",
    padding: "var(--space-2) var(--space-4)",
    background: "transparent",
    color: "var(--brand-500)",
    border: "1px solid var(--brand-500)",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--font-base)",
    fontWeight: 500,
    cursor: "pointer",
    transition: "background 150ms ease, color 150ms ease",
    lineHeight: 1.5,
  },

  // 标签栏
  tabBar: {
    display: "flex",
    gap: "var(--space-1)",
    marginBottom: "var(--space-5)",
    padding: "var(--space-1)",
    background: "var(--bg-primary)",
    borderRadius: "var(--radius-md)",
  },
  tab: {
    flex: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--space-2)",
    padding: "var(--space-2) var(--space-4)",
    background: "transparent",
    color: "var(--text-secondary)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--font-base)",
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 150ms ease",
  },
  tabActive: {
    background: "var(--bg-card)",
    color: "var(--text-primary)",
    fontWeight: 600,
    boxShadow: "var(--shadow-sm)",
  },
  tabBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 22,
    height: 22,
    borderRadius: "var(--radius-full)",
    background: "var(--bg-hover)",
    color: "var(--text-tertiary)",
    fontSize: 12,
    fontWeight: 600,
    padding: "0 6px",
  },
  tabBadgeActive: {
    background: "var(--brand-500)",
    color: "var(--text-on-brand)",
  },

  statsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "var(--space-4)",
    marginBottom: "var(--space-5)",
  },
  statCard: {
    display: "flex",
    alignItems: "center",
    padding: "20px",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-sm)",
    overflow: "hidden",
  },
  statBar: {
    width: "3px",
    height: "40px",
    borderRadius: "2px",
    marginRight: "var(--space-3)",
    flexShrink: 0,
  },
  statContent: {
    display: "flex",
    alignItems: "baseline",
    gap: "var(--space-1)",
  },
  statCount: {
    fontSize: "var(--font-2xl)",
    fontWeight: 700,
    lineHeight: 1,
  },
  statLabel: {
    fontSize: "var(--font-sm)",
    color: "var(--text-secondary)",
  },

  listArea: {
    minHeight: "300px",
  },
  skeletonList: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-3)",
  },
  skeletonItem: {
    height: "64px",
    borderRadius: "var(--radius-md)",
  },

  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "var(--space-16) 0",
    gap: "var(--space-4)",
  },
  emptyText: {
    fontSize: "var(--font-base)",
    color: "var(--text-tertiary)",
    margin: 0,
  },

  mailList: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-3)",
  },
  mailCard: {
    display: "flex",
    alignItems: "center",
    padding: "var(--space-4) var(--space-5)",
    background: "var(--bg-card)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-sm)",
    cursor: "pointer",
    gap: "var(--space-4)",
    border: "1px solid var(--border-default)",
    transition: "transform 200ms ease, box-shadow 200ms ease",
  },
  mailCardRead: {
    opacity: 0.75,
  },
  mailLeft: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "6px",
    flexShrink: 0,
  },
  unreadDot: {
    width: "10px",
    height: "10px",
    borderRadius: "var(--radius-full)",
    background: "var(--brand-500)",
    flexShrink: 0,
    boxShadow: "0 0 6px rgba(79, 118, 255, 0.4)",
  },
  categoryDot: {
    width: "8px",
    height: "8px",
    borderRadius: "var(--radius-full)",
    flexShrink: 0,
  },
  mailCenter: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  mailSender: {
    display: "flex",
    alignItems: "baseline",
    gap: "var(--space-2)",
    marginBottom: "2px",
  },
  mailSenderName: {
    fontSize: "var(--font-base)",
    fontWeight: 500,
    color: "var(--text-primary)",
  },
  mailSubject: {
    fontSize: "var(--font-base)",
    color: "var(--text-primary)",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  mailSummary: {
    fontSize: "var(--font-sm)",
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  mailTime: {
    fontSize: "var(--font-xs)",
    color: "var(--text-tertiary)",
    marginTop: "2px",
  },
  mailRight: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-4)",
    flexShrink: 0,
  },
  categoryPill: {
    display: "inline-flex",
    padding: "2px 10px",
    borderRadius: "var(--radius-full)",
    fontSize: "var(--font-xs)",
    fontWeight: 500,
    whiteSpace: "nowrap",
  },

  overlay: {
    position: "fixed",
    inset: 0,
    background: "var(--bg-overlay)",
    zIndex: 200,
  },
  drawer: {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "640px",
    maxHeight: "90vh",
    background: "var(--bg-card)",
    borderRadius: "var(--radius-lg)",
    boxShadow: "var(--shadow-xl)",
    zIndex: 201,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  drawerHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "var(--space-5) var(--space-6)",
    borderBottom: "1px solid var(--border-light)",
    flexShrink: 0,
  },
  drawerTitle: {
    fontSize: "var(--font-xl)",
    fontWeight: 600,
    color: "var(--text-primary)",
    margin: 0,
  },
  drawerCloseBtn: {
    width: "32px",
    height: "32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    background: "none",
    borderRadius: "var(--radius-sm)",
    color: "var(--text-tertiary)",
    cursor: "pointer",
    padding: 0,
  },
  drawerBody: {
    flex: 1,
    overflow: "auto",
    padding: "var(--space-6)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
  },
  drawerField: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-1)",
  },
  drawerLabel: {
    fontSize: "var(--font-xs)",
    fontWeight: 500,
    color: "var(--text-tertiary)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
  },
  drawerValue: {
    fontSize: "var(--font-base)",
    color: "var(--text-primary)",
    lineHeight: 1.5,
  },
  drawerSummary: {
    fontSize: "var(--font-base)",
    color: "var(--text-secondary)",
    lineHeight: 1.7,
    margin: 0,
  },
  drawerDivider: {
    height: "1px",
    background: "var(--border-light)",
    margin: "var(--space-2) 0",
  },
  drawerBodyText: {
    fontSize: "var(--font-sm)",
    color: "var(--text-primary)",
    lineHeight: 1.8,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
    background: "var(--bg-primary)",
    padding: "var(--space-4) var(--space-5)",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border-light)",
    maxHeight: "400px",
    overflow: "auto",
  },
  analyzingHint: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    fontSize: "var(--font-sm)",
    color: "var(--brand-500)",
    padding: "var(--space-2) 0",
  },
  analysisBox: {
    fontSize: "var(--font-sm)",
    color: "var(--text-primary)",
    lineHeight: 1.8,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
    background: "var(--brand-50)",
    padding: "var(--space-3) var(--space-4)",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--brand-100)",
  },
  drawerFooter: {
    marginTop: "auto",
    paddingTop: "var(--space-4)",
    borderTop: "1px solid var(--border-light)",
  },
  drawerReplyBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--space-2)",
    padding: "var(--space-3) var(--space-5)",
    background: "var(--brand-500)",
    color: "var(--text-on-brand)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--font-base)",
    fontWeight: 500,
    cursor: "pointer",
    transition: "background 150ms ease",
    width: "100%",
    justifyContent: "center",
  },
  replyContextBox: {
    padding: "var(--space-3) var(--space-4)",
    background: "var(--bg-primary)",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border-light)",
    marginBottom: "var(--space-2)",
  },
  replyContextLabel: {
    fontSize: "var(--font-xs)",
    fontWeight: 500,
    color: "var(--text-tertiary)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
    marginBottom: "2px",
  },
  replyContextValue: {
    fontSize: "var(--font-sm)",
    color: "var(--text-primary)",
    fontWeight: 500,
    marginBottom: "4px",
  },

  accountSection: {
    marginBottom: "var(--space-6)",
  },
  accountCard: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "var(--space-4) var(--space-5)",
    background: "var(--bg-card)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-sm)",
    gap: "var(--space-4)",
  },
  accountInfo: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
    flexWrap: "wrap" as const,
  },
  accountProvider: {
    fontSize: "var(--font-sm)",
    fontWeight: 600,
    color: "var(--brand-500)",
    background: "var(--brand-50)",
    padding: "2px 10px",
    borderRadius: "var(--radius-xs)",
  },
  accountEmail: {
    fontSize: "var(--font-base)",
    color: "var(--text-primary)",
    fontWeight: 500,
  },
  accountServer: {
    fontSize: "var(--font-xs)",
    color: "var(--text-tertiary)",
    fontFamily: "monospace",
  },
  accountActions: {
    display: "flex",
    gap: "var(--space-2)",
    flexShrink: 0,
  },
  accountBtnGhost: {
    padding: "6px 14px",
    border: "1px solid var(--border-default)",
    background: "none",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--font-sm)",
    color: "var(--text-secondary)",
    cursor: "pointer",
    transition: "all 150ms ease",
  },
  accountBtnDanger: {
    padding: "6px 14px",
    border: "1px solid var(--border-default)",
    background: "none",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--font-sm)",
    color: "var(--semantic-urgent)",
    cursor: "pointer",
    transition: "all 150ms ease",
  },
  accountBtnPrimary: {
    padding: "6px 14px",
    border: "none",
    background: "var(--brand-500)",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--font-sm)",
    color: "var(--text-on-brand)",
    cursor: "pointer",
    transition: "all 150ms ease",
  },
  accountPlaceholder: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
    padding: "var(--space-4) var(--space-5)",
    background: "var(--bg-card)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-sm)",
    border: "1px dashed var(--border-default)",
  },
  accountPlaceholderText: {
    flex: 1,
    fontSize: "var(--font-sm)",
    color: "var(--text-tertiary)",
  },
  accountForm: {
    marginTop: "var(--space-3)",
    padding: "var(--space-5)",
    background: "var(--bg-card)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-md)",
    border: "1px solid var(--border-default)",
    display: "flex",
    flexDirection: "column" as const,
    gap: "var(--space-4)",
  },
  accountFormHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  accountFormTitle: {
    fontSize: "var(--font-lg)",
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  accountFormClose: {
    width: "28px",
    height: "28px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    background: "none",
    borderRadius: "var(--radius-xs)",
    color: "var(--text-tertiary)",
    cursor: "pointer",
  },
  formField: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px",
  },
  formLabel: {
    fontSize: "var(--font-sm)",
    fontWeight: 500,
    color: "var(--text-secondary)",
  },
  formSelect: {
    padding: "10px 12px",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--radius-sm)",
    background: "var(--bg-input)",
    color: "var(--text-primary)",
    fontSize: "var(--font-base)",
    outline: "none",
  },
  formInput: {
    padding: "10px 12px",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--radius-sm)",
    background: "var(--bg-input)",
    color: "var(--text-primary)",
    fontSize: "var(--font-base)",
    outline: "none",
  },
  formHint: {
    fontSize: "var(--font-xs)",
    color: "var(--text-tertiary)",
  },
  accountBtnSubmit: {
    padding: "10px 24px",
    border: "none",
    background: "var(--brand-500)",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--font-base)",
    fontWeight: 500,
    color: "var(--text-on-brand)",
    cursor: "pointer",
    alignSelf: "flex-end",
    transition: "all 150ms ease",
  },

  // AI 起草邮件样式
  draftModal: {
    position: "fixed" as const,
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "560px",
    maxHeight: "90vh",
    background: "var(--bg-card)",
    borderRadius: "var(--radius-lg)",
    boxShadow: "var(--shadow-xl)",
    zIndex: 301,
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
  },
  draftModalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "var(--space-5) var(--space-6)",
    borderBottom: "1px solid var(--border-light)",
    flexShrink: 0,
  },
  draftModalTitle: {
    fontSize: "var(--font-xl)",
    fontWeight: 600,
    color: "var(--text-primary)",
    margin: 0,
  },
  draftModalBody: {
    padding: "var(--space-6)",
    overflow: "auto",
    display: "flex",
    flexDirection: "column" as const,
    gap: "var(--space-4)",
  },
  formTextarea: {
    padding: "10px 12px",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--radius-sm)",
    background: "var(--bg-input)",
    color: "var(--text-primary)",
    fontSize: "var(--font-base)",
    outline: "none",
    fontFamily: "inherit",
    resize: "vertical" as const,
    minHeight: "72px",
  },
  draftFieldRow: {
    display: "flex",
    alignItems: "baseline",
    gap: "var(--space-2)",
  },
  draftLabel: {
    fontSize: "var(--font-sm)",
    fontWeight: 500,
    color: "var(--text-tertiary)",
    whiteSpace: "nowrap" as const,
    minWidth: "60px",
  },
  draftValue: {
    fontSize: "var(--font-base)",
    color: "var(--text-primary)",
    fontWeight: 500,
    wordBreak: "break-all" as const,
  },
  draftTextarea: {
    width: "100%",
    padding: "var(--space-3) var(--space-4)",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--radius-sm)",
    background: "var(--bg-input)",
    color: "var(--text-primary)",
    fontSize: "var(--font-base)",
    lineHeight: 1.8,
    fontFamily: "inherit",
    resize: "vertical" as const,
    outline: "none",
    minHeight: "200px",
  },
  draftActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--space-3)",
    paddingTop: "var(--space-2)",
  },
  draftCancelBtn: {
    padding: "10px 28px",
    border: "1px solid var(--border-default)",
    background: "none",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--font-base)",
    fontWeight: 500,
    color: "var(--text-secondary)",
    cursor: "pointer",
    transition: "all 150ms ease",
  },
  draftSendBtn: {
    padding: "10px 28px",
    border: "none",
    background: "var(--brand-500)",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--font-base)",
    fontWeight: 500,
    color: "var(--text-on-brand)",
    cursor: "pointer",
    transition: "all 150ms ease",
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--space-2)",
  },
}