# Enterprise AI Agent — 企业级 RAG 知识库智能体平台

> **项目定位**：面向中小型企业的 AI 办公中枢，融合 RAG 知识库问答、智能邮件助理、文档管理中心三大核心场景，为企业提供"私有知识库 + AI 大模型"的一站式解决方案。

---

## 一、项目介绍

### 1.1 项目背景

在企业日常运营中，员工每天需要花费大量时间在以下场景：

- **查找内部制度与流程**：公司制度、项目规范、操作手册分散在 OA 系统、Wiki、Word 文档中，检索效率低下
- **处理邮件**：分类、回复、起草邮件占用大量碎片时间
- **文档管理**：部门文档上传后缺乏统一检索入口，历史经验难以复用

传统方案要么依赖昂贵的商业 SaaS（数据外泄风险），要么使用开源工具拼凑（运维成本高、集成困难）。本项目以 **RAG（检索增强生成）** 技术为核心，将企业内部文档转化为可检索的知识库，结合大模型的推理能力，实现"上传即问答"、"AI 辅助撰写邮件"的智能化办公体验。

### 1.2 应用前景

| 行业 | 典型场景 |
|------|---------|
| **法律/合规** | 上传法规文件，AI 自动回答合规咨询，减少人工查阅 |
| **制造业** | 上传设备手册、质检标准，一线工人语音/文字提问即时获取操作规范 |
| **IT 服务** | 上传技术文档、故障处理经验，新手工程师快速定位问题 |
| **教育培训** | 上传课程资料、考试大纲，学生/员工自助查询学习内容 |
| **行政管理** | 上传公司制度、报销流程，AI 代替 HR/行政回答重复性问题 |
| **项目管理** | 上传项目立项规范、审批流程，AI 辅助项目合规检查 |

### 1.3 核心功能

```mermaid
graph LR
    A[知识库管理] --> A1[文档上传<br/>PDF/Word/Excel/TXT]
    A --> A2[自动解析分块<br/>向量化入库]
    A --> A3[文档状态追踪<br/>防重/去重]

    B[智能问答] --> B1[RAG 检索增强<br/>基于知识库回答]
    B --> B2[Web 搜索降级<br/>知识库无结果时联网]
    B --> B3[多轮对话记忆<br/>上下文连续追问]
    B --> B4[引用来源标注<br/>回答可溯源]

    C[邮件中心] --> C1[多邮箱绑定<br/>QQ/163/Outlook]
    C --> C2[AI 邮件分类<br/>需回复/通知/垃圾]
    C --> C3[AI 起草邮件<br/>主题+收件人→自动撰写]
    C --> C4[草稿审阅发送<br/>人工修改后发出]

    D[安全体系] --> D1[JWT 身份认证<br/>角色权限控制]
    D --> D2[Prompt 注入检测<br/>PII 自动脱敏]
    D --> D3[主备模型降级<br/>服务高可用]
```

### 1.4 快速理解项目代码

**新手阅读路径**（按推荐顺序）：

