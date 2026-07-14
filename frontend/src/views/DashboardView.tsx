import { useState, useEffect, useRef, useMemo } from "react"
import { Link } from "react-router-dom"
import type { MailItem, ConversationItem } from "../types"
import { knowledgeAPI, mailAPI, conversationAPI } from "../services/api"
import { useAuth } from "../contexts/AuthContext"
import { useToast } from "../hooks/useToast"
import ToastContainer from "../components/ToastContainer"

// ============= 激励语模板 =============
const MOTIVATIONS = [
  "新的一天，新的开始！让AI助手帮您高效处理工作。",
  "今日事今日毕，AI助手随时为您提供知识支持。",
  "探索知识的海洋，AI助手是您的最佳导航员。",
  "工作再忙也别忘了休息，AI助手为您分担压力。",
  "每一次提问都是进步的开始，AI助手与您共同成长。",
  "知识就是力量，AI助手帮您将知识转化为行动。",
  "高效工作，从智能助手开始，祝您今天一切顺利！",
  "保持好奇心，持续学习，AI助手陪您一起探索。",
]

// ============= 工具函数 =============
function formatMailTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  const time = `${hours}:${minutes}`

  if (target.getTime() === today.getTime()) return time
  if (target.getTime() === yesterday.getTime()) return `昨天`
  const month = (date.getMonth() + 1).toString().padStart(2, "0")
  const day = date.getDate().toString().padStart(2, "0")
  return `${month}-${day}`
}

function formatConvTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return "刚刚"
  if (diffMins < 60) return `${diffMins}分钟前`
  if (diffHours < 24) return `${diffHours}小时前`
  if (diffDays < 7) return `${diffDays}天前`
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// ============= 知识图谱 3D 球体组件 =============
// 每个分类是一个独立的"知识球"，球内显示该分类的文档数量
function KnowledgeGraph({ categories, counts }: { categories: string[]; counts: Record<string, number> }) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [orbitAngle, setOrbitAngle] = useState(0)
  const animRef = useRef<number>(0)

  const PALETTE = [
    "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899",
    "#06B6D4", "#F97316", "#84CC16", "#6366F1", "#14B8A6",
  ]
  const PALETTE_LIGHT = [
    "rgba(16,185,129,0.15)", "rgba(245,158,11,0.15)", "rgba(239,68,68,0.15)", "rgba(139,92,246,0.15)", "rgba(236,72,153,0.15)",
    "rgba(6,182,212,0.15)", "rgba(249,115,22,0.15)", "rgba(132,204,22,0.15)", "rgba(99,102,241,0.15)", "rgba(20,184,166,0.15)",
  ]

  const graphData = useMemo(() => {
    const totalDocs = categories.reduce((sum, c) => sum + (counts[c] || 0), 0)
    const n = categories.length || 0

    const planets = categories.map((cat, i) => {
      const cnt = counts[cat] || 0
      const baseR = 20
      const maxR = 36
      const r = n <= 3 ? baseR + Math.min(cnt * 5, maxR - baseR) : baseR + Math.min(cnt * 4, maxR - baseR)
      return {
        id: `cat-${i}`,
        label: cat,
        color: PALETTE[i % PALETTE.length],
        lightColor: PALETTE_LIGHT[i % PALETTE_LIGHT.length],
        count: cnt,
        r,
      }
    })

    return { totalDocs, planets }
  }, [categories, counts])

  // 持续旋转动画
  useEffect(() => {
    let running = true
    const animate = () => {
      if (!running) return
      setOrbitAngle((prev) => prev + 0.003)
      animRef.current = requestAnimationFrame(animate)
    }
    animRef.current = requestAnimationFrame(animate)
    return () => {
      running = false
      cancelAnimationFrame(animRef.current)
    }
  }, [])

  const cx = 200, cy = 170
  const isEmpty = graphData.planets.length === 0
  const n = graphData.planets.length

  return (
    <svg viewBox="0 0 400 340" style={{ width: "100%", height: "100%" }}>
      <defs>
        {/* 中心核心渐变 */}
        <radialGradient id="core-grad2" cx="38%" cy="32%">
          <stop offset="0%" stopColor="#4F76FF" />
          <stop offset="50%" stopColor="#0066CC" />
          <stop offset="100%" stopColor="#003D99" />
        </radialGradient>
        {/* 中心光晕 */}
        <radialGradient id="core-glow2" cx="50%" cy="50%">
          <stop offset="0%" stopColor="#0066CC" stopOpacity={0.2} />
          <stop offset="60%" stopColor="#0066CC" stopOpacity={0.06} />
          <stop offset="100%" stopColor="#0066CC" stopOpacity={0} />
        </radialGradient>
        {/* 每个知识球的渐变 */}
        {graphData.planets.map((p) => (
          <radialGradient key={`g-${p.id}`} id={`g-${p.id}`} cx="35%" cy="30%">
            <stop offset="0%" stopColor={p.color} stopOpacity={0.95} />
            <stop offset="70%" stopColor={p.color} stopOpacity={0.7} />
            <stop offset="100%" stopColor={p.color} stopOpacity={0.35} />
          </radialGradient>
        ))}
        <filter id="s1">
          <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.15" />
        </filter>
        <filter id="s2">
          <feDropShadow dx="0" dy="2" stdDeviation="4" floodOpacity="0.2" />
        </filter>
      </defs>

      {/* 背景旋转粒子 */}
      {Array.from({ length: 22 }).map((_, i) => {
        const theta = (i / 22) * Math.PI * 2 + orbitAngle * 0.2
        const dist = 80 + (i % 3) * 42
        const px = cx + Math.cos(theta) * dist
        const py = cy + Math.sin(theta) * dist * 0.6
        return (
          <circle key={`pt-${i}`} cx={px} cy={py} r={0.7} fill="#0066CC" opacity={0.1 + (i % 3) * 0.06}>
            <animate attributeName="opacity" values="0.1;0.22;0.1" dur={`${2 + i * 0.25}s`} repeatCount="indefinite" />
          </circle>
        )
      })}

      {/* 轨道环 */}
      {n > 0 && (
        <>
          <ellipse cx={cx} cy={cy} rx={95} ry={38} fill="none" stroke="#0066CC" strokeWidth={0.6} opacity={0.2} transform={`rotate(-15, ${cx}, ${cy})`} />
          <ellipse cx={cx} cy={cy} rx={50} ry={95} fill="none" stroke="#0066CC" strokeWidth={0.5} opacity={0.15} transform={`rotate(-15, ${cx}, ${cy})`} />
          {n >= 3 && (
            <ellipse cx={cx} cy={cy} rx={78} ry={70} fill="none" stroke="#0066CC" strokeWidth={0.4} opacity={0.12} transform={`rotate(30, ${cx}, ${cy})`} />
          )}
        </>
      )}

      {/* 空状态 */}
      {isEmpty && (
        <g>
          <text x={cx} y={cy - 10} textAnchor="middle" fill="var(--text-tertiary)" fontSize={13}>
            暂无文档分类数据
          </text>
          <text x={cx} y={cy + 14} textAnchor="middle" fill="var(--text-tertiary)" fontSize={11} opacity={0.6}>
            上传文档后将自动构建知识图谱
          </text>
        </g>
      )}

      {/* 连线：核心 → 知识球 */}
      {graphData.planets.map((planet, i) => {
        const orbitR = 90 + (n > 1 ? (i - (n - 1) / 2) * 15 : 0)
        const tilt = i * 0.4
        const angle = orbitAngle * (1 + i * 0.15) + (2 * Math.PI * i) / n
        const px = cx + Math.cos(angle) * orbitR
        const py = cy + Math.sin(angle) * orbitR * Math.cos(tilt) * 0.65
        return (
          <line
            key={`ln-${planet.id}`}
            x1={cx} y1={cy} x2={px} y2={py}
            stroke={planet.color}
            strokeWidth={0.8}
            strokeDasharray="3,3"
            opacity={0.3}
          />
        )
      })}

      {/* 知识球（分类） */}
      {graphData.planets.map((planet, i) => {
        const orbitR = 90 + (n > 1 ? (i - (n - 1) / 2) * 15 : 0)
        const tilt = i * 0.4
        const angle = orbitAngle * (1 + i * 0.15) + (2 * Math.PI * i) / n
        const px = cx + Math.cos(angle) * orbitR
        const py = cy + Math.sin(angle) * orbitR * Math.cos(tilt) * 0.65
        const isHovered = hoveredNode === planet.id

        const depth = 0.65 + 0.35 * ((py - cy) / 120 + 1) * 0.5
        const actualR = isHovered ? planet.r + 4 : planet.r

        return (
          <g
            key={planet.id}
            onMouseEnter={() => setHoveredNode(planet.id)}
            onMouseLeave={() => setHoveredNode(null)}
            style={{ cursor: "pointer" }}
          >
            {/* Hover外圈光晕 */}
            {isHovered && (
              <circle cx={px} cy={py} r={actualR + 8} fill="none" stroke={planet.color} strokeWidth={2.5} opacity={0.25}>
                <animate attributeName="r" from={actualR + 6} to={actualR + 15} dur="1.2s" repeatCount="indefinite" />
                <animate attributeName="opacity" from="0.3" to="0.08" dur="1.2s" repeatCount="indefinite" />
              </circle>
            )}
            {/* 球体底色光晕 */}
            <circle cx={px} cy={py} r={actualR + 5} fill={planet.lightColor} opacity={0.35} />
            {/* 知识球本体 */}
            <circle
              cx={px} cy={py}
              r={actualR}
              fill={`url(#g-${planet.id})`}
              stroke={planet.color}
              strokeWidth={2}
              filter="url(#s1)"
              style={{ transition: "r 0.2s ease" }}
              opacity={depth}
            />
            {/* 球面高光 */}
            <ellipse
              cx={px - actualR * 0.28} cy={py - actualR * 0.28}
              rx={actualR * 0.38} ry={actualR * 0.24}
              fill="white" opacity={0.13}
              style={{ pointerEvents: "none" }}
            />
            {/* 球内数字 = 文档数量 */}
            <text
              x={px} y={py + 1}
              textAnchor="middle" dominantBaseline="central"
              fill="white"
              fontSize={planet.count >= 100 ? 13 : planet.count >= 10 ? 15 : 17}
              fontWeight={700}
              style={{ pointerEvents: "none" }}
              opacity={depth}
            >
              {planet.count}
            </text>
            {/* 球外分类名称 */}
            <text
              x={px} y={py + actualR + 14}
              textAnchor="middle" fill="var(--text-secondary)"
              fontSize={11} fontWeight={500}
              style={{ pointerEvents: "none" }}
              opacity={depth}
            >
              {planet.label.length > 8 ? planet.label.slice(0, 8) + "..." : planet.label}
            </text>
            {/* Hover浮层 */}
            {isHovered && (
              <g>
                <rect x={px - 40} y={py + actualR + 22} width={80} height={20} rx={6} fill="rgba(0,0,0,0.78)" />
                <text x={px} y={py + actualR + 35} textAnchor="middle" fill="white" fontSize={10} fontWeight={500} style={{ pointerEvents: "none" }}>
                  {planet.label} · {planet.count}篇文档
                </text>
              </g>
            )}
          </g>
        )
      })}

      {/* ===== 中心核心球体 ===== */}
      <circle cx={cx} cy={cy} r={55} fill="url(#core-glow2)" />
      <circle cx={cx} cy={cy} r={34} fill="url(#core-grad2)" stroke="#0066CC" strokeWidth={3} filter="url(#s2)" />
      {/* 中心高光 */}
      <ellipse cx={cx - 8} cy={cy - 9} rx={12} ry={8} fill="white" opacity={0.18} style={{ pointerEvents: "none" }} />
      {/* 中心脉冲环 */}
      <circle cx={cx} cy={cy} r={34} fill="none" stroke="#0066CC" strokeWidth={1.5} opacity={0.25}>
        <animate attributeName="r" from={36} to={53} dur="2.5s" repeatCount="indefinite" />
        <animate attributeName="opacity" from="0.3" to="0" dur="2.5s" repeatCount="indefinite" />
      </circle>
      {/* 中心文字 */}
      <text x={cx} y={cy - 6} textAnchor="middle" fill="white" fontSize={15} fontWeight={700} style={{ pointerEvents: "none" }}>AI</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize={10} fontWeight={500} style={{ pointerEvents: "none" }}>知识库</text>
      {/* 文档总数标注 */}
      <text x={cx} y={cy + 50} textAnchor="middle" fill="var(--text-secondary)" fontSize={13} fontWeight={600} style={{ pointerEvents: "none" }}>
        {graphData.totalDocs} 篇文档
      </text>

      {/* 图例（右下角） */}
      {!isEmpty && (
        <g transform="translate(290, 250)">
          {graphData.planets.slice(0, 5).map((p, i) => {
            const y = i * 20
            return (
              <g key={`lg-${p.id}`}>
                <circle cx={0} cy={y} r={5} fill={p.color} opacity={0.8} />
                <text x={12} y={y + 4} fill="var(--text-secondary)" fontSize={10}>
                  {p.label.length > 6 ? p.label.slice(0, 6) + "..." : p.label}
                  <tspan fill="var(--text-tertiary)" fontSize={9}> · {p.count}篇</tspan>
                </text>
              </g>
            )
          })}
        </g>
      )}
    </svg>
  )
}

