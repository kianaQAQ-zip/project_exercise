# Enterprise AI Agent 项目展示报告

---

## 一、项目概述

Enterprise AI Agent 是一个面向企业的全栈 AI 智能助手平台，集成了**知识库检索增强生成（RAG）**、**LangGraph 多工具智能体**、**AI 邮件助理**三大核心能力。采用 Python/FastAPI 后端 + React/TypeScript 前端架构，支持 PostgreSQL/SQLite 双数据库模式，Redis 作为 Celery 消息队列。

---

## 二、AI Agent 相关技术与实现逻辑

### 2.1 技术栈全景

| 层级 | 技术 | 用途 |
|------|------|------|
| LLM 服务 | 阿里云 DashScope / OpenAI 兼容 API | 大模型推理（对话、分类、摘要、起草） |
| Agent 框架 | LangGraph | 多工具智能体编排，支持对话记忆 |
| 对话记忆 | LangGraph Checkpoint (SQLite) | 多轮对话状态持久化与线程隔离 |
| RAG 检索 | 自研向量检索引擎 | PostgreSQL 存储 + Python 余弦相似度计算 |
| 文档解析 | PyMuPDF / python-docx / openpyxl | 多格式文档解析（PDF/Word/Excel/Markdown） |
| 文本切分 | LangChain TextSplitter | Markdown 语义切分 + 递归字符切分 |
| 异步任务 | Celery + Redis | 文档处理离线任务队列 |
| 安全防护 | 正则引擎 | 提示词注入检测 + PII 脱敏 |

### 2.2 AI Agent 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│                      用户输入 (Query)                        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  SecurityGateway (安全网关)                   │
│  ① 提示词注入检测 (7种攻击模式正则匹配)                        │
│  ② PII 脱敏 (手机号/身份证/邮箱/银行卡 → 哈希占位符)           │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│               RAGEngine (检索增强生成引擎)                      │
│  ① Query Rewriting: LLM 改写查询，消解指代                     │
│  ② Embedding: DashScope text-embedding-v4 向量化              │
│  ③ Vector Search: PostgreSQL 全量加载 + 余弦相似度 TopK        │
│  ④ Context Assembly: 带编号引用的上下文拼接                     │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│            AgentEngine (LangGraph 多工具智能体)                │
│  工具集:                                                      │
│  ├─ search_knowledge_base: 知识库检索                          │
│  ├─ search_web: Tavily 网络搜索                                │
│  ├─ send_enterprise_email: 发送企业邮件                        │
│  └─ get_current_time: 获取当前时间                             │
│                                                               │
│  记忆: AsyncSqliteSaver (thread_id 隔离多用户会话)             │
│  输出: 流式 SSE (token/sources/done) 或 非流式                  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              CitationProcessor (引用后处理)                     │
│  ① 提取 [n] 引用标记                                          │
│  ② 校验引用有效性（防止幻觉引用）                                │
│  ③ 格式化来源信息返回前端                                       │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 实现逻辑步骤

#### 步骤一：文档知识库构建（离线处理）

1. **文档上传**：用户通过前端上传 PDF/Word/Excel/Markdown/TXT 文件
2. **SHA256 去重**：计算文件哈希，避免重复上传
3. **Celery 异步任务**：文档处理推入 Redis 队列，后台异步执行
4. **文档解析**：`DocumentParser` 根据文件类型路由到对应解析器（PyMuPDF/pdfplumber/python-docx/openpyxl），提取文本块并识别标题层级
5. **AI 分类**：`LLMRouter.chat_completion_structured` 调用 LLM，根据文件名+内容自动分类（如"技术文档"、"财务报告"等）
6. **语义切分**：`SemanticTextSplitter` 先按 Markdown 标题层级切分，再用 `RecursiveCharacterTextSplitter` 按句子边界递归切分
7. **向量嵌入**：`LLMRouter.get_embeddings()` 批量调用 DashScope text-embedding-v4，每批 10 条
8. **持久化存储**：文本块 + 嵌入向量（JSON 数组）存入 PostgreSQL `chunks` 表

#### 步骤二：智能问答（在线推理）

1. **安全网关**：`SecurityGateway.inspect()` 检测提示词注入（如"忽略之前的指令"、"reveal your prompt" 等 7 种攻击模式），并对 PII 进行哈希脱敏
2. **查询改写**：`RAGEngine.rewrite_query()` 调用 LLM 将用户问题结合历史对话进行共指消解（如"它的价格" → "iPhone 15 的价格"）
3. **向量检索**：查询向量化 → `VectorStore.search()` 全量加载 chunks 表 → Python 余弦相似度计算 → 取 TopK → 分数阈值过滤
4. **Agent 推理**：`AgentEngine`（基于 LangGraph `create_agent`）携带检索到的上下文 + 工具列表，调用大模型进行推理
5. **流式输出**：`astream()` 生成器逐 token 返回前端，同时解析工具调用结果中的引用来源
6. **引用校验**：`CitationProcessor` 提取回答中的 `[n]` 标记，验证是否存在于实际检索结果中，过滤幻觉引用
7. **PII 审计**：回答内容再次检查是否包含 PII 泄漏

