---
name: "integration-test"
description: "在每次新增功能或修改代码后，执行前后端联调测试。检测到代码变更后必须调用此 skill。简单变更模拟登录后测试目标模块，核心功能变更则全面测试。"
---

# 前后端联调测试

## 触发条件

**必须调用此 skill 的场景：**
- 新增了任何功能模块（前端或后端）
- 修改了现有代码（API 路由、数据模型、前端组件、服务层等）
- 用户明确要求测试
- 完成一轮代码修改后，在提交前验证

**不需要调用的场景：**
- 仅修改文档或注释
- 仅修改配置文件（非代码逻辑）
- 纯阅读/搜索代码的请求

## 测试流程

### 第零步：确保服务运行

1. 检查后端是否在 `http://localhost:8000` 运行：
   ```powershell
   Invoke-RestMethod -Uri "http://localhost:8000/api/health" -Method Get
   ```
   如果返回 `{"code": 200, "message": "ok"}` 则后端正常。

2. 如果后端未运行，启动后端：
   ```powershell
   cd d:\Code\PythonCode\enterprise_ai_agent
   .\.venv\Scripts\uvicorn.exe backend.main:app --host 0.0.0.0 --port 8000 --log-level info
   ```
   使用 `blocking: false` 启动，等待 5 秒后检查健康状态。

3. 检查前端是否在 `http://localhost:5173` 运行。如果未运行，启动前端：
   ```powershell
   cd d:\Code\PythonCode\enterprise_ai_agent\frontend
   npm run dev
   ```
   使用 `blocking: false` 启动。

### 第一步：识别变更范围

阅读本次变更涉及的文件，确定测试范围：

| 变更类型 | 测试级别 | 说明 |
|---------|---------|------|
| 新增 API 端点 | 简单 | 测试该端点 + 相关前端调用 |
| 修改数据模型 | 核心 | 影响所有相关 CRUD，需全面测试 |
| 前端组件修改 | 简单 | 检查前端编译 + 相关 API |
| 服务层/业务逻辑 | 核心 | 影响数据流，需端到端测试 |
| 认证/安全相关 | 核心 | 需测试登录 + 权限 + 边界 |
| 数据库 schema 变更 | 核心 | 需测试所有受影响的表操作 |

### 第二步：简单测试（适用于非核心功能变更）

**目标：** 验证变更的功能模块正常工作，不影响其他模块。

**流程：**

1. **模拟登录获取 Token：**
   ```powershell
   $body = @{username="admin";password="admin123"} | ConvertTo-Json
   $loginRes = Invoke-RestMethod -Uri "http://localhost:8000/api/auth/login" -Method Post -Body $body -ContentType "application/json"
   $token = $loginRes.access_token
   Write-Host "Login OK, user: $($loginRes.user.display_name)"
   ```

2. **根据变更模块测试对应 API：**

   - **邮件模块变更：** 测试邮件列表、未读计数、同步、标记已读
     ```powershell
     # 未读邮件数
     Invoke-RestMethod -Uri "http://localhost:8000/api/mail/unread-count?user_id=default_user" -Method Get
     # 邮件列表
     Invoke-RestMethod -Uri "http://localhost:8000/api/mail/inbox?user_id=default_user&limit=5" -Method Get
     ```

   - **知识库变更：** 测试分类列表、文档列表
     ```powershell
     Invoke-RestMethod -Uri "http://localhost:8000/api/knowledge/categories?department_id=default_dept" -Method Get
     Invoke-RestMethod -Uri "http://localhost:8000/api/knowledge/list?department_id=default_dept&page=1&page_size=5" -Method Get
     ```

   - **对话/问答变更：** 测试对话列表
     ```powershell
     Invoke-RestMethod -Uri "http://localhost:8000/api/qa/conversations" -Method Get
     ```

3. **前端编译检查：**
   ```powershell
   cd d:\Code\PythonCode\enterprise_ai_agent\frontend
   npx tsc --noEmit --pretty
   ```
   如果有编译错误，必须先修复。

4. **验证前端页面可访问：**
   ```powershell
   Invoke-WebRequest -Uri "http://localhost:5173" -Method Get -TimeoutSec 5 | Select-Object StatusCode
   ```
   预期返回 `200`。

### 第三步：核心测试（适用于核心功能变更）

**目标：** 全面验证所有相关模块的端到端数据流。

**流程：**

