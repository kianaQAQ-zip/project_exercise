import { useState, useEffect, useRef, useCallback } from "react"
import type { DocumentItem } from "../types"
import { knowledgeAPI } from "../services/api"
import { useToast } from "../hooks/useToast"
import ToastContainer from "../components/ToastContainer"

const DEPARTMENT_ID = "default_dept"
const PAGE_SIZE = 10

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(iso: string): { relative: string; absolute: string } {
  const date = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  let relative: string
  if (seconds < 60) relative = "刚刚"
  else if (minutes < 60) relative = `${minutes} 分钟前`
  else if (hours < 24) relative = `${hours} 小时前`
  else relative = `${days} 天前`

  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  const h = String(date.getHours()).padStart(2, "0")
  const min = String(date.getMinutes()).padStart(2, "0")
  const absolute = `${y}-${m}-${d} ${h}:${min}`

  return { relative, absolute }
}

const STATUS_CONFIG: Record<DocumentItem["status"], { color: string; bg: string; label: string }> = {
  COMPLETED: { color: "#2DAF7F", bg: "#EDF8F3", label: "就绪" },
  PROCESSING: { color: "#2B5AED", bg: "#EBF0FF", label: "处理中" },
  PENDING: { color: "#A0A4B0", bg: "#F2F3F5", label: "等待中" },
  FAILED: { color: "#E84C3D", bg: "#FEF0EF", label: "失败" },
}

const MIME_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/msword": "Word",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "application/vnd.ms-excel": "Excel",
  "text/markdown": "Markdown",
  "text/plain": "文本",
}

function getTypeLabel(mime: string): string {
  return MIME_LABELS[mime] || mime.split("/")[1] || mime
}