#### 步骤三：邮件 AI 助理

1. **邮箱绑定**：用户绑定 IMAP/SMTP 凭证（QQ/163/Gmail/Outlook），加密存储
2. **邮件同步**：`mail_handler.fetch_recent()` 通过 IMAP 拉取最近 7 天邮件 → `MailService._analyze_single_mail()` 调用 LLM 结构化输出（`MailClassification` Pydantic 模型）进行分类和摘要 → 去重存入数据库
3. **AI 分类**：LLM 将邮件分为 URGENT（紧急）/ INQUIRY（咨询）/ NOTIFICATION（通知）/ SPAM（垃圾）/ UNKNOWN
4. **AI 起草**：`LLMRouter.chat_completion` 根据用户指令 + 原邮件内容生成回复草稿
5. **自动清理**：超过 7 天的邮件自动从数据库删除

---

## 三、后端模块详细介绍

### 3.1 核心层（`backend/core/`）

#### `config.py` — 配置管理
- 基于 Pydantic `BaseSettings`，从 `.env` 文件加载所有配置
- 覆盖：数据库连接、Redis、LLM API Key/端点、邮件服务器、JWT 密钥、CORS 等
- 单例模式 + `@lru_cache` 缓存

#### `database.py` — 数据库连接
- 支持 PostgreSQL 优先、SQLite 回退的双引擎策略
- 异步 SQLAlchemy 引擎 + `async_sessionmaker`
- 启动时自动 `create_all` 建表 + 列迁移（`_migrate_columns`）
- `get_db()` FastAPI 依赖注入，自动提交/回滚

#### `agent_engine.py` — LangGraph 智能体引擎
- 基于 LangGraph 的 `create_agent` 构建
- `AsyncSqliteSaver` 实现对话记忆持久化，`thread_id` 隔离多用户会话
- 系统提示词定义 AI 助手行为边界：先查知识库、再搜网络、可发邮件
- 支持 `ainvoke`（非流式）和 `astream`（流式 SSE）两种调用模式
- `_extract_sources_from_tool_output` 从工具输出中解析结构化引用

#### `llm_client.py` — LLM 路由客户端
- **主备故障切换**：主模型失败时自动切换到备用模型
- **tenacity 重试**：超时/限流/连接错误最多重试 3 次，指数退避
- 支持三种调用模式：普通文本、结构化输出（Pydantic 校验）、流式 SSE
- 嵌入向量生成：自动批处理（每批 10 条），兼容 DashScope API 限制

#### `security_gateway.py` — 安全网关
- **提示词注入检测**：7 种攻击模式的正则匹配（如"ignore previous instructions"、"reveal your prompt"等）
- **PII 脱敏**：中国手机号、身份证号、邮箱、银行卡号 → 哈希占位符替换
- 统一入口 `inspect()`：先检测注入 → 再脱敏
- 支持 PII 恢复（审计用途，绝不在 LLM 路径中使用）

#### `security.py` — 密码与 JWT
- PBKDF2-SHA256 密码哈希（32 字节随机盐）
- HS256 JWT 签发与验证，默认 480 分钟过期
- 无状态的 token 验证，不依赖数据库

#### `auth.py` — 认证依赖
- `get_current_user`：Bearer Token 提取 → JWT 解码 → `UserContext`
- `require_role(role)`：RBAC 角色守卫工厂函数
- 支持 `admin` 和 `employee` 两种角色

#### `seed.py` — 种子数据
- 启动时自动创建 `admin` 和 `employee` 两个测试用户
- 幂等检查，不会重复创建

### 3.2 数据模型层（`backend/models/`）

#### `db_models.py` — SQLAlchemy ORM 模型

| 模型 | 表名 | 说明 |
|------|------|------|
| `User` | `users` | 用户（id, username, password_hash, role, display_name, email, department） |
| `Document` | `documents` | 文档（filename, file_hash 去重, file_size, status, category, chunks 关联） |
| `Chunk` | `chunks` | 文本块（document_id, chunk_index, content, embedding JSON 向量, metadata JSON） |
| `Conversation` | `conversations` | 对话（session_id, title, starred, message_count） |
| `MailMessage` | `mail_messages` | 邮件（mail_uid, sender, subject, body, summary, category, is_read, mail_date） |
| `UserMailAccount` | `user_mail_accounts` | 邮箱账户（provider, email_address, encrypted_password, IMAP/SMTP 配置） |

