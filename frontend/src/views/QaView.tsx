import { useState, useRef, useEffect, useCallback } from "react"
import type { ChatMessage, Citation, ConversationItem } from "../types"
import { qaAPI, conversationAPI } from "../services/api"
import { useToast } from "../hooks/useToast"
import ToastContainer from "../components/ToastContainer"
import { useTheme } from "../contexts/ThemeContext"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import "highlight.js/styles/github.css"
import { Document, Packer, Paragraph, HeadingLevel } from "docx"
import * as XLSX from "xlsx"

const SIDEBAR_WIDTH = 280
const CITATION_PANEL_WIDTH = 320
const CHAT_MAX_WIDTH = 800

// 推荐问题
const SUGGESTED_QUESTIONS = [
  "请帮我总结知识库中的关键文档",
  "最近有哪些新的项目进展？",
  "帮我写一份工作周报模板",
  "介绍一下公司的核心业务",
]

// ============= 时间分组工具 =============
function getTimeGroup(updatedAt?: string): string {
  if (!updatedAt) return "更早"
  const d = new Date(updatedAt)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return "今天"
  if (diffDays === 1) return "昨天"
  if (diffDays <= 7) return "7天内"
  if (diffDays <= 30) return "30天内"
  return "更早"
}

function groupConversations(convs: ConversationItem[]): Map<string, ConversationItem[]> {
  const groups = new Map<string, ConversationItem[]>()
  const order = ["今天", "昨天", "7天内", "30天内", "更早"]
  for (const key of order) groups.set(key, [])
  for (const conv of convs) {
    const group = getTimeGroup(conv.updated_at)
    groups.get(group)?.push(conv)
  }
  // 移除空分组
  for (const key of order) {
    if (groups.get(key)?.length === 0) groups.delete(key)
  }
  return groups
}

// ============= 类型定义 =============
interface ExportMenuState {
  messageId: string
  content: string
  x: number
  y: number
}

// ============= 工具函数 =============
function formatTime(ts: string): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 检测内容是否为纯表格（含 Markdown 表格） */
function isTableContent(content: string): boolean {
  const lines = content.trim().split("\n").filter((l) => l.trim())
  if (lines.length < 2) return false
  const tableLines = lines.filter((l) => /^\|.*\|$/.test(l.trim()))
  return tableLines.length >= 2 && tableLines.length >= lines.length * 0.7
}

/** 将 Markdown 表格解析为二维数组 */
function parseMarkdownTable(content: string): string[][] {
  const lines = content.trim().split("\n").filter((l) => l.trim().startsWith("|"))
  const data: string[][] = []
  for (const line of lines) {
    if (/^\|[\s\-:|]+\|$/.test(line.trim())) continue // 跳过分隔行
    const cells = line.trim().split("|").filter((c) => c.trim()).map((c) => c.trim())
    if (cells.length > 0) data.push(cells)
  }
  return data
}

/** 导出为 Markdown 文件 */
function exportAsMarkdown(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" })
  downloadBlob(blob, `${filename}.md`)
}

/** 导出为 Word 文件 */
async function exportAsWord(content: string, filename: string) {
  const lines = content.split("\n")
  const children: Paragraph[] = []
  for (const line of lines) {
    if (line.startsWith("### ")) {
      children.push(new Paragraph({ text: line.replace("### ", ""), heading: HeadingLevel.HEADING_3, spacing: { before: 12, after: 6 } }))
    } else if (line.startsWith("## ")) {
      children.push(new Paragraph({ text: line.replace("## ", ""), heading: HeadingLevel.HEADING_2, spacing: { before: 14, after: 8 } }))
    } else if (line.startsWith("# ")) {
      children.push(new Paragraph({ text: line.replace("# ", ""), heading: HeadingLevel.HEADING_1, spacing: { before: 16, after: 10 } }))
    } else if (line.trim().startsWith("- ")) {
      children.push(new Paragraph({ text: `  ${line.trim()}`, spacing: { after: 2 } }))
    } else if (line.trim().startsWith("1. ")) {
      children.push(new Paragraph({ text: `  ${line.trim()}`, spacing: { after: 2 } }))
    } else if (line.trim() === "") {
      children.push(new Paragraph({ text: "", spacing: { after: 4 } }))
    } else {
      children.push(new Paragraph({ text: line.trim(), spacing: { after: 2 } }))
    }
  }
  const doc = new Document({
    sections: [{
      properties: {},
      children: children.length > 0 ? children : [new Paragraph({ text: content })],
    }],
  })
  const blob = await Packer.toBlob(doc)
  downloadBlob(blob, `${filename}.docx`)
}