1. **完整认证流程测试：**
   ```powershell
   # 1. 登录
   $body = @{username="admin";password="admin123"} | ConvertTo-Json
   $loginRes = Invoke-RestMethod -Uri "http://localhost:8000/api/auth/login" -Method Post -Body $body -ContentType "application/json"
   $token = $loginRes.access_token
   Write-Host "Login OK"

   # 2. 获取用户信息
   $headers = @{Authorization="Bearer $token"}
   Invoke-RestMethod -Uri "http://localhost:8000/api/auth/me" -Method Get -Headers $headers
   Write-Host "Auth OK"
   ```

2. **邮件模块全链路测试（如果涉及）：**
   ```powershell
   # 未读计数
   $unread = Invoke-RestMethod -Uri "http://localhost:8000/api/mail/unread-count?user_id=default_user" -Method Get
   Write-Host "Unread: $($unread.data.count)"

   # 全部邮件（含 is_read 状态）
   $all = Invoke-RestMethod -Uri "http://localhost:8000/api/mail/inbox?user_id=default_user&limit=5" -Method Get
   Write-Host "Total mails: $($all.total)"

   # 仅未读
   $unreadList = Invoke-RestMethod -Uri "http://localhost:8000/api/mail/inbox?user_id=default_user&is_read=false&limit=5" -Method Get
   Write-Host "Unread count from list: $($unreadList.total)"

   # 仅已读
   $readList = Invoke-RestMethod -Uri "http://localhost:8000/api/mail/inbox?user_id=default_user&is_read=true&limit=5" -Method Get
   Write-Host "Read count from list: $($readList.total)"

   # 验证数据一致性：unread + read = total
   if ($unreadList.total + $readList.total -eq $all.total) {
     Write-Host "PASS: unread + read = total" -ForegroundColor Green
   } else {
     Write-Host "FAIL: data inconsistency" -ForegroundColor Red
   }
   ```

3. **知识库模块全链路测试（如果涉及）：**
   ```powershell
   # 分类列表
   $cats = Invoke-RestMethod -Uri "http://localhost:8000/api/knowledge/categories?department_id=default_dept" -Method Get
   Write-Host "Categories: $($cats.data.Count)"

   # 文档列表
   $docs = Invoke-RestMethod -Uri "http://localhost:8000/api/knowledge/list?department_id=default_dept&page=1&page_size=10" -Method Get
   Write-Host "Documents: $($docs.total)"

   # 待处理计数
   $pending = Invoke-RestMethod -Uri "http://localhost:8000/api/knowledge/pending-count?department_id=default_dept" -Method Get
   Write-Host "Pending: $($pending.data.count)"
   ```

4. **对话模块全链路测试（如果涉及）：**
   ```powershell
   $convs = Invoke-RestMethod -Uri "http://localhost:8000/api/qa/conversations" -Method Get -Headers $headers
   Write-Host "Conversations: $($convs.data.Count)"
   ```

5. **前端编译 + 构建：**
   ```powershell
   cd d:\Code\PythonCode\enterprise_ai_agent\frontend
   npx tsc --noEmit --pretty
   ```
   确认零错误。

6. **数据一致性检查：**
   - 验证 API 返回的数据结构符合前端类型定义
   - 验证关键字段（如 `is_read`, `total`, `code`）存在且类型正确
   - 验证分页逻辑正确

## 测试结果报告

测试完成后，输出结构化的测试报告：

```
=== 前后端联调测试报告 ===
时间: 2026-06-13 16:30:00
测试级别: [简单/核心]
变更范围: [描述本次变更]

后端健康检查: [通过/失败]
前端编译检查: [通过/失败]
登录认证: [通过/失败]

模块测试:
  [模块名]: [通过/失败] - [简述]
  [模块名]: [通过/失败] - [简述]

数据一致性: [通过/失败]
前端页面可访问: [通过/失败]

总结: [全部通过 / N 项失败需修复]
```

## 项目关键信息

| 项目 | 地址 |
|------|------|
| 后端 API | http://localhost:8000 |
| API 文档 | http://localhost:8000/docs |
| 前端 | http://localhost:5173 |
| 健康检查 | http://localhost:8000/api/health |

| 默认账户 | 用户名 | 密码 |
|---------|--------|------|
| 管理员 | admin | admin123 |
| 员工 | employee | emp123 |

| 默认参数 | 值 |
|---------|-----|
| user_id | default_user |
| department_id | default_dept |

## 常见问题排查

- **后端启动失败**：检查 PostgreSQL 和 Redis 是否在运行
- **API 返回 500**：查看后端终端日志，通常是数据库连接或模型导入问题
- **前端编译失败**：检查 TypeScript 类型定义是否与 API 响应一致
- **CORS 错误**：确认后端 CORS 中间件配置正确
- **认证失败**：检查种子用户是否已创建，用户名密码是否正确