#### `schemas.py` — Pydantic 请求/响应模型
- `APIResponse[T]`：通用响应包装 `{code, message, data}`
- `PaginatedResponse[T]`：分页响应 `{code, message, data[], total}`
- 请求校验模型（`AskRequest` 限制 query 1-2000 字符）
- ORM 兼容模型（`from_attributes=True`）

### 3.3 业务模块层（`backend/modules/`）

#### `rag_engine.py` — RAG 检索引擎
- **查询改写**：LLM 消解指代，将"它"替换为实际实体
- **检索流程**：改写 → Embedding → 向量搜索 → 分数阈值过滤 → TopK 选取
- **上下文组装**：`[1] 文档名: 内容片段\n[2] 文档名: 内容片段...` 带编号引用
- **历史感知**：注入最近 6 轮对话（每条最多 300 字符）

#### `vector_store.py` — 向量存储
- PostgreSQL 原生方案：embedding 存储为 JSON 浮点数组
- Python 余弦相似度计算，无需外部向量数据库
- 支持按 `department_id` 和 `doc_id` 过滤
- 避免了 Milvus Lite 的文件锁问题

#### `agent_tools.py` — Agent 工具集
- `search_knowledge_base`：调用 RAG 引擎检索知识库
- `search_web`：Tavily API 网络搜索
- `send_enterprise_email`：发送企业邮件
- `get_current_time`：获取上海时区当前时间
- 工具条件加载：Tavily API Key 未配置时自动排除网络搜索工具

#### `document_parser.py` — 文档解析器
- 多格式支持：PDF（PyMuPDF）、DOCX（python-docx）、DOC（多策略回退）、XLSX（openpyxl/xlrd）、Markdown（正则）、TXT（纯文本）
- 标题层级检测：通过字体大小、加粗和 Word 样式识别
- 文件大小限制 50MB
- 结构化输出：`ParsedDocument` 包含 blocks 列表、页面信息、字符统计

#### `text_splitter.py` — 语义文本切分器
- 优先按 Markdown 标题层级切分（`#` ~ `####`）
- 段内递归字符切分：`\n\n` → `\n` → `。` → `.` → `!` → `?` → `;` → ` ` → ``
- 配置项：chunk size、chunk overlap 从 Settings 读取

#### `mail_handler.py` — 邮件处理器
- IMAP 拉取：`fetch_unseen`（未读）、`fetch_recent`（按日期）
- MIME 解析：text/plain 优先，回退 text/html
- SMTP 发送：aiosmtplib 异步发送，支持 HTML 正文和附件
- 动态凭证：支持多用户独立邮箱配置

### 3.4 服务编排层（`backend/services/`）

#### `chat_service.py` — 对话后处理
- `CitationProcessor`：正则提取 `[n]` 引用标记 → 验证范围 → 过滤幻觉引用 → 格式化返回

#### `knowledge_service.py` — 知识库服务
- 编排文档摄入管道：解析 → AI 分类 → 切分 → 嵌入 → 存储
- 信号量控制并发，事务安全的状态更新
- 支持批量摄入

#### `mail_service.py` — 邮件 AI 服务
- 同步最近 7 天邮件：IMAP 拉取 → 并发 AI 分析（`asyncio.gather`）→ 数据库去重 → 过期清理
- AI 邮件分类：`chat_completion_structured` 强制结构化输出（`MailClassification` Pydantic 模型）
- 邮件日期解析：`email.utils.parsedate_to_datetime`

#### `search_service.py` — 搜索服务
- RAG 问答编排：安全检测 → 检索（带超时补偿）→ SSE 流式输出 → PII 脱敏 → 事后审计

### 3.5 数据访问层（`backend/repositories/`）

- `BaseRepository[ModelType]`：通用 CRUD + 分页
- `DocumentRepository`：SHA256 去重、分类筛选、批量保存 chunks
- `ConversationRepo`：自动清理（最多保留 8 个非星标会话）、星标优先排序
- `MailAccountRepository`：按用户 ID 查询、按邮箱查询
- `MailMessageRepository`：UID 去重、已读/未读筛选、过期清理、分类统计

### 3.6 异步任务层（`backend/tasks/`）