/** 导出为 Excel 文件 */
function exportAsExcel(content: string, filename: string) {
  const data = parseMarkdownTable(content)
  const ws = XLSX.utils.aoa_to_sheet(data)
  // 设置列宽
  if (data.length > 0) {
    ws["!cols"] = data[0].map(() => ({ wch: 20 }))
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ============= 样式 =============
const styles: Record<string, React.CSSProperties> = {
  page: { display: "flex", height: "calc(100vh - var(--statusbar-height) - 48px)", background: "#f9f9fb" },
  // 侧边栏
  sidebar: {
    width: SIDEBAR_WIDTH, flexShrink: 0, background: "#f9f9fb",
    borderRight: "1px solid #e8e8ed", display: "flex", flexDirection: "column", overflow: "hidden",
  },
  sidebarLogo: {
    padding: "16px 16px 12px", display: "flex", alignItems: "center", gap: "8px",
    fontSize: "18px", fontWeight: 700, color: "#1a1a2e",
  },
  sidebarLogoIcon: {
    width: 32, height: 32, borderRadius: "8px", background: "linear-gradient(135deg, #0066CC 0%, #4D94FF 100%)",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  sidebarNewChatBtn: {
    display: "flex", alignItems: "center", gap: "8px", margin: "0 12px 12px",
    padding: "10px 16px", borderRadius: "10px", border: "1px solid #dde0e8",
    background: "#fff", color: "#1a1a2e", fontSize: "14px", fontWeight: 500,
    cursor: "pointer", transition: "all 150ms ease",
  },
  sidebarList: { flex: 1, overflowY: "auto" as const, padding: "0 8px" },
  sidebarGroupTitle: {
    padding: "16px 12px 6px", fontSize: "11px", fontWeight: 600,
    color: "#8e8ea0", textTransform: "uppercase" as const, letterSpacing: "0.5px",
  },
  sidebarItem: {
    display: "flex", alignItems: "center", padding: "8px 12px", borderRadius: "8px",
    cursor: "pointer", transition: "background 120ms ease", gap: "8px", minHeight: 36,
    fontSize: "13px", color: "#333",
  },
  sidebarItemActive: { background: "#e8edf5", color: "#0066CC" },
  sidebarItemIcon: {
    width: 16, height: 16, flexShrink: 0, color: "#999",
  },
  sidebarItemTitle: {
    flex: 1, overflow: "hidden" as const, textOverflow: "ellipsis" as const, whiteSpace: "nowrap" as const, minWidth: 0,
  },
  sidebarItemDelete: {
    width: 20, height: 20, flexShrink: 0, cursor: "pointer", color: "#bbb",
    opacity: 0, transition: "opacity 150ms ease, color 150ms ease", border: "none",
    background: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center",
    borderRadius: "4px",
  },
  sidebarBottom: {
    padding: "12px 16px", borderTop: "1px solid #e8e8ed", display: "flex",
    alignItems: "center", justifyContent: "space-between",
  },
  sidebarBottomIcons: { display: "flex", gap: "4px" },
  sidebarBottomIcon: {
    width: 32, height: 32, borderRadius: "6px", border: "none", background: "transparent",
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    color: "#8e8ea0", transition: "background 150ms ease, color 150ms ease",
  },
  sidebarVersion: { fontSize: "11px", color: "#bbb" },
  // 右侧主区域
  mainArea: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "#fff" },
  // 顶部栏
  topBar: {
    padding: "12px 20px", flexShrink: 0, display: "flex", alignItems: "center",
    justifyContent: "space-between", borderBottom: "1px solid #f0f0f5",
    background: "#fff",
  },
  topBarLeft: { display: "flex", alignItems: "center", gap: "8px" },
  topBarTitle: {
    fontSize: "15px", fontWeight: 600, color: "#1a1a2e", maxWidth: 400,
    overflow: "hidden" as const, textOverflow: "ellipsis" as const, whiteSpace: "nowrap" as const,
  },
  topBarIcons: { display: "flex", gap: "4px" },
  topBarIcon: {
    width: 36, height: 36, borderRadius: "8px", border: "none", background: "transparent",
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    color: "#8e8ea0", transition: "background 150ms ease, color 150ms ease",
  },
  // 聊天区域
  chatWrapper: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "#fff" },
  chatArea: {
    flex: 1, overflowY: "auto" as const, padding: "24px 20px",
    display: "flex", flexDirection: "column",
  },
  chatInner: {
    maxWidth: CHAT_MAX_WIDTH, width: "100%", margin: "0 auto",
    display: "flex", flexDirection: "column", gap: "20px",
  },
  emptyState: {
    flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", gap: "12px", padding: "40px",
    maxWidth: 520, margin: "0 auto",
  },
  emptyLogo: {
    width: 56, height: 56, borderRadius: "14px", background: "linear-gradient(135deg, #0066CC 0%, #4D94FF 100%)",
    display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 4px 20px rgba(0,102,204,0.2)",
  },
  emptyWelcome: { fontSize: "18px", fontWeight: 600, color: "#1a1a2e", margin: 0, textAlign: "center" as const },
  emptyHint: { fontSize: "13px", color: "#999", margin: 0, textAlign: "center" as const, lineHeight: 1.6 },
  suggestions: {
    display: "flex", flexWrap: "wrap" as const, gap: "8px", justifyContent: "center",
    maxWidth: 480, marginTop: "8px",
  },
  suggestionChip: {
    padding: "8px 16px", fontSize: "13px", color: "#555",
    background: "#f9f9fb", border: "1px solid #e8e8ed", borderRadius: "20px",
    cursor: "pointer", transition: "all 150ms ease", whiteSpace: "nowrap" as const,
  },
  // 消息
  msgRow: { display: "flex", width: "100%", alignItems: "flex-start" },
  msgRowUser: { justifyContent: "flex-end" },
  msgRowAssistant: { justifyContent: "flex-start" },
  msgAvatar: {
    width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "11px", fontWeight: 600,
  },
  msgAvatarUser: { background: "#e0ecff", color: "#0066CC", marginLeft: "10px", order: 2 },
  msgAvatarAI: { background: "linear-gradient(135deg, #0066CC 0%, #4D94FF 100%)", color: "#fff", marginRight: "10px" },
  msgBody: { display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 },
  msgBubble: {
    padding: "10px 14px", fontSize: "14px", lineHeight: 1.7, wordBreak: "break-word" as const,
    maxWidth: "100%",
  },
  msgBubbleUser: {
    background: "#e0ecff", color: "#1a1a2e", borderRadius: "12px",
    whiteSpace: "pre-wrap" as const,
  },
  msgBubbleAssistant: { background: "transparent", color: "#1a1a2e", borderRadius: "12px" },
  msgTimestamp: { fontSize: "11px", color: "#bbb", padding: "0 4px" },
  msgTimestampUser: { textAlign: "right" as const },
  msgTimestampAssistant: { textAlign: "left" as const },
  cursor: {
    display: "inline-block", width: 2, height: "1.1em", background: "#0066CC",
    marginLeft: 2, verticalAlign: "text-bottom",
  },
  // 引用徽章
  citationBadge: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 18, height: 18,
    padding: "0 4px", borderRadius: "50%", background: "#0066CC",
    color: "#fff", fontSize: "10px", fontWeight: 600, cursor: "pointer",
    margin: "0 2px", verticalAlign: "middle", border: "none", lineHeight: 1,
    transition: "transform 150ms ease, box-shadow 150ms ease",
  },
  // 输入区域
  inputArea: {
    flexShrink: 0, background: "#fff", borderTop: "1px solid #f0f0f5",
    padding: "12px 20px 16px",
  },
  inputInner: {
    maxWidth: CHAT_MAX_WIDTH, margin: "0 auto", display: "flex", alignItems: "flex-end", gap: "10px",
  },
  textareaWrap: { flex: 1, position: "relative" as const },
  textarea: {
    width: "100%", minHeight: 44, maxHeight: 120, padding: "10px 16px",
    border: "1px solid #dde0e8", borderRadius: "12px", fontSize: "14px",
    lineHeight: 1.5, color: "#1a1a2e", background: "#f9f9fb",
    resize: "none" as const, outline: "none", fontFamily: "inherit",
    transition: "border-color 200ms ease, box-shadow 200ms ease",
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: "10px", background: "#0066CC",
    border: "none", cursor: "pointer", display: "flex", alignItems: "center",
    justifyContent: "center", flexShrink: 0, transition: "opacity 200ms ease, background 200ms ease, transform 150ms ease", padding: 0,
  },
  sendBtnDisabled: { opacity: 0.4, cursor: "not-allowed" },
  spinner: {
    width: 18, height: 18, border: "2px solid #fff",
    borderTopColor: "transparent", borderRadius: "50%",
  },
  // 引用面板
  citationPanel: {
    width: CITATION_PANEL_WIDTH, flexShrink: 0, background: "#fff",
    borderLeft: "1px solid #e8e8ed", display: "flex", flexDirection: "column" as const, overflow: "hidden",
  },
  citationPanelHeader: {
    padding: "16px", borderBottom: "1px solid #e8e8ed",
    display: "flex", alignItems: "center", justifyContent: "space-between",
  },
  citationPanelTitle: { fontSize: "16px", fontWeight: 600, color: "#1a1a2e", margin: 0 },
  citationPanelClose: {
    width: 28, height: 28, borderRadius: "6px", border: "none", background: "none",
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    color: "#8e8ea0", transition: "background 150ms ease, color 150ms ease",
  },
  citationPanelList: {
    flex: 1, overflowY: "auto" as const, padding: "12px 16px",
    display: "flex", flexDirection: "column", gap: "12px",
  },
  citationCard: {
    padding: "12px", borderRadius: "8px", border: "1px solid #e8e8ed",
    background: "#fff", cursor: "default", transition: "transform 150ms ease, box-shadow 150ms ease",
  },
  citationCardIndex: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20,
    borderRadius: "50%", background: "#e0ecff", color: "#0066CC",
    fontSize: "11px", fontWeight: 600, marginRight: "8px", flexShrink: 0,
  },
  citationCardDocName: {
    fontSize: "13px", fontWeight: 600, color: "#1a1a2e",
    marginBottom: "4px", display: "flex", alignItems: "center",
  },
  citationCardPath: { fontSize: "11px", color: "#8e8ea0", marginBottom: "8px" },
  citationCardSnippet: { fontSize: "12px", color: "#555", lineHeight: 1.5 },
  citationToggleBtn: {
    width: 36, height: 36, borderRadius: "50%", border: "1px solid #dde0e8",
    background: "#fff", cursor: "pointer", display: "flex", alignItems: "center",
    justifyContent: "center", color: "#8e8ea0", flexShrink: 0, transition: "background 150ms ease", padding: 0,
  },
  citationToggleActive: { background: "#e0ecff", color: "#0066CC", borderColor: "#0066CC" },
  // 弹出层
  popoverOverlay: { position: "fixed" as const, top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 },
  popoverCard: {
    position: "fixed" as const, zIndex: 1001, background: "#fff",
    borderRadius: "10px", boxShadow: "0 8px 32px rgba(0,0,0,0.12)", padding: "16px",
    maxWidth: 360, minWidth: 260,
  },
  popoverDocName: { fontSize: "13px", fontWeight: 600, color: "#1a1a2e", marginBottom: "4px" },
  popoverPath: { fontSize: "11px", color: "#8e8ea0", marginBottom: "12px" },
  popoverSnippet: { fontSize: "13px", color: "#555", lineHeight: 1.5 },
  // 导出菜单
  exportBtn: {
    opacity: 0, width: 28, height: 28, borderRadius: "6px", border: "none",
    background: "transparent", cursor: "pointer", display: "inline-flex", alignItems: "center",
    justifyContent: "center", color: "#8e8ea0", transition: "opacity 150ms ease, background 150ms ease, color 150ms ease",
    padding: 0, flexShrink: 0, marginLeft: "4px",
  },
  exportMenu: {
    position: "fixed" as const, zIndex: 1002, background: "#fff",
    borderRadius: "10px", boxShadow: "0 8px 32px rgba(0,0,0,0.12)", padding: "4px",
    minWidth: 140, border: "1px solid #e8e8ed",
  },
  exportMenuItem: {
    display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px",
    fontSize: "13px", color: "#1a1a2e", cursor: "pointer",
    borderRadius: "6px", border: "none", background: "none", width: "100%",
    transition: "background 150ms ease",
  },
}