// ============= 样式 =============
const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 1200,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-5)",
  },
  // 顶部信息区
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "var(--space-4)",
  },
  headerLeft: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-2)",
  },
  greeting: {
    margin: 0,
    fontSize: "var(--font-2xl)",
    fontWeight: 700,
    color: "var(--text-primary)",
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
  },
  greetingEmoji: {
    fontSize: "var(--font-2xl)",
  },
  timeDisplay: {
    fontSize: "var(--font-lg)",
    fontWeight: 500,
    color: "var(--brand-500)",
    fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace",
    letterSpacing: "0.5px",
  },
  motivation: {
    margin: 0,
    fontSize: "var(--font-base)",
    color: "var(--text-secondary)",
    lineHeight: 1.6,
    fontStyle: "italic",
    borderLeft: "3px solid var(--brand-300)",
    paddingLeft: "var(--space-3)",
  },

  // 快速导航
  quickNav: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "var(--space-4)",
  },
  navCard: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-4)",
    padding: "var(--space-5)",
    background: "var(--bg-card)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-sm)",
    textDecoration: "none",
    transition: "transform 200ms ease, box-shadow 200ms ease",
    cursor: "pointer",
    border: "1px solid var(--border-default)",
  },
  navIconWrap: {
    width: 48,
    height: 48,
    borderRadius: "var(--radius-md)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    position: "relative" as const,
  },
  navBadge: {
    position: "absolute" as const,
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: "var(--radius-full)",
    background: "var(--semantic-urgent)",
    color: "white",
    fontSize: 11,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 4px",
  },
  navTextWrap: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  navTitle: {
    fontSize: "var(--font-base)",
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  navSubtitle: {
    fontSize: "var(--font-xs)",
    color: "var(--text-tertiary)",
  },

  // 内容区域
  content: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "var(--space-4)",
  },
  contentFull: {
    gridColumn: "1 / -1",
  },
  panel: {
    background: "var(--bg-card)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-sm)",
    border: "1px solid var(--border-default)",
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "var(--space-3) var(--space-4)",
    borderBottom: "1px solid var(--border-light)",
    flexShrink: 0,
  },
  panelTitle: {
    margin: 0,
    fontSize: "var(--font-base)",
    fontWeight: 600,
    color: "var(--text-primary)",
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
  },
  panelBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 20,
    height: 20,
    borderRadius: "var(--radius-full)",
    background: "var(--brand-500)",
    color: "white",
    fontSize: 11,
    fontWeight: 600,
    padding: "0 6px",
  },
  panelMore: {
    fontSize: "var(--font-xs)",
    color: "var(--brand-500)",
    textDecoration: "none",
    fontWeight: 500,
    cursor: "pointer",
  },
  panelBody: {
    flex: 1,
    overflow: "auto",
    padding: "var(--space-3) var(--space-4)",
  },

  // 知识图谱
  graphContainer: {
    height: 340,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--bg-primary)",
  },

  // 邮件列表
  mailHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "var(--space-2) var(--space-4)",
    borderBottom: "1px solid var(--border-light)",
    background: "var(--bg-hover, #F9FAFB)",
  },
  mailTotalCount: {
    fontSize: "var(--font-sm)",
    color: "var(--text-secondary)",
    fontWeight: 500,
  },
  mailCountStrong: {
    color: "var(--brand-500)",
    fontWeight: 700,
    fontSize: "var(--font-lg)",
  },
  mailItem: {
    display: "flex",
    alignItems: "flex-start",
    padding: "var(--space-3) var(--space-4)",
    borderBottom: "1px solid var(--border-light)",
    cursor: "pointer",
    transition: "background 150ms ease",
    gap: "var(--space-3)",
    textDecoration: "none",
    color: "inherit",
  },
  mailItemLeft: {
    flexShrink: 0,
    width: 6,
    paddingTop: 4,
  },
  mailUnreadDot: {
    width: 6,
    height: 6,
    borderRadius: "var(--radius-full)",
    background: "var(--brand-500)",
  },
  mailItemContent: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  mailItemHeader: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "var(--space-2)",
  },
  mailSender: {
    fontSize: "var(--font-sm)",
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  mailSubject: {
    fontSize: "var(--font-sm)",
    color: "var(--text-primary)",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  mailSummary: {
    fontSize: "var(--font-xs)",
    color: "var(--text-tertiary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  mailTime: {
    fontSize: "var(--font-xs)",
    color: "var(--text-tertiary)",
    flexShrink: 0,
  },

  // 对话列表
  convItem: {
    display: "flex",
    alignItems: "center",
    padding: "var(--space-3) var(--space-4)",
    borderBottom: "1px solid var(--border-light)",
    cursor: "pointer",
    transition: "background 150ms ease",
    gap: "var(--space-3)",
    textDecoration: "none",
    color: "inherit",
  },
  convIcon: {
    width: 32,
    height: 32,
    borderRadius: "var(--radius-sm)",
    background: "var(--brand-50)",
    color: "var(--brand-500)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  convContent: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  convTitle: {
    fontSize: "var(--font-sm)",
    fontWeight: 500,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  convMeta: {
    fontSize: "var(--font-xs)",
    color: "var(--text-tertiary)",
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
  },
  convStar: {
    color: "#F5A623",
    flexShrink: 0,
  },
  convArrow: {
    color: "var(--text-tertiary)",
    flexShrink: 0,
  },

  // 空状态
  emptyState: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: "var(--space-8) var(--space-4)",
    gap: "var(--space-2)",
    color: "var(--text-tertiary)",
    fontSize: "var(--font-sm)",
  },
  emptyIcon: {
    opacity: 0.4,
    marginBottom: "var(--space-1)",
  },

  // 骨架屏
  skeleton: {
    height: 52,
    borderRadius: "var(--radius-sm)",
    background: "var(--bg-hover, #F3F4F6)",
    marginBottom: "var(--space-2)",
  },
}

// ============= 主组件 =============
export default function DashboardView() {
  const { user } = useAuth()
  const { toasts, removeToast } = useToast()

  const [currentTime, setCurrentTime] = useState("")
  const [motivation, setMotivation] = useState("")
  const [categories, setCategories] = useState<string[]>([])
  const [recentMails, setRecentMails] = useState<MailItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [readCount, setReadCount] = useState(0)
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [loadingMails, setLoadingMails] = useState(true)
  const [loadingConvs, setLoadingConvs] = useState(true)
  const [loadingCategories, setLoadingCategories] = useState(true)
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({})

  // 更新时间
  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      setCurrentTime(
        now.toLocaleString("zh-CN", {
          year: "numeric",
          month: "long",
          day: "numeric",
          weekday: "long",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      )
    }
    updateTime()
    const interval = setInterval(updateTime, 1000)
    return () => clearInterval(interval)
  }, [])

  // 随机激励语
  useEffect(() => {
    setMotivation(MOTIVATIONS[Math.floor(Math.random() * MOTIVATIONS.length)])
  }, [])

  // 获取文档分类和文档列表（构建知识图谱数据）
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const dept = "default_dept"
        // 同时获取分类和文档列表
        const [catRes, listRes] = await Promise.all([
          knowledgeAPI.categories(dept),
          knowledgeAPI.list(dept, 1, 100),
        ])
        
        const catList: string[] = []
        const counts: Record<string, number> = {}
        
        if (catRes.code === 200 && Array.isArray(catRes.data)) {
          catRes.data.filter(Boolean).forEach((c: string) => {
            catList.push(c)
            counts[c] = 0
          })
        }
        
        // 从文档列表中统计各分类的数量
        if (listRes.code === 200 && Array.isArray(listRes.data)) {
          listRes.data.forEach((doc: any) => {
            const cat = doc.category || "未分类"
            if (!counts[cat]) {
              counts[cat] = 0
              if (!catList.includes(cat)) {
                catList.push(cat)
              }
            }
            counts[cat]++
          })
        }
        
        setCategories(catList)
        setCategoryCounts(counts)
      } catch {
        // 静默失败
      } finally {
        setLoadingCategories(false)
      }
    }
    fetchCategories()
  }, [user])

  // 获取邮件（与邮件中心使用相同的 USER_ID 确保数据一致）
  useEffect(() => {
    const fetchMails = async () => {
      setLoadingMails(true)
      const USER_ID = "default_user"
      try {
        const [mailRes, unreadRes] = await Promise.all([
          mailAPI.fetch(USER_ID, undefined, 10),
          mailAPI.getUnreadCount(USER_ID),
        ])
        if (mailRes.code === 200 && Array.isArray(mailRes.data)) {
          setRecentMails(mailRes.data)
        }
        if (unreadRes.code === 200) {
          setUnreadCount(unreadRes.data.count)
        }
        // 获取全部邮件总数来计算已读数
        const totalRes = await mailAPI.fetch(USER_ID, undefined, 1)
        if (totalRes.total !== undefined) {
          setReadCount(totalRes.total - (unreadRes.data?.count ?? 0))
        }
      } catch {
        // 静默失败
      } finally {
        setLoadingMails(false)
      }
    }
    fetchMails()
  }, [])

  // 获取对话列表
  useEffect(() => {
    const fetchConversations = async () => {
      setLoadingConvs(true)
      try {
        const res = await conversationAPI.list()
        if (res.code === 200 && Array.isArray(res.data)) {
          // 按更新时间降序排列
          const sorted = [...res.data].sort(
            (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          )
          setConversations(sorted)
        }
      } catch {
        // 静默失败
      } finally {
        setLoadingConvs(false)
      }
    }
    fetchConversations()
  }, [])

  // 获取当前时段问候语
  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 6) return "夜深了"
    if (hour < 9) return "早上好"
    if (hour < 12) return "上午好"
    if (hour < 14) return "中午好"
    if (hour < 18) return "下午好"
    return "晚上好"
  }

  return (
    <>
      <style>{`
        @keyframes dash-fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .dash-nav-card:hover {
          transform: translateY(-3px);
          box-shadow: var(--shadow-card-hover);
          border-color: var(--brand-300);
        }
        .dash-mail-item:hover {
          background: var(--bg-hover, #F3F4F6);
        }
        .dash-conv-item:hover {
          background: var(--bg-hover, #F3F4F6);
        }
        @keyframes pulse-soft {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .dash-skeleton {
          animation: pulse-soft 1.5s ease-in-out infinite;
        }
      `}</style>
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div style={styles.page}>
        {/* ========== 顶部信息区 ========== */}
        <div style={{ ...styles.header, animation: "dash-fade-in 0.5s ease" }}>
          <div style={styles.headerLeft}>
            <h1 style={styles.greeting}>
              <span style={styles.greetingEmoji}>
                {new Date().getHours() < 12 ? "☀️" : new Date().getHours() < 18 ? "🌤️" : "🌙"}
              </span>
              {getGreeting()}，{user?.display_name || user?.username || "用户"}
            </h1>
            <div style={styles.timeDisplay}>{currentTime}</div>
            <p style={styles.motivation}>{motivation}</p>
          </div>
        </div>

        {/* ========== 快速导航区 ========== */}
        <div style={{ ...styles.quickNav, animation: "dash-fade-in 0.5s 0.1s ease both" }}>
          <Link to="/knowledge" className="dash-nav-card" style={styles.navCard}>
            <div style={{ ...styles.navIconWrap, background: "var(--brand-50)" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--brand-500)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            </div>
            <div style={styles.navTextWrap}>
              <span style={styles.navTitle}>文档上传</span>
              <span style={styles.navSubtitle}>上传企业文档，构建知识库</span>
            </div>
          </Link>

          <Link to="/chat" className="dash-nav-card" style={styles.navCard}>
            <div style={{ ...styles.navIconWrap, background: "#ECFDF5" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
              </svg>
            </div>
            <div style={styles.navTextWrap}>
              <span style={styles.navTitle}>知识问答</span>
              <span style={styles.navSubtitle}>基于知识库的AI智能问答</span>
            </div>
          </Link>

          <Link to="/mail" className="dash-nav-card" style={styles.navCard}>
            <div style={{ ...styles.navIconWrap, background: "#FEF3C7" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M22 4l-10 7-10-7" />
              </svg>
              {unreadCount > 0 && (
                <span style={styles.navBadge}>{unreadCount}</span>
              )}
            </div>
            <div style={styles.navTextWrap}>
              <span style={styles.navTitle}>邮件管理</span>
              <span style={styles.navSubtitle}>
                {unreadCount > 0 || readCount > 0 ? `未读 ${unreadCount} · 已读 ${readCount}` : "AI智能邮件分类处理"}
              </span>
            </div>
          </Link>
        </div>

        {/* ========== 内容区域 ========== */}
        <div style={{ ...styles.content, animation: "dash-fade-in 0.5s 0.2s ease both" }}>
          {/* 知识图谱 - 左半 */}
          <div style={{ ...styles.panel, gridColumn: "1 / 2" }}>
            <div style={styles.panelHeader}>
              <h2 style={styles.panelTitle}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand-500)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5.64 5.64l2.83 2.83M15.54 15.54l2.83 2.83M5.64 18.36l2.83-2.83M15.54 8.46l2.83-2.83" />
                </svg>
                知识图谱
                {categories.length > 0 && (
                  <span style={styles.panelBadge}>{categories.length}</span>
                )}
              </h2>
              <Link to="/knowledge" style={styles.panelMore}>查看全部 →</Link>
            </div>
            <div style={styles.graphContainer}>
              {loadingCategories ? (
                <div style={{ color: "var(--text-tertiary)", fontSize: "var(--font-sm)" }}>加载中...</div>
              ) : (
                <KnowledgeGraph categories={categories} counts={categoryCounts} />
              )}
            </div>
          </div>

          {/* 邮件预览 - 右半 */}
          <div style={{ ...styles.panel, gridColumn: "2 / 3", maxHeight: 340 }}>
            <div style={styles.panelHeader}>
              <h2 style={styles.panelTitle}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand-500)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M22 4l-10 7-10-7" />
                </svg>
                邮件预览
              </h2>
              <Link to="/mail" style={styles.panelMore}>查看全部 →</Link>
            </div>
            {/* 邮件数量统计 */}
            <div style={{ ...styles.mailHeader, flexShrink: 0 }}>
              <span style={styles.mailTotalCount}>
                未读 <span style={{ ...styles.mailCountStrong, color: "var(--brand-500)" }}>{unreadCount}</span> 封
                <span style={{ margin: "0 8px", color: "var(--text-tertiary)" }}>|</span>
                已读 <span style={{ ...styles.mailCountStrong, color: "var(--text-secondary)" }}>{readCount}</span> 封
              </span>
            </div>
            <div style={{ ...styles.panelBody, overflow: "auto" }}>
              {loadingMails ? (
                <>
                  <div className="dash-skeleton" style={styles.skeleton} />
                  <div className="dash-skeleton" style={styles.skeleton} />
                  <div className="dash-skeleton" style={styles.skeleton} />
                </>
              ) : recentMails.length === 0 ? (
                <div style={styles.emptyState}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={styles.emptyIcon}>
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="M22 4l-10 7-10-7" />
                  </svg>
                  <span>暂无邮件</span>
                </div>
              ) : (
                recentMails.slice(0, 4).map((mail) => (
                  <Link
                    key={mail.id}
                    to="/mail"
                    className="dash-mail-item"
                    style={styles.mailItem}
                  >
                    <div style={styles.mailItemLeft}>
                      {!mail.is_read && <div style={styles.mailUnreadDot} />}
                    </div>
                    <div style={styles.mailItemContent}>
                      <div style={styles.mailItemHeader}>
                        <span style={{ ...styles.mailSender, fontWeight: mail.is_read ? 500 : 600 }}>{mail.sender}</span>
                        <span style={styles.mailTime}>{formatMailTime(mail.received_at)}</span>
                      </div>
                      <div style={{ ...styles.mailSubject, fontWeight: mail.is_read ? 400 : 500 }}>{mail.subject}</div>
                      <div style={styles.mailSummary}>{mail.summary}</div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>

          {/* 对话列表 - 全宽 */}
          <div style={{ ...styles.panel, ...styles.contentFull }}>
            <div style={styles.panelHeader}>
              <h2 style={styles.panelTitle}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand-500)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </svg>
                最近对话
                {conversations.length > 0 && (
                  <span style={styles.panelBadge}>{conversations.length}</span>
                )}
              </h2>
              <Link to="/chat" style={styles.panelMore}>查看全部 →</Link>
            </div>
            <div style={{ ...styles.panelBody, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, padding: 0 }}>
              {loadingConvs ? (
                <div style={{ gridColumn: "1 / -1", padding: "var(--space-4)" }}>
                  <div className="dash-skeleton" style={styles.skeleton} />
                  <div className="dash-skeleton" style={styles.skeleton} />
                </div>
              ) : conversations.length === 0 ? (
                <div style={{ ...styles.emptyState, gridColumn: "1 / -1" }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={styles.emptyIcon}>
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                  </svg>
                  <span>暂无对话记录，去开启一段新对话吧</span>
                </div>
              ) : (
                conversations.slice(0, 8).map((conv, i) => (
                  <Link
                    key={conv.session_id}
                    to={`/chat?session_id=${conv.session_id}`}
                    className="dash-conv-item"
                    style={{
                      ...styles.convItem,
                      borderRight: i % 2 === 0 ? "1px solid var(--border-light)" : "none",
                    }}
                  >
                    <div style={styles.convIcon}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                      </svg>
                    </div>
                    <div style={styles.convContent}>
                      <div style={{ ...styles.convTitle, display: "flex", alignItems: "center", gap: 4 }}>
                        {conv.starred && (
                          <svg width="12" height="12" viewBox="0 0 14 14" fill="#F5A623" style={styles.convStar}>
                            <path d="M7 1l1.57 3.69 3.93.43-2.93 2.67.78 3.9L7 10.16l-3.35 1.53.78-3.9L1.5 5.12l3.93-.43L7 1z" />
                          </svg>
                        )}
                        {conv.title || "未命名对话"}
                      </div>
                      <div style={styles.convMeta}>
                        <span>{conv.message_count} 条消息</span>
                        <span>·</span>
                        <span>{formatConvTime(conv.updated_at)}</span>
                      </div>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={styles.convArrow}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}