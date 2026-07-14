# Enterprise AI Agent — 企业级 RAG 知识库智能体平台

> **面向中小型企业的 AI 办公中枢** — 融合 RAG 知识库问答、智能邮件助理、文档管理中心三大核心场景，为企业提供"私有知识库 + AI 大模型"的一站式解决方案。

[![Python](https://img.shields.io/badge/Python-3.13+-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-green.svg)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 目录

- [核心功能](#核心功能)
- [适用场景](#适用场景)
- [技术栈](#技术栈)
- [快速启动](#快速启动)
- [架构概览](#架构概览)
- [项目结构](#项目结构)
- [配置说明](#配置说明)
- [API 文档](#api-文档)
- [安全机制](#安全机制)

---

## 核心功能

### 1. 知识库管理 (`/knowledge`)
- **多格式文档上传**：支持 PDF、Word (.docx/.doc)、Excel (.xlsx/.xls)、Markdown、纯文本
- **自动解析与向量化**：上传后自动解析为结构化文本，分块后向量化存入知识库
- **文档去重**：基于 SHA256 哈希自动检测重复文档
- **AI 自动分类**：根据文档内容自动生成分类标签
- **状态追踪**：实时查看文档处理状态（待处理/处理中/已完成/失败）

### 2. 智能问答 (`/chat`)
- **RAG 检索增强**：基于知识库内容的精准问答，回答可溯源
- **多轮对话记忆**：上下文连续追问，支持历史对话回溯
- **Web 搜索降级**：知识库无匹配结果时自动联网搜索
- **Agent 工具调用**：自动判断调用知识库搜索、Web 搜索、发邮件等工具
- **SSE 流式响应**：实时流式输出回答，体验流畅

### 3. 邮件中心 (`/mail`)
- **多邮箱绑定**：支持 QQ、163、Outlook 等主流邮箱
- **AI 邮件分类**：自动将邮件分为「需回复」「通知」「垃圾」三类
- **AI 起草邮件**：输入收件人+主题，AI 自动生成专业邮件正文
- **草稿审阅发送**：AI 生成的草稿可人工修改后发送

### 4. 安全体系
- **JWT 身份认证**：所有 API 需携带 Bearer Token
- **Prompt 注入检测**：7 条正则规则拦截恶意注入
- **PII 自动脱敏**：手机号、身份证、邮箱、银行卡自动替换
- **角色权限控制**：管理员/员工两级权限

---

## 适用场景

| 行业 | 典型场景 |
|------|---------|
| **法律/合规** | 上传法规文件，AI 自动回答合规咨询 |
| **制造业** | 上传设备手册，一线工人即时获取操作规范 |
| **IT 服务** | 上传技术文档，新手工程师快速定位问题 |
| **教育培训** | 上传课程资料，学生自助查询学习内容 |
| **行政管理** | 上传公司制度，AI 代替 HR 回答重复性问题 |
| **项目管理** | 上传项目规范，AI 辅助项目合规检查 |

---

## 技术栈

### 后端 (Python 3.13+)

| 类别 | 技术 | 用途 |
|------|------|------|
| **Web 框架** | [FastAPI](https://fastapi.tiangolo.com/) | REST API 服务 |
| **ASGI 服务器** | Uvicorn | 高性能异步服务器 |
| **ORM** | SQLAlchemy 2.0 (异步) | 数据库对象映射 |
| **数据库** | PostgreSQL (主) / SQLite (降级) | 业务数据持久化 |
| **LLM** | DashScope / 阿里云通义千问 | 大模型推理与 Embedding |
| **Agent 框架** | LangGraph + LangChain | Agent 编排、工具调用、对话记忆 |
| **向量检索** | Milvus Lite (本地嵌入式) | 语义向量存储与相似度搜索 |
| **文档解析** | PyMuPDF, python-docx, openpyxl | PDF / Word / Excel 解析 |
| **文本分块** | langchain-text-splitters | 语义文本分块 |
| **异步任务** | Celery + Redis | 文档后台异步处理 |
| **邮件** | aioimaplib + aiosmtplib | IMAP 收信 / SMTP 发信 |

### 前端

| 类别 | 技术 |
|------|------|
| **框架** | React 19 |
| **构建工具** | Vite 8 |
| **语言** | TypeScript 6 |
| **路由** | react-router-dom 7 |

### 基础设施

| 组件 | 用途 |
|------|------|
| **PostgreSQL** | 业务数据主存储 (端口 5432) |
| **Redis** | Celery 消息队列 (端口 6379) |
| **Milvus Lite** | 本地嵌入式向量库 (`./data/milvus.db`) |
| **DashScope API** | 阿里云通义千问大模型 + Embedding |

---

## 快速启动

### 前置条件

1. **PostgreSQL** 运行在 `localhost:5432`（不可用时自动降级为 SQLite）
2. **Redis** 运行在 `localhost:6379`
3. Python 3.13+ 虚拟环境（推荐使用 `.venv`）
4. Node.js 18+（用于前端）

### 环境配置

复制 `.env` 文件并填写配置：

```ini
# LLM 配置（阿里云 DashScope）
DASHSCOPE_API_KEY=sk-xxxxxxxxxxxx
AGENT_MODEL_NAME=qwen-plus
EMBEDDING_MODEL_NAME=text-embedding-v3

# 数据库
POSTGRES_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/enterprise_ai
REDIS_URL=redis://localhost:6379/0

# 邮件（可选）
MAIL__IMAP_HOST=imap.qq.com
MAIL__SMTP_HOST=smtp.qq.com
```

### 一键启动

```powershell
.\start.ps1              # 启动全部服务（Celery + 后端 + 前端）
.\start.ps1 -NoFrontend  # 仅启动后端服务
.\start.ps1 -NoCelery    # 不启动 Celery（无法处理文档上传）
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

### 访问地址

| 地址 | 说明 |
|------|------|
| http://localhost:5173 | 前端页面 |
| http://localhost:8000/docs | API 文档 (Swagger) |
| http://localhost:8000/redoc | API 文档 (ReDoc) |

---

## 架构概览

```
用户上传文档 → Celery 异步解析 → 分块 + 向量化 → 存入 PostgreSQL
                                                         ↓
用户提问 → RAG 引擎检索 → 同步分块到 Milvus → 向量相似度搜索
                                                         ↓
                                上下文注入用户消息 → LangGraph Agent 流式推理 → SSE 返回答案
```

### 核心数据流

```
用户上传文件
  └─ knowledge_routes.py          接收文件，校验格式，SHA256 去重
       └─ knowledge_service.py    创建 Document 记录（状态=PENDING）
            └─ Celery: process_document()
                 ├─ document_parser.py  解析为结构化文本
                 ├─ text_splitter.py    语义分块
                 ├─ llm_client.get_embeddings()  向量化（1024 维）
                 ├─ document_repo.save_chunks()  存入 PostgreSQL
                 └─ 状态更新为 COMPLETED

用户发起问答
  └─ qa_routes.py /ask/stream
       ├─ SecurityGateway      Prompt 注入检测
       ├─ knowledge_service    同步未入库分块到 Milvus
       ├─ rag_engine.retrieve()   向量检索 + 上下文组装
       └─ AgentEngine.astream()   LangGraph Agent 流式推理
            └─ SSE 流式返回（token/sources/done 事件）
```

---

## 项目结构

```
enterprise_ai_agent/
├── start.ps1                  # 一键启动脚本
├── pyproject.toml             # Python 项目配置与依赖
├── .env                       # 环境变量配置
├── README.md                  # 本文件
├── PROJECT_OVERVIEW.md        # 项目详细架构文档
│
├── backend/                   # ========== 后端 ==========
│   ├── main.py                # FastAPI 应用入口
│   ├── uploads/               # 文档上传临时目录
│   │
│   ├── core/                  # 核心基础设施层
│   │   ├── config.py          # 全局配置中心
│   │   ├── database.py        # 数据库连接池（PG/SQLite 降级）
│   │   ├── llm_client.py      # LLM 路由网关（主备降级/重试/流式）
│   │   ├── agent_engine.py    # LangGraph Agent 引擎
│   │   ├── auth.py            # JWT 认证逻辑
│   │   ├── security.py        # bcrypt 密码哈希
│   │   ├── security_gateway.py # Prompt 注入检测 + PII 脱敏
│   │   └── seed.py            # 种子用户初始化
│   │
│   ├── api/                   # API 路由层
│   │   ├── auth_routes.py     # 登录/注册
│   │   ├── knowledge_routes.py # 知识库文档 CRUD + 上传
│   │   ├── qa_routes.py       # 智能问答（SSE 流式）
│   │   ├── mail_routes.py     # 邮件中心
│   │   └── deps.py            # 依赖注入
│   │
│   ├── services/              # 业务服务层
│   │   ├── knowledge_service.py # 文档处理编排
│   │   ├── mail_service.py    # 邮箱账户绑定
│   │   ├── chat_service.py    # 对话会话管理
│   │   └── search_service.py  # 统一搜索入口
│   │
│   ├── modules/               # 功能模块层
│   │   ├── vector_store.py    # Milvus 向量存储
│   │   ├── rag_engine.py      # RAG 检索引擎
│   │   ├── document_parser.py # 多格式文档解析器
│   │   ├── text_splitter.py   # 语义文本分块器
│   │   ├── mail_handler.py    # 邮件收发
│   │   └── agent_tools.py     # LangGraph 工具集
│   │
│   ├── repositories/          # 数据访问层 (DAO)
│   │   ├── base.py            # CRUD 抽象基类
│   │   ├── document_repo.py   # 文档/分块 CRUD
│   │   └── mail_account_repo.py # 邮箱账户 CRUD
│   │
│   ├── models/                # 数据模型
│   │   ├── db_models.py       # SQLAlchemy ORM 模型
│   │   └── schemas.py         # Pydantic 请求/响应模型
│   │
│   └── tasks/                 # Celery 异步任务
│       ├── celery_app.py      # Celery 应用配置
│       └── document_tasks.py  # 文档后台处理任务
│
└── frontend/                  # ========== 前端 ==========
    ├── package.json           # 前端依赖
    ├── vite.config.ts         # Vite 配置
    └── src/
        ├── App.tsx            # 路由定义
        ├── main.tsx           # React 入口
        ├── types/index.ts     # TypeScript 类型定义
        ├── services/api.ts    # API 请求封装
        ├── contexts/          # 认证/主题上下文
        ├── components/        # 通用组件
        └── views/             # 页面视图
            ├── LoginView.tsx
            ├── KnowledgeView.tsx
            ├── QaView.tsx
            ├── MailView.tsx
            ├── SettingsView.tsx
            └── NotFoundView.tsx
```

---

## 配置说明

所有配置集中在 `.env` 文件中，关键配置项：

```ini
# === 基础环境 ===
APP_ENV=development          # development | staging | production
DEBUG=true

# === 数据库 ===
POSTGRES_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/enterprise_ai
REDIS_URL=redis://localhost:6379/0

# === LLM（DashScope 兼容 OpenAI 协议）===
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_API_KEY=sk-xxxxxxxx
AGENT_MODEL_NAME=qwen-plus
EMBEDDING_MODEL_NAME=text-embedding-v3

# === RAG 参数 ===
CHUNK_SIZE=500              # 文本分块大小
CHUNK_OVERLAP=50            # 分块重叠字符数
RAG_TOP_K=5                 # 向量检索 Top-K
RAG_SCORE_THRESHOLD=0.3     # 相似度阈值
```

---

## API 文档

启动后端后访问：
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

### 核心端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/auth/login` | POST | 用户登录 |
| `/api/auth/register` | POST | 用户注册 |
| `/api/knowledge/upload` | POST | 上传文档 |
| `/api/knowledge/list` | GET | 文档列表 |
| `/api/knowledge/delete` | POST | 删除文档 |
| `/api/qa/ask/stream` | GET | 流式智能问答 |
| `/api/mail/list` | GET | 邮件列表 |
| `/api/mail/sync` | POST | 同步邮件 |
| `/api/mail/draft` | POST | AI 起草邮件 |

---

## 安全机制

| 层级 | 机制 |
|------|------|
| **传输层** | JWT Bearer Token 认证 |
| **网络层** | CORS 白名单 |
| **输入层** | Prompt 注入检测（7 条正则规则） |
| **隐私层** | PII 自动脱敏（手机号/身份证/邮箱/银行卡） |
| **存储层** | 用户密码 bcrypt 哈希存储 |
| **访问层** | 管理员/员工角色权限控制 |
| **运维层** | 生产环境异常脱敏，不暴露堆栈 |

---

## 数据库表结构

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| `users` | 系统用户 | id, username, password_hash, role, department |
| `documents` | 知识库文档 | id, filename, file_hash(SHA256), status, user_id |
| `chunks` | 文档分块 | id, document_id(FK), chunk_index, content, embedding, metadata |
| `user_mail_accounts` | 邮箱账户 | id, user_id, provider, email_address, encrypted_password |

---

> **文档版本**: v1.0.0 | **维护者**: Enterprise AI Agent Team