// ============= Markdown 渲染组件 =============
function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="markdown-body" style={{ fontSize: "var(--font-base)", lineHeight: 1.7 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // 自定义表格样式
          table: ({ children, ...props }) => (
            <div style={{ overflowX: "auto", margin: "12px 0" }}>
              <table
                style={{
                  width: "100%", borderCollapse: "collapse", fontSize: "var(--font-sm)",
                  border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)", overflow: "hidden",
                }}
                {...props}
              >
                {children}
              </table>
            </div>
          ),
          thead: ({ children, ...props }) => (
            <thead style={{ background: "var(--bg-hover, #F3F4F6)" }} {...props}>{children}</thead>
          ),
          th: ({ children, ...props }) => (
            <th
              style={{
                padding: "8px 12px", textAlign: "left", fontWeight: 600,
                borderBottom: "2px solid var(--border-default)", color: "var(--text-primary)",
              }}
              {...props}
            >
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td
              style={{
                padding: "8px 12px", borderBottom: "1px solid var(--border-default)",
                color: "var(--text-secondary)",
              }}
              {...props}
            >
              {children}
            </td>
          ),
          // 代码块样式
          code: ({ className, children, ...props }) => {
            const isInline = !className
            if (isInline) {
              return (
                <code
                  style={{
                    background: "var(--bg-hover, #F3F4F6)", padding: "2px 6px",
                    borderRadius: "var(--radius-xs)", fontSize: "0.9em", color: "var(--brand-600, #E84C3F)",
                  }}
                  {...props}
                >
                  {children}
                </code>
              )
            }
            return (
              <div style={{ position: "relative", margin: "12px 0" }}>
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "6px 12px", background: "var(--bg-hover, #F3F4F6)",
                  borderBottom: "1px solid var(--border-default)", borderRadius: "var(--radius-sm) var(--radius-sm) 0 0",
                  fontSize: "var(--font-xs)", color: "var(--text-tertiary)",
                }}>
                  <span>{className?.replace("language-", "") || "code"}</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(String(children).replace(/\n$/, ""))}
                    style={{
                      border: "none", background: "none", cursor: "pointer",
                      color: "var(--text-tertiary)", padding: "2px 4px", borderRadius: "var(--radius-xs)",
                      fontSize: "var(--font-xs)",
                    }}
                    title="复制代码"
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--brand-500)" }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-tertiary)" }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                    </svg>
                  </button>
                </div>
                <pre style={{
                  margin: 0, padding: "12px 16px", overflow: "auto",
                  background: "#FAFBFC", borderBottomLeftRadius: "var(--radius-sm)",
                  borderBottomRightRadius: "var(--radius-sm)", fontSize: "var(--font-sm)", lineHeight: 1.5,
                }}>
                  <code className={className} {...props}>{children}</code>
                </pre>
              </div>
            )
          },
          // 标题样式
          h1: ({ children, ...props }) => (
            <h1 style={{ fontSize: "1.5em", fontWeight: 700, margin: "16px 0 8px", color: "var(--text-primary)" }} {...props}>{children}</h1>
          ),
          h2: ({ children, ...props }) => (
            <h2 style={{ fontSize: "1.3em", fontWeight: 600, margin: "14px 0 6px", paddingBottom: "4px", borderBottom: "1px solid var(--border-default)", color: "var(--text-primary)" }} {...props}>{children}</h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 style={{ fontSize: "1.15em", fontWeight: 600, margin: "12px 0 4px", color: "var(--text-primary)" }} {...props}>{children}</h3>
          ),
          // 列表样式
          ul: ({ children, ...props }) => (
            <ul style={{ paddingLeft: "24px", margin: "8px 0" }} {...props}>{children}</ul>
          ),
          ol: ({ children, ...props }) => (
            <ol style={{ paddingLeft: "24px", margin: "8px 0" }} {...props}>{children}</ol>
          ),
          li: ({ children, ...props }) => (
            <li style={{ margin: "4px 0" }} {...props}>{children}</li>
          ),
          // 引用样式
          blockquote: ({ children, ...props }) => (
            <blockquote style={{
              borderLeft: "4px solid var(--brand-300)", paddingLeft: "12px",
              margin: "12px 0", color: "var(--text-secondary)", background: "var(--bg-hover, #F9FAFB)",
              padding: "8px 12px", borderRadius: "0 var(--radius-sm) var(--radius-sm) 0",
            }} {...props}>{children}</blockquote>
          ),
          // 链接样式
          a: ({ children, href, ...props }) => (
            <a href={href} target="_blank" rel="noopener noreferrer"
              style={{ color: "var(--brand-500)", textDecoration: "underline" }}
              {...props}>{children}</a>
          ),
          // 段落样式
          p: ({ children, ...props }) => (
            <p style={{ margin: "6px 0" }} {...props}>{children}</p>
          ),
          // 分割线
          hr: ({ ...props }) => (
            <hr style={{ border: "none", borderTop: "1px solid var(--border-default)", margin: "16px 0" }} {...props} />
          ),
          // 强调
          strong: ({ children, ...props }) => (
            <strong style={{ fontWeight: 600, color: "var(--text-primary)" }} {...props}>{children}</strong>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

// ============= 主组件 =============
export default function QaView() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState("")
  const [cursorVisible, setCursorVisible] = useState(true)
  const [showCitations, setShowCitations] = useState(false)
  const [allCitations, setAllCitations] = useState<Citation[]>([])
  const [popoverCitation, setPopoverCitation] = useState<Citation | null>(null)
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null)
  const [exportMenu, setExportMenu] = useState<ExportMenuState | null>(null)

  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string>("")
  const [titleGenerated, setTitleGenerated] = useState<Set<string>>(new Set())
  const [sidebarHovered, setSidebarHovered] = useState<string | null>(null)

  const chatAreaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const streamingMsgRef = useRef<string>("")
  const activeSessionRef = useRef<string>("")

  const { toasts, addToast, removeToast } = useToast()
  const { theme, toggleTheme } = useTheme()

  const scrollToBottom = useCallback((smooth = true) => {
    if (chatAreaRef.current) {
      chatAreaRef.current.scrollTo({ top: chatAreaRef.current.scrollHeight, behavior: smooth ? "smooth" : "auto" })
    }
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, streamingContent, scrollToBottom])

  useEffect(() => {
    if (!isStreaming) return
    const interval = setInterval(() => { setCursorVisible((v) => !v) }, 500)
    return () => clearInterval(interval)
  }, [isStreaming])

  useEffect(() => {
    if (!popoverCitation) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest("[data-citation-badge]") || target.closest("[data-popover-card]")) return
      setPopoverCitation(null)
      setPopoverPos(null)
    }
    document.addEventListener("click", handler)
    return () => document.removeEventListener("click", handler)
  }, [popoverCitation])

  useEffect(() => {
    if (!exportMenu) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest("[data-export-menu]")) return
      setExportMenu(null)
    }
    document.addEventListener("click", handler)
    return () => document.removeEventListener("click", handler)
  }, [exportMenu])

  useEffect(() => { loadConversations() }, [])

  const loadConversations = async () => {
    try {
      const res = await conversationAPI.list()
      if (res.code === 200 && res.data) {
        setConversations(res.data)
        setTitleGenerated(new Set(res.data.filter((c) => c.title !== "新对话").map((c) => c.session_id)))
        if (res.data.length > 0 && !activeSessionId) {
          await switchToConversation(res.data[0].session_id)
        }
      }
    } catch { /* 静默失败 */ }
  }

  const switchToConversation = async (sessionId: string) => {
    setActiveSessionId(sessionId)
    activeSessionRef.current = sessionId
    setMessages([])
    setAllCitations([])
    setShowCitations(false)
    setStreamingContent("")
    streamingMsgRef.current = ""
    try {
      const history = await conversationAPI.getHistory(sessionId)
      const msgs: ChatMessage[] = history.map((m, i) => ({
        id: `${sessionId}-${i}`,
        role: m.role === "human" ? "user" : "assistant",
        content: m.content,
        timestamp: new Date().toISOString(),
      }))
      setMessages(msgs)
    } catch { /* History may not exist yet */ }
  }

  const handleNewChat = async () => {
    setMessages([])
    setAllCitations([])
    setShowCitations(false)
    setStreamingContent("")
    streamingMsgRef.current = ""
    const sessionId = generateId()
    setActiveSessionId(sessionId)
    activeSessionRef.current = sessionId
    try {
      const res = await conversationAPI.create(sessionId)
      if (res.code === 201 || res.code === 200) {
        setConversations((prev) => [res.data, ...prev])
      }
    } catch { addToast("error", "创建对话失败") }
    return sessionId
  }

  const handleDeleteConv = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await conversationAPI.delete(sessionId)
      setConversations((prev) => prev.filter((c) => c.session_id !== sessionId))
      if (sessionId === activeSessionId) {
        setMessages([])
        setActiveSessionId("")
        setAllCitations([])
        setShowCitations(false)
      }
    } catch { addToast("error", "删除失败") }
  }

  const handleRename = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const newTitle = prompt("请输入新标题：")
    if (!newTitle || !newTitle.trim()) return
    try {
      await conversationAPI.updateTitle(sessionId, newTitle.trim())
      setConversations((prev) =>
        prev.map((c) => (c.session_id === sessionId ? { ...c, title: newTitle.trim() } : c))
      )
    } catch { addToast("error", "重命名失败") }
  }

  const handleExportClick = (e: React.MouseEvent, messageId: string, content: string) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    let x = rect.right - 140
    let y = rect.bottom + 4
    if (x < 10) x = 10
    if (y + 140 > window.innerHeight) y = rect.top - 150
    setExportMenu({ messageId, content, x, y })
  }

  const handleExport = (format: "markdown" | "word" | "excel") => {
    if (!exportMenu) return
    const timestamp = formatTime(new Date().toISOString()).replace(/\s/g, "_").replace(/:/g, "-")
    const filename = `AI回答_${timestamp}`
    const content = exportMenu.content

    switch (format) {
      case "markdown":
        exportAsMarkdown(content, filename)
        break
      case "word":
        exportAsWord(content, filename)
        break
      case "excel":
        exportAsExcel(content, filename)
        break
    }
    addToast("success", `已导出为 ${format === "markdown" ? "Markdown" : format === "word" ? "Word" : "Excel"} 文件`)
    setExportMenu(null)
  }

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim()
    if (!trimmed || isStreaming) return
    if (!activeSessionId) {
      handleNewChat().then(() => {
        // 新对话创建后，需要手动触发发送（因为 state 还没更新）
        // 这里通过 setTimeout 让 React 完成渲染后再发送
        setTimeout(() => {
          inputRef.current?.focus()
        }, 100)
      })
      return
    }

    const userMsg: ChatMessage = {
      id: String(Date.now()), role: "user", content: trimmed, timestamp: new Date().toISOString(),
    }
    const isFirstMessage = messages.length === 0
    const currentSessionId = activeSessionId

    setMessages((prev) => [...prev, userMsg])
    setInputValue("")
    setIsStreaming(true)
    setStreamingContent("")
    setCursorVisible(true)
    streamingMsgRef.current = ""

    const assistantId = String(Date.now() + 1)
    const startTime = new Date().toISOString()
    let metaCitations: Citation[] = []

    const controller = qaAPI.askStream(
      trimmed, currentSessionId,
      (sources) => {
        metaCitations = (sources as Citation[]) || []
        setAllCitations((prev) => {
          const existing = new Map(prev.map((c) => [c.index, c]))
          metaCitations.forEach((c) => existing.set(c.index, c))
          return Array.from(existing.values()).sort((a, b) => a.index - b.index)
        })
      },
      (text: string) => {
        streamingMsgRef.current += text
        setStreamingContent(streamingMsgRef.current)
      },
      () => {
        const finalContent = streamingMsgRef.current
        const assistantMsg: ChatMessage = {
          id: assistantId, role: "assistant", content: finalContent,
          timestamp: startTime, citations: metaCitations.length > 0 ? metaCitations : undefined,
        }
        setMessages((prev) => [...prev, assistantMsg])
        setStreamingContent("")
        setIsStreaming(false)
        streamingMsgRef.current = ""
        abortRef.current = null
        // 使用 ref 避免闭包陷阱
        if (isFirstMessage && !titleGenerated.has(currentSessionId)) {
          conversationAPI.generateTitle(currentSessionId, trimmed).then((res) => {
            if (res.code === 200 && res.data) {
              setConversations((prev) =>
                prev.map((c) => (c.session_id === currentSessionId ? { ...c, title: res.data.title } : c))
              )
              setTitleGenerated((prev) => new Set(prev).add(currentSessionId))
            }
          }).catch((err) => {
            console.warn("[QA] 标题生成失败:", err)
          })
        }
        setConversations((prev) =>
          prev.map((c) =>
            c.session_id === currentSessionId ? { ...c, updated_at: new Date().toISOString(), message_count: c.message_count + 2 } : c
          )
        )
      },
      (err: string) => {
        addToast("error", `请求失败: ${err}`)
        const assistantMsg: ChatMessage = {
          id: assistantId, role: "assistant",
          content: streamingMsgRef.current || "抱歉，请求处理失败，请重试。",
          timestamp: startTime, citations: metaCitations.length > 0 ? metaCitations : undefined,
        }
        setMessages((prev) => [...prev, assistantMsg])
        setStreamingContent("")
        setIsStreaming(false)
        streamingMsgRef.current = ""
        abortRef.current = null
      }
    )
    abortRef.current = controller
  }, [inputValue, isStreaming, addToast, activeSessionId, messages.length, titleGenerated])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend() }
  }, [handleSend])

  const handleCitationClick = useCallback((citation: Citation, e: React.MouseEvent) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    let top = rect.bottom + 8
    let left = rect.left
    if (left + 360 > window.innerWidth) left = window.innerWidth - 370
    if (left < 10) left = 10
    if (top + 200 > window.innerHeight) top = rect.top - 210
    setPopoverCitation(citation)
    setPopoverPos({ top, left })
  }, [])

  // 仅渲染引用标记（不含文本内容），用于在 Markdown 下方显示可点击的引用徽章
  const renderCitationBadges = useCallback((content: string, messageCitations?: Citation[]) => {
    const citationMap = new Map<number, Citation>()
    if (messageCitations) {
      messageCitations.forEach((c) => citationMap.set(c.index, c))
    } else {
      allCitations.forEach((c) => citationMap.set(c.index, c))
    }
    const matches = content.matchAll(/\[(\d+)\]/g)
    const badges: React.ReactNode[] = []
    const seen = new Set<number>()
    for (const match of matches) {
      const idx = parseInt(match[1], 10)
      if (seen.has(idx)) continue
      seen.add(idx)
      const citation = citationMap.get(idx)
      if (citation) {
        badges.push(
          <button
            key={idx} data-citation-badge
            style={styles.citationBadge}
            onClick={(e) => handleCitationClick(citation, e)}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.transform = "scale(1.08)"
              ;(e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(43,90,237,0.3)"
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.transform = "scale(1)"
              ;(e.currentTarget as HTMLElement).style.boxShadow = "none"
            }}
          >
            {idx}
          </button>
        )
      }
    }
    return badges
  }, [allCitations, handleCitationClick])

  const isDark = theme === "dark"
  const clr = {
    bg: isDark ? "#0F1117" : "#f9f9fb",
    bgCard: isDark ? "#1A1D28" : "#fff",
    border: isDark ? "#2A2E3A" : "#e8e8ed",
    borderLight: isDark ? "#1F2230" : "#f0f0f5",
    text: isDark ? "#E8EAED" : "#1a1a2e",
    textSecondary: isDark ? "#9AA0B0" : "#555",
    textTertiary: isDark ? "#6B7180" : "#999",
    textMuted: isDark ? "#4A5060" : "#bbb",
    brand: "#0066CC",
    brandLight: isDark ? "#1A2240" : "#e0ecff",
    hover: isDark ? "#252836" : "#f0f2f5",
    inputBg: isDark ? "#1E2130" : "#f9f9fb",
    inputBorder: isDark ? "#2A2E3A" : "#dde0e8",
  }

  const hasMessages = messages.length > 0
  const activeConv = conversations.find((c) => c.session_id === activeSessionId)
  const convGroups = groupConversations(conversations)

  return (
    <>
      <style>{`
        @keyframes qa-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes qa-spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes export-fade-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        .qa-msg-row:hover .qa-export-btn { opacity: 1 !important; }
        .markdown-body pre { margin: 0; }
        .markdown-body pre code { background: none; padding: 0; color: inherit; }
        .markdown-body img { max-width: 100%; border-radius: 8px; }
      `}</style>
      <div style={{ ...styles.page, background: clr.bg }}>
        {/* ===== 左侧边栏 ===== */}
        <div style={{ ...styles.sidebar, background: clr.bg, borderColor: clr.border }}>
          {/* Logo */}
          <div style={{ ...styles.sidebarLogo }}>
            <div style={styles.sidebarLogoIcon}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
            </div>
            <span style={{ color: clr.text }}>AI 智能问答</span>
          </div>

          {/* 新对话按钮 */}
          <button style={styles.sidebarNewChatBtn} onClick={handleNewChat}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f0f2f5"; (e.currentTarget as HTMLElement).style.borderColor = "#0066CC" }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "#fff"; (e.currentTarget as HTMLElement).style.borderColor = "#dde0e8" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            开启新对话
          </button>

          {/* 对话列表（按时间分组） */}
          <div style={styles.sidebarList}>
            {conversations.length === 0 ? (
              <div style={{ padding: "20px 12px", textAlign: "center", color: clr.textMuted, fontSize: "13px" }}>
                暂无对话记录
              </div>
            ) : (
              Array.from(convGroups.entries()).map(([groupName, convs]) => (
                <div key={groupName}>
                  <div style={styles.sidebarGroupTitle}>{groupName}</div>
                  {convs.map((conv) => {
                    const isActive = conv.session_id === activeSessionId
                    const isHovered = conv.session_id === sidebarHovered
                    return (
                      <div key={conv.session_id}
                        style={{ ...styles.sidebarItem, ...(isActive ? styles.sidebarItemActive : {}) }}
                        onClick={() => switchToConversation(conv.session_id)}
                        onDoubleClick={(e) => handleRename(conv.session_id, e)}
                        onMouseEnter={() => setSidebarHovered(conv.session_id)}
                        onMouseLeave={() => setSidebarHovered(null)}
                        title={`${conv.title}\n双击可重命名`}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isActive ? "#0066CC" : "#999"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                        </svg>
                        <span style={styles.sidebarItemTitle}>{conv.title}</span>
                        <button style={{ ...styles.sidebarItemDelete, ...(isHovered ? { opacity: 1 } : {}) }}
                          onClick={(e) => handleDeleteConv(conv.session_id, e)} title="删除对话"
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#e74c3c" }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#bbb" }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          </svg>
                        </button>
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </div>

          {/* 侧边栏底部 */}
          <div style={{ ...styles.sidebarBottom, borderColor: clr.border }}>
            <div style={styles.sidebarBottomIcons}>
              <button style={styles.sidebarBottomIcon} title="设置"
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#e8e8ed"; (e.currentTarget as HTMLElement).style.color = "#333" }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#8e8ea0" }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>
              </button>
              <button style={styles.sidebarBottomIcon} title={theme === "light" ? "切换暗色模式" : "切换亮色模式"}
                onClick={toggleTheme}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#e8e8ed"; (e.currentTarget as HTMLElement).style.color = "#333" }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#8e8ea0" }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                </svg>
              </button>
            </div>
            <span style={styles.sidebarVersion}>v1.0.0</span>
          </div>
        </div>

        {/* ===== 右侧主区域 ===== */}
        <div style={{ ...styles.mainArea, background: clr.bgCard }}>
          {/* 顶部栏 */}
          <div style={{ ...styles.topBar, background: clr.bgCard, borderColor: clr.borderLight }}>
            <div style={styles.topBarLeft}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0066CC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
              <span style={{ ...styles.topBarTitle, color: clr.text }}>{activeConv?.title || "新对话"}</span>
            </div>
            <div style={styles.topBarIcons}>
              <button style={styles.topBarIcon} title="搜索"
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f0f2f5"; (e.currentTarget as HTMLElement).style.color = "#333" }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#8e8ea0" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </button>
              <button style={styles.topBarIcon} title="更多"
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f0f2f5"; (e.currentTarget as HTMLElement).style.color = "#333" }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#8e8ea0" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
                </svg>
              </button>
            </div>
          </div>

          {/* 聊天区域 */}
          <div style={{ ...styles.chatWrapper, background: clr.bgCard }}>
            <div ref={chatAreaRef} style={styles.chatArea}>
              {!hasMessages && !isStreaming ? (
                <div style={styles.emptyState}>
                  <div style={styles.emptyLogo}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                    </svg>
                  </div>
                  <p style={{ ...styles.emptyWelcome, color: clr.text }}>有什么可以帮助您的？</p>
                  <p style={{ ...styles.emptyHint, color: clr.textTertiary }}>基于企业知识库，我可以回答文档相关问题、搜索信息、辅助写作</p>
                  <div style={styles.suggestions}>
                    {SUGGESTED_QUESTIONS.map((q, i) => (
                      <button
                        key={i}
                        style={styles.suggestionChip}
                        onClick={() => { setInputValue(q); inputRef.current?.focus() }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.background = "#e0ecff"
                          ;(e.currentTarget as HTMLElement).style.borderColor = "#0066CC"
                          ;(e.currentTarget as HTMLElement).style.color = "#0066CC"
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.background = "#f9f9fb"
                          ;(e.currentTarget as HTMLElement).style.borderColor = "#e8e8ed"
                          ;(e.currentTarget as HTMLElement).style.color = "#555"
                        }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={styles.chatInner}>
                  {messages.map((msg) => (
                    <div key={msg.id} className="qa-msg-row">
                      <div style={{ ...styles.msgRow, ...(msg.role === "user" ? styles.msgRowUser : styles.msgRowAssistant) }}>
                        {msg.role === "assistant" ? (
                          <>
                            <div style={{ ...styles.msgAvatar, ...styles.msgAvatarAI }}>AI</div>
                            <div style={styles.msgBody}>
                              <div style={{ ...styles.msgBubble, ...styles.msgBubbleAssistant, position: "relative", color: clr.text }}>
                                <MarkdownRenderer content={msg.content} />
                                {msg.citations && msg.citations.length > 0 && (
                                  <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "4px", alignItems: "center" }}>
                                    <span style={{ fontSize: "11px", color: "#bbb", marginRight: "4px" }}>参考来源：</span>
                                    {renderCitationBadges(msg.content, msg.citations)}
                                  </div>
                                )}
                                <div style={{ position: "absolute", top: "4px", right: "4px" }}>
                                  <button className="qa-export-btn" style={styles.exportBtn}
                                    onClick={(e) => handleExportClick(e, msg.id, msg.content)} title="导出回答"
                                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f0f2f5"; (e.currentTarget as HTMLElement).style.color = "#333" }}
                                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#8e8ea0" }}
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                              <div style={{ ...styles.msgTimestamp, ...styles.msgTimestampAssistant }}>
                                {formatTime(msg.timestamp)}
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div style={styles.msgBody}>
                              <div style={{ ...styles.msgBubble, ...styles.msgBubbleUser }}>
                                {msg.content}
                              </div>
                              <div style={{ ...styles.msgTimestamp, ...styles.msgTimestampUser }}>
                                {formatTime(msg.timestamp)}
                              </div>
                            </div>
                            <div style={{ ...styles.msgAvatar, ...styles.msgAvatarUser }}>U</div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}

                  {isStreaming && streamingContent && (
                    <div>
                      <div style={{ ...styles.msgRow, ...styles.msgRowAssistant }}>
                        <div style={{ ...styles.msgAvatar, ...styles.msgAvatarAI }}>AI</div>
                        <div style={styles.msgBody}>
                          <div style={{ ...styles.msgBubble, ...styles.msgBubbleAssistant, color: clr.text }}>
                            <MarkdownRenderer content={streamingContent} />
                            {cursorVisible && <span style={{ ...styles.cursor, animation: "qa-blink 0.5s infinite" }} />}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {isStreaming && !streamingContent && (
                    <div style={{ ...styles.msgRow, ...styles.msgRowAssistant }}>
                      <div style={{ ...styles.msgAvatar, ...styles.msgAvatarAI }}>AI</div>
                      <div style={styles.msgBody}>
                        <div style={{ ...styles.msgBubble, ...styles.msgBubbleAssistant, display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#bbb", animation: "pulse 0.8s infinite" }} />
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#bbb", animation: "pulse 0.8s 0.15s infinite" }} />
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#bbb", animation: "pulse 0.8s 0.3s infinite" }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 输入区域 */}
            <div style={{ ...styles.inputArea, background: clr.bgCard, borderColor: clr.borderLight }}>
              <div style={styles.inputInner}>
                <div style={styles.textareaWrap}>
                  <textarea ref={inputRef} style={{ ...styles.textarea, background: clr.inputBg, borderColor: clr.inputBorder, color: clr.text }}
                    value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={handleKeyDown}
                    placeholder="输入您的问题，Enter 发送，Shift+Enter 换行" disabled={isStreaming}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "#0066CC"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(0,102,204,0.12)" }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "#dde0e8"; e.currentTarget.style.boxShadow = "none" }}
                    rows={1}
                  />
                </div>
                {allCitations.length > 0 && (
                  <button style={{ ...styles.citationToggleBtn, ...(showCitations ? styles.citationToggleActive : {}) }}
                    onClick={() => setShowCitations((v) => !v)} title="参考来源"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
                      <line x1="8" y1="7" x2="16" y2="7" /><line x1="8" y1="11" x2="14" y2="11" />
                    </svg>
                  </button>
                )}
                <button style={{ ...styles.sendBtn, ...(!inputValue.trim() || isStreaming ? styles.sendBtnDisabled : {}) }}
                  onClick={handleSend} disabled={!inputValue.trim() || isStreaming}
                  onMouseEnter={(e) => { if (!inputValue.trim() || isStreaming) return; (e.currentTarget as HTMLElement).style.background = "#0052a3" }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "#0066CC" }}
                >
                  {isStreaming ? (
                    <div style={{ ...styles.spinner, animation: "qa-spin 0.6s linear infinite" }} />
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* 引用面板 */}
          {showCitations && allCitations.length > 0 && (
            <div style={styles.citationPanel}>
              <div style={styles.citationPanelHeader}>
                <h3 style={styles.citationPanelTitle}>参考来源</h3>
                <button style={styles.citationPanelClose} onClick={() => setShowCitations(false)}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f0f2f5"; (e.currentTarget as HTMLElement).style.color = "#333" }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; (e.currentTarget as HTMLElement).style.color = "#8e8ea0" }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div style={styles.citationPanelList}>
                {allCitations.map((citation) => (
                  <div key={citation.index} style={styles.citationCard}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)" }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; (e.currentTarget as HTMLElement).style.boxShadow = "none" }}
                  >
                    <div style={styles.citationCardDocName}>
                      <span style={styles.citationCardIndex}>{citation.index}</span>
                      {citation.doc_name}
                    </div>
                    <div style={styles.citationCardPath}>{citation.header_path}</div>
                    <div style={styles.citationCardSnippet}>{citation.snippet}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 引用弹出层 */}
        {popoverCitation && popoverPos && (
          <>
            <div style={styles.popoverOverlay} />
            <div data-popover-card style={{ ...styles.popoverCard, top: popoverPos.top, left: popoverPos.left }}>
              <div style={styles.popoverDocName}>[{popoverCitation.index}] {popoverCitation.doc_name}</div>
              <div style={styles.popoverPath}>{popoverCitation.header_path}</div>
              <div style={styles.popoverSnippet}>{popoverCitation.snippet}</div>
            </div>
          </>
        )}

        {/* 导出菜单 */}
        {exportMenu && (
          <div data-export-menu style={{ ...styles.exportMenu, top: exportMenu.y, left: exportMenu.x, animation: "export-fade-in 150ms ease" }}>
            <button style={styles.exportMenuItem} onClick={() => handleExport("markdown")}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f0f2f5" }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              导出 Markdown
            </button>
            <button style={styles.exportMenuItem} onClick={() => handleExport("word")}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f0f2f5" }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              导出 Word
            </button>
            {isTableContent(exportMenu.content) && (
              <button style={styles.exportMenuItem} onClick={() => handleExport("excel")}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f0f2f5" }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none" }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" />
                </svg>
                导出 Excel
              </button>
            )}
          </div>
        )}
      </div>
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </>
  )
}