export default function KnowledgeView() {
  const { toasts, addToast, removeToast } = useToast()

  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadFile, setUploadFile] = useState<{ name: string; size: number } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DocumentItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [categories, setCategories] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>("")
  const [newCategory, setNewCategory] = useState<string>("")
  const [showCategoryInput, setShowCategoryInput] = useState(false)
  const [verifying, setVerifying] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchDocuments = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await knowledgeAPI.list(DEPARTMENT_ID, page, PAGE_SIZE, selectedCategory || undefined)
      if (res.code === 200) {
        setDocuments(res.data as DocumentItem[])
        setTotal(res.total)
      } else {
        setError(res.message || "加载文档列表失败")
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "加载文档列表失败")
    } finally {
      setLoading(false)
    }
  }, [page, selectedCategory])

  const fetchCategories = useCallback(async () => {
    try {
      const res = await knowledgeAPI.categories(DEPARTMENT_ID)
      if (res.code === 200 && res.data) {
        setCategories(res.data)
      }
    } catch {
      // 静默失败
    }
  }, [])

  useEffect(() => {
    fetchDocuments()
    fetchCategories()
  }, [fetchDocuments, fetchCategories])

  const handleUpload = async (file: File) => {
    if (!file) return
    setUploadFile({ name: file.name, size: file.size })
    setUploading(true)
    setUploadProgress(0)
    const progressInterval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 90) {
          clearInterval(progressInterval)
          return 90
        }
        return prev + Math.random() * 15
      })
    }, 200)
    try {
      const res = await knowledgeAPI.upload(file, DEPARTMENT_ID, newCategory || undefined)
      clearInterval(progressInterval)
      if (res.code === 202 || res.code === 200) {
        setUploadProgress(100)
        addToast("success", "上传成功")
        setPage(1)
        setNewCategory("")
        setShowCategoryInput(false)
        await fetchDocuments()
        await fetchCategories()
      } else {
        addToast("error", res.message || "上传失败")
      }
    } catch (e: unknown) {
      clearInterval(progressInterval)
      addToast("error", e instanceof Error ? e.message : "上传失败")
    } finally {
      setTimeout(() => {
        setUploading(false)
        setUploadProgress(0)
        setUploadFile(null)
      }, 500)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleUpload(file)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleUpload(file)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await knowledgeAPI.delete(deleteTarget.id)
      if (res.code === 200) {
        addToast("success", "删除成功")
        setDeleteTarget(null)
        await fetchDocuments()
        await fetchCategories()
      } else {
        addToast("error", res.message || "删除失败")
      }
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : "删除失败")
    } finally {
      setDeleting(false)
    }
  }

  const handleVerify = async (docId: string) => {
    setVerifying(docId)
    try {
      const res = await knowledgeAPI.verify(docId)
      if (res.code === 200 && res.data) {
        const d = res.data
        const statusEmoji = d.pipeline_healthy ? "OK" : "FAIL"
        addToast(
          d.pipeline_healthy ? "success" : "warning",
          `[${statusEmoji}] ${d.filename} | 状态: ${d.status} | 分块: ${d.chunk_count} | 向量已嵌入: ${d.vector_embedded}`
        )
      }
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : "验证失败")
    } finally {
      setVerifying(null)
    }
  }

  const filteredDocs = documents.filter((d) =>
    d.filename.toLowerCase().includes(search.toLowerCase())
  )

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const handlePageChange = (p: number) => {
    if (p < 1 || p > totalPages) return
    setPage(p)
  }

  const pageNumbers: number[] = []
  const maxVisible = 5
  let start = Math.max(1, page - Math.floor(maxVisible / 2))
  let end = Math.min(totalPages, start + maxVisible - 1)
  if (end - start + 1 < maxVisible) {
    start = Math.max(1, end - maxVisible + 1)
  }
  for (let i = start; i <= end; i++) {
    pageNumbers.push(i)
  }

  return (
    <div style={styles.wrapper}>
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <h1 style={styles.title}>知识库管理</h1>
      <p style={styles.subtitle}>管理企业文档，构建智能知识体系</p>

      <div style={styles.actionBar}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <button
            style={styles.uploadBtn}
            onClick={() => fileInputRef.current?.click()}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.filter = "brightness(0.9)"
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.filter = "brightness(1)"
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: "var(--space-2)" }}>
              <path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            上传文档
          </button>
          {!showCategoryInput ? (
            <button
              style={styles.categoryBtn}
              onClick={() => setShowCategoryInput(true)}
              title="上传时添加分类"
            >
              + 分类
            </button>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
              <input
                type="text"
                placeholder="输入分类名..."
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                style={styles.categoryInput}
                onKeyDown={(e) => { if (e.key === "Enter") setShowCategoryInput(false) }}
              />
              <button
                style={styles.categoryOkBtn}
                onClick={() => setShowCategoryInput(false)}
              >
                OK
              </button>
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          {categories.length > 0 && (
            <select
              value={selectedCategory}
              onChange={(e) => { setSelectedCategory(e.target.value); setPage(1) }}
              style={styles.categorySelect}
            >
              <option value="">全部分类</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
          <div style={styles.searchWrap}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={styles.searchIcon}>
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="搜索文档..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={styles.searchInput}
              onFocus={(e) => {
                e.target.style.borderColor = "var(--border-focus)"
                e.target.style.boxShadow = "0 0 0 3px var(--brand-50)"
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "var(--border-default)"
                e.target.style.boxShadow = "none"
              }}
            />
          </div>
        </div>
      </div>

      <div
        style={{
          ...styles.dropZone,
          borderColor: dragOver ? "var(--border-focus)" : "var(--border-default)",
          background: dragOver ? "var(--brand-50)" : "var(--bg-card)",
        }}
        onClick={() => fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {uploading && uploadFile ? (
          <div style={styles.uploadingInfo}>
            <p style={styles.uploadFileName}>{uploadFile.name}</p>
            <p style={styles.uploadFileSize}>{formatFileSize(uploadFile.size)}</p>
            <div style={styles.progressTrack}>
              <div style={{ ...styles.progressBar, width: `${uploadProgress}%` }} />
            </div>
            <p style={styles.progressText}>{Math.round(uploadProgress)}%</p>
          </div>
        ) : (
          <>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginBottom: "var(--space-4)" }}>
              <path d="M24 4v26M13 18l11-11 11 11" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M8 32v6a4 4 0 004 4h24a4 4 0 004-4v-6" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p style={styles.dropText}>拖拽文件到此处，或点击上传</p>
            <p style={styles.dropHint}>支持 PDF、Word、Excel、Markdown 格式，单文件上限 50MB</p>
            {newCategory && (
              <p style={{ ...styles.dropHint, color: "var(--brand-500)", marginTop: "var(--space-1)" }}>
                分类: {newCategory}
              </p>
            )}
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.doc,.xlsx,.xls,.md,.txt"
          onChange={handleFileChange}
          style={styles.hiddenInput}
        />
      </div>

      <div style={styles.listHeader}>
        <span style={{ ...styles.listHeaderCell, flex: 2.5 }}>文件名</span>
        <span style={{ ...styles.listHeaderCell, flex: 1 }}>分类</span>
        <span style={{ ...styles.listHeaderCell, flex: 0.8 }}>类型</span>
        <span style={{ ...styles.listHeaderCell, flex: 0.8 }}>大小</span>
        <span style={{ ...styles.listHeaderCell, flex: 0.8 }}>状态</span>
        <span style={{ ...styles.listHeaderCell, flex: 1.2 }}>时间</span>
        <span style={{ ...styles.listHeaderCell, flex: 1.5 }}>操作</span>
      </div>

      {loading ? (
        <div style={styles.listBody}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={styles.skeletonRow}>
              <div className="skeleton" style={{ ...styles.skeletonBlock, flex: 2.5 }} />
              <div className="skeleton" style={{ ...styles.skeletonBlock, flex: 1 }} />
              <div className="skeleton" style={{ ...styles.skeletonBlock, flex: 0.8 }} />
              <div className="skeleton" style={{ ...styles.skeletonBlock, flex: 0.8 }} />
              <div className="skeleton" style={{ ...styles.skeletonBlock, flex: 0.8 }} />
              <div className="skeleton" style={{ ...styles.skeletonBlock, flex: 1.2 }} />
              <div className="skeleton" style={{ ...styles.skeletonBlock, flex: 1.5 }} />
            </div>
          ))}
        </div>
      ) : error ? (
        <div style={styles.emptyState}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginBottom: "var(--space-4)" }}>
            <circle cx="24" cy="24" r="22" stroke="var(--semantic-error)" strokeWidth="2" />
            <path d="M24 16v12M24 32v2" stroke="var(--semantic-error)" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p style={styles.emptyTitle}>{error}</p>
          <button
            style={styles.retryBtn}
            onClick={() => { setPage(1); fetchDocuments() }}
          >
            重新加载
          </button>
        </div>
      ) : filteredDocs.length === 0 ? (
        <div style={styles.emptyState}>
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginBottom: "var(--space-4)" }}>
            <path d="M16 8h22l12 12v36a4 4 0 01-4 4H18a4 4 0 01-4-4V12a4 4 0 014-4z" stroke="var(--text-tertiary)" strokeWidth="2" />
            <path d="M38 8v10a2 2 0 002 2h10" stroke="var(--text-tertiary)" strokeWidth="2" />
            <path d="M22 28h20M22 36h20M22 44h12" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p style={styles.emptyTitle}>暂无文档</p>
          <p style={styles.emptyHint}>上传您的第一个文档开始构建知识库</p>
        </div>
      ) : (
        <div style={styles.listBody}>
          {filteredDocs.map((doc) => {
            const config = STATUS_CONFIG[doc.status]
            const time = formatTime(doc.updated_at)
            return (
              <div key={doc.id} style={styles.docCard}>
                <div style={{ ...styles.docCell, flex: 2.5, minWidth: 0 }}>
                  <div style={styles.docName}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0, marginRight: "var(--space-2)" }}>
                      <path d="M3 1h7l4 4v9a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="var(--text-tertiary)" strokeWidth="1.2" />
                      <path d="M10 1v3.5a.5.5 0 00.5.5H14" stroke="var(--text-tertiary)" strokeWidth="1.2" />
                    </svg>
                    <span style={styles.docNameText} title={doc.filename}>{doc.filename}</span>
                  </div>
                </div>
                <div style={{ ...styles.docCell, flex: 1, color: doc.category ? "var(--brand-500)" : "var(--text-tertiary)" }}>
                  {doc.category || "-"}
                </div>
                <div style={{ ...styles.docCell, flex: 0.8, color: "var(--text-secondary)" }}>
                  {getTypeLabel(doc.mime_type)}
                </div>
                <div style={{ ...styles.docCell, flex: 0.8, color: "var(--text-secondary)" }}>
                  {formatFileSize(doc.file_size)}
                </div>
                <div style={{ ...styles.docCell, flex: 0.8 }}>
                  <span
                    style={{
                      ...styles.statusBadge,
                      color: config.color,
                      background: config.bg,
                    }}
                  >
                    {doc.status === "PROCESSING" && (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        style={{
                          animation: "spin 0.8s linear infinite",
                          marginRight: "var(--space-1)",
                          verticalAlign: "middle",
                        }}
                      >
                        <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="2" strokeDasharray="25 12" />
                      </svg>
                    )}
                    {config.label}
                  </span>
                  {doc.error_msg && (
                    <p style={styles.errorMsg} title={doc.error_msg}>{doc.error_msg}</p>
                  )}
                </div>
                <div style={{ ...styles.docCell, flex: 1.2 }}>
                  <span style={styles.timeText} title={time.absolute}>{time.relative}</span>
                </div>
                <div style={{ ...styles.docCell, flex: 1.5, gap: "var(--space-1)" }}>
                  <button
                    style={styles.verifyBtn}
                    onClick={(e) => { e.stopPropagation(); handleVerify(doc.id) }}
                    disabled={verifying === doc.id}
                    onMouseEnter={(e) => {
                      (e.target as HTMLButtonElement).style.background = "rgba(43, 90, 237, 0.05)"
                    }}
                    onMouseLeave={(e) => {
                      (e.target as HTMLButtonElement).style.background = "transparent"
                    }}
                  >
                    {verifying === doc.id ? "验证中..." : "验证"}
                  </button>
                  <button
                    style={styles.deleteBtn}
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(doc) }}
                    onMouseEnter={(e) => {
                      (e.target as HTMLButtonElement).style.background = "rgba(232, 76, 61, 0.05)"
                    }}
                    onMouseLeave={(e) => {
                      (e.target as HTMLButtonElement).style.background = "transparent"
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: "var(--space-1)" }}>
                      <path d="M3 4h8M5.5 4V3a1 1 0 011-1h1a1 1 0 011 1v1M11 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M5.5 7v3M8.5 7v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                    删除
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {totalPages > 1 && !loading && !error && (
        <div style={styles.pagination}>
          <button
            style={{ ...styles.pageBtn, opacity: page <= 1 ? 0.4 : 1, cursor: page <= 1 ? "default" : "pointer" }}
            disabled={page <= 1}
            onClick={() => handlePageChange(page - 1)}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 3L5 7l4 4" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {pageNumbers.map((p) => (
            <button
              key={p}
              style={{
                ...styles.pageBtn,
                background: p === page ? "var(--brand-500)" : "transparent",
                color: p === page ? "var(--text-on-brand)" : "var(--text-secondary)",
              }}
              onClick={() => handlePageChange(p)}
            >
              {p}
            </button>
          ))}
          <button
            style={{ ...styles.pageBtn, opacity: page >= totalPages ? 0.4 : 1, cursor: page >= totalPages ? "default" : "pointer" }}
            disabled={page >= totalPages}
            onClick={() => handlePageChange(page + 1)}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M5 3l4 4-4 4" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}

      {deleteTarget && (
        <div style={styles.modalOverlay} onClick={() => setDeleteTarget(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>确认删除</h3>
            <p style={styles.modalBody}>
              确定要删除文档 <strong>{deleteTarget.filename}</strong> 吗？此操作不可撤销。
            </p>
            <div style={styles.modalActions}>
              <button
                style={styles.modalCancelBtn}
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                取消
              </button>
              <button
                style={styles.modalConfirmBtn}
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    maxWidth: 960,
    margin: "0 auto",
    padding: "var(--space-6) 0",
  },
  title: {
    fontSize: "var(--font-2xl)",
    fontWeight: 600,
    color: "var(--text-primary)",
    marginBottom: "var(--space-1)",
  },
  subtitle: {
    fontSize: "var(--font-base)",
    color: "var(--text-secondary)",
    marginBottom: "var(--space-6)",
  },
  actionBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "var(--space-4)",
    gap: "var(--space-4)",
  },
  uploadBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "var(--space-2) var(--space-5)",
    background: "var(--brand-500)",
    color: "var(--text-on-brand)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--font-base)",
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "filter 150ms ease",
    flexShrink: 0,
  },
  categoryBtn: {
    display: "inline-flex",
    alignItems: "center",
    padding: "var(--space-2) var(--space-3)",
    background: "transparent",
    color: "var(--brand-500)",
    border: "1px dashed var(--brand-500)",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--font-sm)",
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  categoryInput: {
    width: 120,
    padding: "var(--space-1) var(--space-2)",
    fontSize: "var(--font-sm)",
    color: "var(--text-primary)",
    background: "var(--bg-card)",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--radius-sm)",
    outline: "none",
    boxSizing: "border-box" as const,
  },
  categoryOkBtn: {
    padding: "var(--space-1) var(--space-2)",
    background: "var(--brand-500)",
    color: "var(--text-on-brand)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--font-xs)",
    fontWeight: 500,
    cursor: "pointer",
  },
  categorySelect: {
    padding: "var(--space-2) var(--space-3)",
    fontSize: "var(--font-sm)",
    color: "var(--text-primary)",
    background: "var(--bg-card)",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--radius-sm)",
    outline: "none",
    cursor: "pointer",
    minWidth: 120,
  },
  searchWrap: {
    position: "relative",
    width: 280,
  },
  searchIcon: {
    position: "absolute",
    left: "var(--space-3)",
    top: "50%",
    transform: "translateY(-50%)",
    color: "var(--text-tertiary)",
    pointerEvents: "none",
  },
  searchInput: {
    width: "100%",
    padding: "var(--space-2) var(--space-3) var(--space-2) 36px",
    fontSize: "var(--font-sm)",
    color: "var(--text-primary)",
    background: "var(--bg-card)",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--radius-sm)",
    outline: "none",
    transition: "border-color 150ms ease, box-shadow 150ms ease",
    boxSizing: "border-box",
  },
  dropZone: {
    border: "2px dashed var(--border-default)",
    background: "var(--bg-card)",
    borderRadius: "var(--radius-md)",
    padding: "var(--space-8)",
    textAlign: "center",
    cursor: "pointer",
    marginBottom: "var(--space-6)",
    transition: "border-color 200ms ease, background 200ms ease",
  },
  dropText: {
    fontSize: "var(--font-base)",
    color: "var(--text-primary)",
    fontWeight: 500,
    marginBottom: "var(--space-1)",
  },
  dropHint: {
    fontSize: "var(--font-sm)",
    color: "var(--text-tertiary)",
  },
  hiddenInput: {
    display: "none",
  },
  uploadingInfo: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "var(--space-2)",
  },
  uploadFileName: {
    fontSize: "var(--font-base)",
    color: "var(--text-primary)",
    fontWeight: 500,
  },
  uploadFileSize: {
    fontSize: "var(--font-sm)",
    color: "var(--text-secondary)",
  },
  progressTrack: {
    width: "100%",
    maxWidth: 300,
    height: 6,
    background: "var(--border-light)",
    borderRadius: "var(--radius-full)",
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    background: "repeating-linear-gradient(-45deg, var(--brand-500), var(--brand-500) 8px, var(--brand-400) 8px, var(--brand-400) 16px)",
    borderRadius: "var(--radius-full)",
    transition: "width 200ms ease",
    animation: "shimmer 1s linear infinite",
    backgroundSize: "200% 100%",
  },
  progressText: {
    fontSize: "var(--font-sm)",
    color: "var(--brand-500)",
    fontWeight: 500,
  },
  listHeader: {
    display: "flex",
    alignItems: "center",
    padding: "var(--space-2) var(--space-4)",
    borderBottom: "1px solid var(--border-default)",
    marginBottom: 0,
  },
  listHeaderCell: {
    fontSize: "var(--font-xs)",
    fontWeight: 600,
    color: "var(--text-tertiary)",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  listBody: {
    display: "flex",
    flexDirection: "column",
  },
  docCard: {
    display: "flex",
    alignItems: "center",
    padding: "var(--space-3) var(--space-4)",
    background: "var(--bg-card)",
    borderRadius: "var(--radius-sm)",
    marginBottom: "var(--space-1)",
    boxShadow: "var(--shadow-sm)",
    cursor: "default",
  },
  docCell: {
    display: "flex",
    alignItems: "center",
    fontSize: "var(--font-sm)",
  },
  docName: {
    display: "flex",
    alignItems: "center",
    minWidth: 0,
  },
  docNameText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-primary)",
    fontWeight: 500,
  },
  statusBadge: {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px var(--space-2)",
    borderRadius: "var(--radius-full)",
    fontSize: "var(--font-xs)",
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  errorMsg: {
    fontSize: "var(--font-xs)",
    color: "var(--semantic-error)",
    marginTop: 2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 120,
  },
  timeText: {
    fontSize: "var(--font-xs)",
    color: "var(--text-tertiary)",
    whiteSpace: "nowrap",
  },
  deleteBtn: {
    display: "inline-flex",
    alignItems: "center",
    padding: "var(--space-1) var(--space-2)",
    border: "none",
    background: "transparent",
    color: "var(--semantic-error)",
    fontSize: "var(--font-xs)",
    fontWeight: 500,
    cursor: "pointer",
    borderRadius: "var(--radius-sm)",
    transition: "background 150ms ease",
    whiteSpace: "nowrap",
  },
  verifyBtn: {
    display: "inline-flex",
    alignItems: "center",
    padding: "var(--space-1) var(--space-2)",
    border: "none",
    background: "transparent",
    color: "var(--brand-500)",
    fontSize: "var(--font-xs)",
    fontWeight: 500,
    cursor: "pointer",
    borderRadius: "var(--radius-sm)",
    transition: "background 150ms ease",
    whiteSpace: "nowrap",
  },
  skeletonRow: {
    display: "flex",
    alignItems: "center",
    padding: "var(--space-3) var(--space-4)",
    gap: "var(--space-4)",
  },
  skeletonBlock: {
    height: 16,
    borderRadius: "var(--radius-sm)",
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "var(--space-12) var(--space-6)",
    textAlign: "center",
  },
  emptyTitle: {
    fontSize: "var(--font-lg)",
    color: "var(--text-primary)",
    fontWeight: 500,
    marginBottom: "var(--space-2)",
  },
  emptyHint: {
    fontSize: "var(--font-sm)",
    color: "var(--text-tertiary)",
  },
  retryBtn: {
    marginTop: "var(--space-4)",
    padding: "var(--space-2) var(--space-5)",
    background: "var(--brand-500)",
    color: "var(--text-on-brand)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--font-sm)",
    fontWeight: 500,
    cursor: "pointer",
  },
  pagination: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: "var(--space-1)",
    marginTop: "var(--space-6)",
  },
  pageBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 32,
    height: 32,
    padding: "0 var(--space-2)",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--radius-sm)",
    background: "transparent",
    fontSize: "var(--font-sm)",
    color: "var(--text-secondary)",
    cursor: "pointer",
    transition: "background 150ms ease, color 150ms ease",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "var(--bg-overlay)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    background: "var(--bg-card)",
    borderRadius: "var(--radius-md)",
    padding: "var(--space-6)",
    maxWidth: 420,
    width: "100%",
    boxShadow: "var(--shadow-lg)",
  },
  modalTitle: {
    fontSize: "var(--font-lg)",
    fontWeight: 600,
    color: "var(--text-primary)",
    marginBottom: "var(--space-3)",
  },
  modalBody: {
    fontSize: "var(--font-base)",
    color: "var(--text-secondary)",
    lineHeight: 1.6,
    marginBottom: "var(--space-6)",
  },
  modalActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "var(--space-3)",
  },
  modalCancelBtn: {
    padding: "var(--space-2) var(--space-5)",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--radius-sm)",
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: "var(--font-sm)",
    fontWeight: 500,
    cursor: "pointer",
  },
  modalConfirmBtn: {
    padding: "var(--space-2) var(--space-5)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    background: "var(--semantic-error)",
    color: "#FFFFFF",
    fontSize: "var(--font-sm)",
    fontWeight: 500,
    cursor: "pointer",
  },
}