| 步骤 | 文件 | 理解什么 |
|------|------|---------|
| 1 | [main.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/main.py) | 应用启动入口：中间件、路由挂载、生命周期 |
| 2 | [.env](file:///d:/Code/PythonCode/enterprise_ai_agent/.env) | 所有配置项一览：数据库、LLM、邮件、RAG 参数 |
| 3 | [config.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/core/config.py) | 配置类定义：Settings 是如何从 .env 加载的 |
| 4 | [db_models.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/models/db_models.py) | 数据库表结构：User、Document、Chunk、UserMailAccount |
| 5 | [api/qa_routes.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/api/qa_routes.py) | 核心问答 API：RAG 上下文注入 → Agent 流式推理 |
| 6 | [agent_engine.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/core/agent_engine.py) | Agent 引擎：LangGraph 组装、工具调用、对话记忆 |
| 7 | [agent_tools.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/modules/agent_tools.py) | 工具集：知识库搜索、Web 搜索、发邮件、时间查询 |
| 8 | [rag_engine.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/modules/rag_engine.py) | RAG 引擎：查询改写 → 向量检索 → 上下文组装 |
| 9 | [vector_store.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/modules/vector_store.py) | 向量库：Milvus Lite 连接、Schema、搜索、写入 |
| 10 | [document_tasks.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/tasks/document_tasks.py) | 文档处理：Celery 异步解析 → 分块 → 向量化 → 入库 |
| 11 | [App.tsx](file:///d:/Code/PythonCode/enterprise_ai_agent/frontend/src/App.tsx) | 前端路由：6 个页面视图的导航结构 |

**核心数据流速览**：

```
用户上传文档 → Celery 异步解析 → 分块 + 向量化 → 存入 PostgreSQL
                                                         ↓
用户提问 → RAG 引擎检索 → 同步分块到 Milvus → 向量相似度搜索
                                                         ↓
                                上下文注入用户消息 → LangGraph Agent 流式推理 → SSE 返回答案
```

---

## 二、关于 Milvus 数据库

**Milvus 确实在使用**，采用的是 **Milvus Lite（本地嵌入式模式）**，数据存储在 `./data/milvus.db`。它不是连接远程 Milvus 服务器，而是将 Milvus 作为嵌入式向量库运行在进程内，通过 `pymilvus.MilvusClient(uri="./data/milvus.db")` 调用。

核心实现见 [vector_store.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/modules/vector_store.py)：

- Collection 名：`enterprise_knowledge_base`
- 向量维度：**1024**（对应 `text-embedding-v3` 模型）
- 索引类型：**HNSW + COSINE** 相似度
- Schema 字段：`id`, `content`, `doc_id`, `chunk_index`, `department_id`, `header_path`, `embedding`

由于 Milvus Lite 使用文件锁，同一时间只有一个进程可以访问，因此项目采用 **Celery 解析分块 → 存入 PostgreSQL → FastAPI 检索时按需同步到 Milvus** 的架构，避免了多进程锁冲突。

---

## 三、技术栈一览

### 3.1 后端（Python 3.13+）

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| **Web 框架** | FastAPI | >=0.115 | REST API 服务 |
| **ASGI 服务器** | Uvicorn | >=0.34 | 运行 FastAPI 应用 |
| **ORM** | SQLAlchemy (异步) | >=2.0.36 | 数据库对象映射 |
| **数据库驱动** | asyncpg | >=0.30 | PostgreSQL 异步驱动 |
| **数据验证** | Pydantic / Pydantic-Settings | >=2.10 / >=2.7 | 请求体验证 / 配置管理 |
| **LLM SDK** | OpenAI | >=1.58 | 兼容 DashScope API |
| **Agent 框架** | LangChain | >=0.3 | AI Agent 工具链 |
| | LangGraph | >=0.4 | Agent 编排与工具调用 |
| | langgraph-checkpoint-sqlite | >=2.0 | 对话历史持久化 |
| **向量数据库** | PyMilvus | >=2.5 | Milvus Lite 向量存储与检索 |
| **文档解析** | PyMuPDF (fitz) | >=1.25 | PDF 解析 |
| | python-docx | >=1.1 | Word 文档解析 |
| | openpyxl | >=3.1 | Excel 解析 |
| **文本分块** | langchain-text-splitters | >=0.3 | 文档语义分块 |
| **异步任务** | Celery + Redis | >=5.4 / >=5.2 | 文档后台处理队列 |
| **重试机制** | tenacity | >=9.0 | LLM 调用自动重试 |
| **邮件** | aioimaplib | >=2.0 | IMAP 收信 |
| | aiosmtplib | >=3.0 | SMTP 发信 |
| **Web 搜索** | langchain-tavily | >=0.1 | Agent 联网搜索能力 |
| **认证** | PyJWT | >=2.10 | JWT 身份认证 |
| **文件上传** | python-multipart | >=0.0.18 | 文件上传解析 |

### 3.2 前端

| 类别 | 技术 | 版本 |
|------|------|------|
| **框架** | React | 19.2 |
| **构建工具** | Vite | 8.0 |
| **语言** | TypeScript | 6.0 |
| **路由** | react-router-dom | 7.16 |

### 3.3 基础设施

| 组件 | 用途 | 配置 |
|------|------|------|
| **PostgreSQL** | 业务数据持久化 | `localhost:5432`，不可用时自动降级为 SQLite |
| **Redis** | Celery 消息队列 | `localhost:6379` |
| **Milvus Lite** | 向量检索 | `./data/milvus.db`（嵌入式，无需独立部署） |
| **DashScope** | LLM + Embedding | 阿里云通义千问 API（兼容 OpenAI 协议） |

---

## 四、项目目录结构

```
enterprise_ai_agent/
├── start.ps1                     # 一键启动脚本（前后端 + Celery）
├── pyproject.toml                # Python 项目配置与依赖
├── .env                          # 环境变量（LLM密钥、数据库、邮件等）
├── reset_chunks.py               # 工具脚本：重置分块向量 ID
├── PROJECT_OVERVIEW.md           # 本文档
├── data/                         # 运行时数据目录
│   ├── milvus.db                 # Milvus Lite 向量库文件
│   ├── agent_checkpoint.db       # Agent 对话记忆 SQLite
│   └── enterprise_ai.db          # SQLite 降级数据库（PostgreSQL 不可用时）
│
├── backend/                      # ========== 后端 ==========
│   ├── main.py                   # FastAPI 应用入口：中间件、路由挂载、生命周期
│   ├── uploads/                  # 文档上传临时目录
│   │
│   ├── core/                     # 核心基础设施层
│   │   ├── config.py             # 全局配置中心（Settings 单例，从 .env 加载）
│   │   ├── database.py           # 数据库连接池（PG 优先，SQLite 降级）
│   │   ├── llm_client.py         # LLM 路由网关（主备降级、重试、流式、结构化输出）
│   │   ├── agent_engine.py       # LangGraph Agent 引擎（对话 + 工具调用）
│   │   ├── auth.py               # JWT 认证逻辑（签发/验证）
│   │   ├── security.py           # bcrypt 密码哈希
│   │   ├── security_gateway.py   # Prompt 注入检测 + PII 脱敏
│   │   └── seed.py               # 种子用户初始化（首次启动自动创建管理员）
│   │
│   ├── api/                      # API 路由层（薄层，不写业务逻辑）
│   │   ├── auth_routes.py        # 登录/登出/注册
│   │   ├── knowledge_routes.py   # 知识库文档 CRUD + 上传
│   │   ├── qa_routes.py          # 智能问答（SSE 流式 + RAG 上下文注入）
│   │   ├── mail_routes.py        # 邮件中心 + AI 起草草稿 + 发送
│   │   └── deps.py               # 依赖注入（提取当前登录用户）
│   │
│   ├── services/                 # 业务服务层（编排多个模块）
│   │   ├── knowledge_service.py  # 文档处理编排、分块同步 Milvus
│   │   ├── mail_service.py       # 邮箱账户绑定/解绑业务
│   │   ├── chat_service.py       # 对话会话管理
│   │   └── search_service.py     # 统一搜索入口
│   │
│   ├── modules/                  # 功能模块层（可复用的领域组件）
│   │   ├── vector_store.py       # Milvus 向量库客户端（Collection/Search/Upsert）
│   │   ├── rag_engine.py         # RAG 检索引擎（查询改写→检索→过滤→上下文组装）
│   │   ├── document_parser.py    # 多格式文档解析（PDF/Word/Excel/TXT）
│   │   ├── text_splitter.py      # 语义文本分块（递归字符分割）
│   │   ├── mail_handler.py       # 邮件收发（IMAP 收信 + SMTP 发信）
│   │   └── agent_tools.py        # LangGraph 工具集（知识库搜索、Web 搜索、发邮件、时间）
│   │
│   ├── repositories/             # 数据访问层（DAO）
│   │   ├── base.py               # 抽象基仓库（CRUD 模板）
│   │   ├── document_repo.py      # 文档/分块 CRUD
│   │   └── mail_account_repo.py  # 邮箱账户 CRUD
│   │
│   ├── models/                   # 数据模型定义
│   │   ├── db_models.py          # SQLAlchemy ORM 模型（User/Document/Chunk/UserMailAccount）
│   │   └── schemas.py            # Pydantic 请求/响应模型
│   │
│   └── tasks/                    # Celery 异步任务
│       ├── celery_app.py         # Celery 应用配置（Redis broker、并发数）
│       └── document_tasks.py     # 文档后台处理（解析→分块→向量化→入库）
│
└── frontend/                     # ========== 前端 ==========
    ├── package.json              # 前端依赖与脚本
    ├── vite.config.ts            # Vite 配置（代理 /api → :8000）
    └── src/
        ├── App.tsx               # 路由定义（6 个页面）
        ├── main.tsx              # React 入口
        ├── types/index.ts        # TypeScript 类型定义
        ├── services/api.ts       # API 请求封装（所有后端接口调用）
        ├── contexts/AuthContext.tsx  # 认证上下文（登录状态管理）
        ├── components/           # 通用组件
        │   ├── Layout.tsx        # 全局布局（侧边栏 + 顶栏）
        │   ├── ErrorBoundary.tsx # 错误边界
        │   └── RouteGuard.tsx    # 路由守卫（登录/管理员权限）
        └── views/                # 页面视图
            ├── LoginView.tsx     # 登录页
            ├── KnowledgeView.tsx # 知识库管理（上传/列表/删除）
            ├── QaView.tsx        # 智能问答（流式对话 + 引用显示）
            ├── MailView.tsx      # 邮件中心（收件箱/同步/AI 起草）
            ├── SettingsView.tsx  # 系统设置（管理员）
            └── NotFoundView.tsx  # 404 页面
```

---

## 五、模块职责与数据流

### 5.1 核心基础设施层 (`backend/core/`)

| 模块 | 职责 |
|------|------|
| **[config.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/core/config.py)** | 全局配置单例，从 `.env` 加载所有配置，含 LLM/DB/RAG/Mail 等嵌套配置，支持字段校验和模型关联 |
| **[database.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/core/database.py)** | 异步数据库连接池管理，优先 PostgreSQL，不可用时自动降级为 SQLite，提供 `get_db()` 依赖注入 |
| **[llm_client.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/core/llm_client.py)** | LLM 路由网关 `LLMRouter`，支持主备双链路降级、指数退避重试、流式输出、结构化输出、Embedding 向量化 |
| **[agent_engine.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/core/agent_engine.py)** | LangGraph Agent 引擎 `AgentEngine`，组装 LLM + 工具集 + checkpointer，实现多轮对话记忆 |
| **[auth.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/core/auth.py)** | JWT 令牌签发/验证 |
| **[security.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/core/security.py)** | bcrypt 密码哈希 |
| **[security_gateway.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/core/security_gateway.py)** | Prompt 注入攻击检测（7 条正则规则）+ PII 自动脱敏（手机号/身份证/邮箱/银行卡） |
| **[seed.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/core/seed.py)** | 首次启动时自动创建管理员账户 |

### 5.2 功能模块层 (`backend/modules/`)

| 模块 | 职责 |
|------|------|
| **[vector_store.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/modules/vector_store.py)** | Milvus 向量库客户端，支持本地 Lite 模式和远程模式，自动建 Schema、HNSW 索引、分批安全写入、标量过滤检索 |
| **[rag_engine.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/modules/rag_engine.py)** | RAG 完整检索链路：查询改写 → Embedding → Milvus 检索 → 相似度过滤 → 引用标记组装 |
| **[document_parser.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/modules/document_parser.py)** | 多格式文档解析（PDF、Word、Excel、TXT、Markdown），输出标准化的 Markdown 文本 + 结构元数据 |
| **[text_splitter.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/modules/text_splitter.py)** | 语义文本分块，使用 langchain-text-splitters 递归字符分割，保留标题层级和页码元数据 |
| **[mail_handler.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/modules/mail_handler.py)** | 邮件收发核心，IMAP 收信（UID 模式，兼容 QQ/163/Gmail）、SMTP 发信（SSL），支持多文件夹 |
| **[agent_tools.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/modules/agent_tools.py)** | LangGraph 工具集：`search_knowledge_base`（知识库检索）、`search_web`（Tavily 联网搜索）、`send_enterprise_email`（发邮件）、`get_current_time`（时间查询） |

### 5.3 API 路由层 (`backend/api/`)

| 路由 | 端点前缀 | 功能 |
|------|---------|------|
| **[auth_routes.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/api/auth_routes.py)** | `/api/auth` | 登录 `/login`、注册 `/register` |
| **[knowledge_routes.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/api/knowledge_routes.py)** | `/api/knowledge` | 文档上传 `/upload`、列表 `/list`、删除 `/delete`、状态查询 `/status` |
| **[qa_routes.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/api/qa_routes.py)** | `/api/qa` | 智能问答 `/ask/stream`（SSE 流式，自动注入 RAG 上下文） |
| **[mail_routes.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/api/mail_routes.py)** | `/api/mail` | 邮件列表 `/list`、同步 `/sync`、详情 `/detail`、分类 `/classify`；AI 起草草稿 `/draft`；发送邮件 `/send`；邮箱账户绑定 `/account/bind` / 解绑 `/account/{user_id}` |

### 5.4 业务服务层 (`backend/services/`)

| 服务 | 职责 |
|------|------|
| **[knowledge_service.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/services/knowledge_service.py)** | 文档上传编排（保存→Celery 任务投递）、分块同步至 Milvus（解决多进程锁冲突） |
| **[mail_service.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/services/mail_service.py)** | 邮箱账户绑定/解绑/密码解密 |
| **[chat_service.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/services/chat_service.py)** | 对话会话管理 |
| **[search_service.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/services/search_service.py)** | 统一搜索入口 |

### 5.5 数据访问层 (`backend/repositories/`)

| 仓库 | 职责 |
|------|------|
| **[base.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/repositories/base.py)** | 抽象基类（CRUD 模板） |
| **[document_repo.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/repositories/document_repo.py)** | 文档与分块的数据库操作（按哈希去重、状态更新、分块批量写入） |
| **[mail_account_repo.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/repositories/mail_account_repo.py)** | 邮箱账户的数据库操作（绑定、解绑、按用户查询） |

### 5.6 异步任务 (`backend/tasks/`)

| 任务 | 职责 |
|------|------|
| **[celery_app.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/tasks/celery_app.py)** | Celery 实例配置（Redis broker、并发数 4、任务序列化、Worker 生命周期管理） |
| **[document_tasks.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/tasks/document_tasks.py)** | 文档处理流程：解析 → 分块 → Embedding 向量化 → 存入 PostgreSQL → 更新状态 |

### 5.7 前端页面 (`frontend/src/views/`)

| 页面 | 路由 | 功能 |
|------|------|------|
| **LoginView** | `/login` | JWT 身份认证，未登录自动跳转 |
| **KnowledgeView** | `/` 或 `/knowledge` | 文档上传（拖拽/点击）、列表展示、状态查询、删除 |
| **QaView** | `/chat` | 流式 AI 对话（SSE 实时渲染）、引用来源展示、多轮对话历史 |
| **MailView** | `/mail` | 邮件收件箱列表、同步新邮件、AI 分类（需回复/通知/垃圾）、AI 起草邮件、草稿审阅发送 |
| **SettingsView** | `/settings` | 管理员专属，系统配置管理 |
| **NotFoundView** | `*` | 404 页面兜底 |

---

## 六、核心数据流

### 6.1 文档上传 → 智能检索全链路

```
用户上传文件
  └─ knowledge_routes.py          接收文件，校验格式，SHA256 去重
       └─ knowledge_service.py    创建 Document 记录（状态=PENDING）
            └─ Celery: process_document()
                 ├─ document_parser.py  解析为 Markdown 全文
                 ├─ text_splitter.py    语义分块 → 文本块列表
                 ├─ llm_client.get_embeddings()  向量化（1024 维）
                 ├─ document_repo.save_chunks()  存入 PostgreSQL
                 └─ 状态更新为 COMPLETED

用户发起问答
  └─ qa_routes.py /ask/stream
       ├─ SecurityGateway      Prompt 注入检测
       ├─ knowledge_service    同步未入库分块到 Milvus
       ├─ rag_engine.retrieve()
       │    ├─ rewrite_query()      结合历史改写查询
       │    ├─ llm_client.get_embeddings()  查询向量化
       │    ├─ vector_store.search()  Milvus 向量检索
       │    ├─ 相似度阈值过滤（settings.RAG_SCORE_THRESHOLD）
       │    └─ _assemble_context()   组装 [n] 引用标记上下文
       ├─ 上下文注入用户消息
       └─ AgentEngine.astream()   LangGraph Agent 流式推理
            └─ SSE 流式返回（token/sources/done 事件）
```

### 6.2 AI 邮件起草流程

```
用户在邮件中心点击"AI 起草邮件"
  └─ 输入收件人 + 主题 + 可选要求
       └─ POST /api/mail/draft
            └─ LLMRouter.chat_completion()  调用 qwen-plus 生成专业邮件正文
                 └─ 返回 {to, subject, body}

  └─ 前端展示可编辑草稿
       └─ 用户修改正文
            └─ 点击"发送" → POST /api/mail/send
                 └─ mail_handler.send()  SMTP SSL 发送
            └─ 点击"取消" → 关闭草稿
```

### 6.3 Agent 工具调用决策流程

```
用户提问
  └─ Agent 分析问题
       ├─ 涉及内部知识 → 调用 search_knowledge_base（Milvus 检索）
       ├─ 知识库无结果 → 调用 search_web（Tavily 联网搜索）
       ├─ 要求发邮件   → 调用 send_enterprise_email（SMTP 发送）
       └─ 询问时间     → 调用 get_current_time（系统时间）
```

---

## 七、安全机制

| 层级 | 机制 | 实现位置 |
|------|------|---------|
| **传输层** | JWT Bearer Token 认证，所有 API 需携带令牌 | [auth.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/core/auth.py) + [deps.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/api/deps.py) |
| **网络层** | CORS 白名单，仅允许配置的源访问 | [main.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/main.py#L198-L204) |
| **输入层** | Prompt 注入检测（7 条正则规则），命中即拦截 | [security_gateway.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/core/security_gateway.py#L33-L42) |
| **隐私层** | PII 自动脱敏（手机号/身份证/邮箱/银行卡），用占位符替换 | [security_gateway.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/core/security_gateway.py#L44-L50) |
| **存储层** | 用户密码 bcrypt 哈希存储，不可逆 | [security.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/core/security.py) |
| **访问层** | 路由级角色保护（AdminRoute），管理员专属页面 | [RouteGuard.tsx](file:///d:/Code/PythonCode/enterprise_ai_agent/frontend/src/components/RouteGuard.tsx) |
| **运维层** | 生产环境异常脱敏，不暴露堆栈，仅返回 request_id | [main.py](file:///d:/Code/PythonCode/enterprise_ai_agent/backend/main.py#L145-L170) |

---

## 八、快速启动

### 前置条件

1. **PostgreSQL** 运行在 `localhost:5432`（或自动降级为 SQLite）
2. **Redis** 运行在 `localhost:6379`
3. Python 3.13+ 虚拟环境 `.venv` 已创建
4. 前端依赖已安装（`cd frontend && npm install`）

### 一键启动

```powershell
.\start.ps1                   # 启动全部服务（Celery + 后端 + 前端）
.\start.ps1 -NoFrontend       # 仅启动后端服务
.\start.ps1 -NoCelery         # 不启动 Celery（无法处理文档上传）
```

### 手动启动

```powershell
# 终端 1：Celery Worker
.venv\Scripts\celery.exe -A backend.tasks.celery_app worker --loglevel=info --concurrency=2

# 终端 2：FastAPI 后端
.venv\Scripts\uvicorn.exe backend.main:app --host 0.0.0.0 --port 8000 --reload

# 终端 3：Vite 前端
cd frontend && npm run dev
```

启动后访问：

| 地址 | 说明 |
|------|------|
| http://localhost:5173 | 前端页面 |
| http://localhost:8000/docs | API 文档（Swagger） |
| http://localhost:8000/redoc | API 文档（ReDoc） |

---

## 九、配置说明

所有配置集中在 `.env` 文件中，关键配置项：

```ini
# === 基础环境 ===
APP_ENV=development          # development | staging | production
DEBUG=true

# === 数据库 ===
POSTGRES_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/enterprise_ai
REDIS_URL=redis://localhost:6379/0
MILVUS_HOST=./data/milvus.db  # 本地 Milvus Lite 路径

# === LLM（DashScope 兼容 OpenAI 协议）===
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_API_KEY=sk-xxxxxxxx        # 阿里云 DashScope API Key
AGENT_MODEL_NAME=qwen-plus           # Agent 使用的模型
EMBEDDING_MODEL_NAME=text-embedding-v3  # 向量化模型（1024 维）

# === 邮件服务 ===
MAIL__IMAP_HOST=imap.qq.com
MAIL__IMAP_PORT=993
MAIL__SMTP_HOST=smtp.qq.com
MAIL__SMTP_PORT=465
MAIL__USERNAME=your_email@qq.com
MAIL__PASSWORD=your_auth_code        # QQ 邮箱授权码

# === RAG 参数 ===
CHUNK_SIZE=500              # 文本分块大小
CHUNK_OVERLAP=50            # 分块重叠字符数
RAG_TOP_K=5                 # 向量检索 Top-K
RAG_SCORE_THRESHOLD=0.3     # 相似度阈值
```

---

## 十、数据库表结构

### 4 张核心表

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| **users** | 系统用户 | `id`, `username`, `password_hash`, `role`(admin/employee), `department` |
| **documents** | 知识库文档 | `id`, `filename`, `file_hash`(SHA256 去重), `status`(PENDING/PROCESSING/COMPLETED/FAILED), `user_id` |
| **chunks** | 文档分块 | `id`, `document_id`(FK), `chunk_index`, `content`, `vector_id`, `metadata`(JSON) |
| **user_mail_accounts** | 邮箱账户 | `id`, `user_id`, `provider`(qq/163/gmail), `email_address`, `imap_host/port`, `smtp_host/port`, `encrypted_password` |

### 数据关系

```
users (1) ──────────< documents (N)
                           │
                           └──< chunks (N)  ── 关联 ──> Milvus 向量库
users (1) ──────────< user_mail_accounts (1)
```

---

> **文档版本**: v0.1.0 | **最后更新**: 2026-06-04 | **维护者**: Enterprise AI Agent Team