- `celery_app.py`：Celery 实例，Redis broker/backend，JSON 序列化
- `document_tasks.py`：`process_document` 任务（最多重试 3 次，间隔 60 秒），Celery 不可用时回退到后台线程
- 任务管道：解析 → AI 分类 → 切分 → 嵌入 → 存储 → 状态更新 → 清理临时文件

### 3.7 API 路由层（`backend/api/`）

| 路由前缀 | 核心端点 | 功能 |
|----------|----------|------|
| `/api/auth` | `POST /login`, `GET /me`, `PUT /profile` | 认证、用户信息、资料更新 |
| `/api/knowledge` | `POST /upload`, `GET /list`, `DELETE /{id}` | 文档上传、列表、删除 |
| `/api/qa` | `POST /ask/stream`, `GET /history/{id}` | 流式问答、对话历史 |
| `/api/conversations` | `GET /list`, `POST /create`, `DELETE /{id}` | 对话管理 |
| `/api/mail` | `POST /sync`, `GET /inbox`, `POST /draft` | 邮件同步、收件箱、AI 起草 |
| `/api/health` | `GET /` | 健康检查 |

---

## 四、前端模块详细介绍

### 4.1 架构概览

```
React 18 + TypeScript + Vite
├── App.tsx (路由 + 全局布局)
├── contexts/ (全局状态)
│   ├── AuthContext (认证状态)
│   └── ThemeContext (主题切换)
├── components/ (通用组件)
│   ├── Layout (主布局壳)
│   ├── Sidebar (侧边导航)
│   ├── StatusBar (状态栏)
│   ├── RouteGuard (路由守卫)
│   ├── ErrorBoundary (错误边界)
│   └── ToastContainer (消息提示)
├── views/ (页面视图)
│   ├── DashboardView (仪表盘)
│   ├── KnowledgeView (知识库)
│   ├── QaView (智能问答)
│   ├── MailView (邮件中心)
│   ├── LoginView (登录)
│   ├── ProfileView (个人中心)
│   └── SettingsView (系统设置)
├── services/api.ts (API 客户端)
├── hooks/useToast.ts (自定义 Hook)
└── types/index.ts (类型定义)
```

### 4.2 核心组件详解

#### `App.tsx` — 应用根组件
- 路由架构：`ErrorBoundary` → `ThemeProvider` → `AuthProvider` → `BrowserRouter` → `Routes`
- 三种路由守卫：`GuestRoute`（未登录可访问）、`ProtectedRoute`（需登录）、`AdminRoute`（需管理员角色）
- 路由表：`/login` → `/`（仪表盘）→ `/knowledge` → `/chat` → `/mail` → `/profile` → `/settings`（管理员）→ 404

#### `AuthContext.tsx` — 认证上下文
- 启动时从 `localStorage` 恢复 token，调用 `/api/auth/me` 验证有效性
- `login(username, password)`：调用 API → 存储 token → 获取用户信息
- `logout()`：清除 localStorage，重置状态
- 全局 Loading 状态：验证期间显示加载动画

#### `Layout.tsx` — 主布局
- 三栏布局：`Sidebar`（固定左侧） + `StatusBar`（顶部） + `<Outlet />`（主内容区）
- 每 30 秒轮询未读邮件数和待处理文档数，更新 `StatusBar` 徽章
- 连接状态实时检测

#### `Sidebar.tsx` — 侧边导航
- 品牌 Logo + 5 个导航项（仪表盘、知识库、智能问答、邮件中心、系统设置）
- 当前路由高亮（`useLocation` 匹配）
- 暗色/亮色主题切换按钮
- 底部用户信息（角色徽章 + 退出登录）

#### `StatusBar.tsx` — 状态栏
- 连接状态指示器（绿点/灰点）
- 未读邮件徽章（红色）
- 待处理文档徽章（橙色）
- 点击可跳转到对应页面

### 4.3 页面视图详解

#### `DashboardView.tsx` — 仪表盘
- **问候语**：根据时段显示（早上好/下午好/晚上好）+ 随机激励语
- **实时时钟**：每秒刷新的上海时间
- **快速导航**：3 个卡片导航到文档上传、知识问答、邮件管理
- **知识图谱**：SVG 绘制的 3D 旋转星球图，每个分类是一个知识球，球内显示文档数量，持续旋转动画
- **邮件预览**：最近 6 封邮件，显示未读/已读数量统计，未读邮件带蓝色圆点
- **最近对话**：双列布局展示最近 8 个对话，星标对话优先

#### `KnowledgeView.tsx` — 知识库
- **文件上传**：拖拽上传 + 点击上传，显示上传进度
- **文档列表**：分页展示，支持分类筛选
- **状态管理**：PENDING（待处理）→ PROCESSING（处理中，带动画）→ COMPLETED（已完成）→ FAILED（失败）
- **状态轮询**：PROCESSING 状态的文档每 5 秒轮询，完成后自动刷新
- **删除确认**：模态框确认，级联删除 chunks
- **分类标签**：文档按 AI 分类显示彩色标签

#### `QaView.tsx` — 智能问答
- **对话侧边栏**：按时间分组（今天/昨天/本周/更早），星标置顶，新建对话按钮
- **聊天区域**：Markdown 渲染（`react-markdown` + `remarkGfm` + `rehypeHighlight`），代码语法高亮
- **流式输出**：SSE 逐 token 渲染，打字机光标动画，支持停止生成
- **引用面板**：可折叠的引用来源列表，展示文档名和摘要
- **建议问题**：初始状态显示 4 个推荐问题，点击直接发送
- **消息导出**：支持导出为 DOCX 和 XLSX 格式
- **对话管理**：重命名、星标、删除对话

#### `MailView.tsx` — 邮件中心
- **邮箱管理**：绑定/更换/解绑邮箱（QQ/163/Gmail/Outlook）
- **三标签页**：未读邮件箱、已读邮件箱、全部邮件，各带数量徽章
- **邮件列表**：发件人、主题、摘要、时间、分类标签（紧急/咨询/通知/垃圾/未分类）
- **邮件详情弹窗**：居中模态框，显示发件人、主题、时间、分类、摘要、正文（400px 可滚动区域）
- **AI 分析**：打开邮件时自动触发 AI 深度分析
- **AI 起草回复**：基于原邮件内容 + 用户指令生成回复草稿
- **AI 起草新邮件**：输入收件人、主题、要求，AI 生成邮件正文
- **同步邮件**：一键从 IMAP 同步最近 7 天邮件
- **全部已读**：一键标记所有未读邮件为已读

#### `SettingsView.tsx` — 系统设置（管理员）
- **系统健康状态**：向量存储、PostgreSQL、Redis 连接状态（绿/红）
- **AI 模型配置**：Agent 模型名称、端点、温度、嵌入模型名称
- 实时刷新健康检查

### 4.4 API 客户端层（`services/api.ts`）

统一的 `request<T>()` 函数封装：
- 自动注入 JWT Bearer Token
- 统一错误处理（解析 JSON 错误体）
- 类型安全的泛型返回

6 个 API 模块：
- `authAPI`：登录、获取用户信息、更新资料、管理员检查
- `knowledgeAPI`：文档上传、列表、删除、分类、验证
- `qaAPI`：流式/非流式问答、对话历史
- `conversationAPI`：对话 CRUD、星标、标题生成
- `mailAPI`：邮件同步、收件箱、已读标记、AI 起草、邮箱账户管理
- `healthAPI` / `configAPI`：系统健康检查、模型配置

### 4.5 类型定义（`types/index.ts`）

完整的 TypeScript 接口定义：
- `DocumentItem`：文档状态联合类型（"PENDING" | "PROCESSING" | "COMPLETED" | "FAILED"）
- `ChatMessage`：消息角色（"user" | "assistant"），含可选的 `Citation[]`
- `Citation`：引用来源（索引、文档名、标题路径、片段）
- `MailItem`：含 `is_read` 布尔字段
- `UserInfo`：角色联合类型（"admin" | "employee"）
- `ConversationItem`：含 `starred` 星标字段
- `ToastMessage`：通知类型（"success" | "error" | "warning" | "info"）

---

## 五、技术亮点总结

1. **LangGraph 多工具智能体**：Agent 可自主决策调用知识库检索、网络搜索、发送邮件等工具，`AsyncSqliteSaver` 实现对话记忆，`thread_id` 隔离多用户会话

2. **主备 LLM 故障切换**：`LLMRouter` 主模型失败时自动切换备用模型，tenacity 重试机制，结构化输出强制 Pydantic 校验

3. **安全防护纵深**：请求级（提示词注入检测 + PII 脱敏）+ 回答级（引用幻觉检测 + PII 审计），不依赖 LLM 做安全判断

4. **PostgreSQL 原生向量存储**：避免外部向量数据库依赖，embedding 存为 JSON 数组，Python 计算余弦相似度

5. **Celery 异步文档处理**：文档上传后立即返回，后台异步解析 → 分类 → 切分 → 嵌入，Celery 不可用时自动回退到后台线程

6. **前端 SSE 流式问答**：打字机效果逐 token 渲染，支持中途停止生成，引用来源面板可折叠查看

7. **邮件 AI 助理**：IMAP 拉取 → LLM 结构化分类 → 数据库持久化 → 7 天自动清理，支持 AI 起草回复和分类统计