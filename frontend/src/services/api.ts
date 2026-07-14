const BASE_URL = "/api"

function getToken(): string | null {
  try {
    return localStorage.getItem("auth_token")
  } catch {
    return null
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }
  const res = await fetch(`${BASE_URL}${url}`, {
    headers: { ...headers, ...options?.headers } as Record<string, string>,
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(err.message || err.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export const knowledgeAPI = {
  upload: (file: File, departmentId: string, category?: string) => {
    const form = new FormData()
    form.append("file", file)
    form.append("department_id", departmentId)
    if (category) {
      form.append("category", category)
    }
    return fetch(`${BASE_URL}/knowledge/upload`, {
      method: "POST",
      body: form,
    }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    })
  },

  list: (departmentId: string, page = 1, pageSize = 20, category?: string) => {
    let url = `/knowledge/list?department_id=${departmentId}&page=${page}&page_size=${pageSize}`
    if (category) {
      url += `&category=${encodeURIComponent(category)}`
    }
    return request<{ code: number; message: string; data: unknown[]; total: number }>(url)
  },

  delete: (docId: string) =>
    request<{ code: number; message: string; data: boolean }>(
      `/knowledge/${docId}`,
      { method: "DELETE" }
    ),

  categories: (departmentId: string) =>
    request<{ code: number; message: string; data: string[] }>(
      `/knowledge/categories?department_id=${departmentId}`
    ),

  getPendingCount: (departmentId = "default_dept") =>
    request<{ code: number; message: string; data: { count: number } }>(
      `/knowledge/pending-count?department_id=${departmentId}`
    ),

  verify: (docId: string) =>
    request<{
      code: number; message: string; data: {
        doc_id: string; filename: string; status: string
        category: string | null; chunk_count: number
        vector_embedded: number; vector_ok: boolean
        error_msg: string | null; pipeline_healthy: boolean
      }
    }>(`/knowledge/verify/${docId}`),
}

export const qaAPI = {
  ask: (query: string, sessionId: string, topK = 5) =>
    request<{ answer: string; session_id: string }>(
      `/qa/ask`,
      {
        method: "POST",
        body: JSON.stringify({
          query,
          session_id: sessionId,
          top_k: topK,
        }),
      }
    ),

  askStream: (
    query: string,
    sessionId: string,
    onSources: (sources: unknown[]) => void,
    onChunk: (text: string) => void,
    onDone: () => void,
    onError: (err: string) => void
  ) => {
    const controller = new AbortController()
    fetch(`${BASE_URL}/qa/ask/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        session_id: sessionId,
        top_k: 5,
      }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          onError(`HTTP ${res.status}`)
          return
        }
        const reader = res.body?.getReader()
        if (!reader) {
          onError("No response body")
          return
        }
        const decoder = new TextDecoder()
        let buffer = ""
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            try {
              const payload = JSON.parse(line.slice(6))
              switch (payload.type) {
                case "sources":
                  onSources(payload.content || [])
                  break
                case "token":
                  onChunk(payload.content || "")
                  break
                case "done":
                  onDone()
                  return
                case "error":
                  onError(payload.content || "未知错误")
                  return
              }
            } catch {
              /* skip malformed JSON lines */
            }
          }
        }
        onDone()
      })
      .catch((err) => onError(err.message))
    return controller
  },
}

export const mailAPI = {
  fetch: (userId = "default_user", isRead?: boolean, limit = 50) => {
    let url = `/mail/inbox?user_id=${userId}&limit=${limit}`
    if (isRead !== undefined) {
      url += `&is_read=${isRead}`
    }
    return request<{
      code: number
      message: string
      data: import("../types").MailItem[]
      total: number
    }>(url)
  },

  sync: (userId = "default_user", days = 7) =>
    request<{
      code: number; message: string; data: { synced: number; skipped: number; total: number }
    }>(`/mail/sync?user_id=${userId}&days=${days}`, { method: "POST" }),

  markAsRead: (mailId: string) =>
    request<{ code: number; message: string }>(
      `/mail/${mailId}/read`,
      { method: "PATCH" }
    ),

  markAllAsRead: (userId = "default_user") =>
    request<{ code: number; message: string; data: { count: number } }>(
      `/mail/read-all?user_id=${userId}`,
      { method: "PATCH" }
    ),

  getUnreadCount: (userId = "default_user") =>
    request<{ code: number; data: { count: number } }>(
      `/mail/unread-count?user_id=${userId}`
    ),

  analyze: (data: { subject: string; sender: string; body: string }) =>
    request<{ code: number; message: string; data: { analysis: string } }>(
      "/mail/analyze",
      { method: "POST", body: JSON.stringify(data) }
    ),

  draftReply: (data: {
    original_subject: string; original_body: string; original_sender: string
    topic: string; context?: string
  }) =>
    request<{ code: number; message: string; data: { to: string; subject: string; body: string } }>(
      "/mail/draft-reply",
      { method: "POST", body: JSON.stringify(data) }
    ),

  classify: (mailId: string, newCategory: string) =>
    request<{ message: string }>(
      `/mail/classify`,
      {
        method: "POST",
        body: JSON.stringify({ mail_id: mailId, new_category: newCategory }),
      }
    ),

  getAccount: (userId: string) =>
    request<{
      id: string; user_id: string; provider: string; email_address: string
      imap_host: string; imap_port: number; smtp_host: string; smtp_port: number
      is_active: boolean; last_sync_at: string | null
    }>(`/mail/account/${userId}`).catch(() => null),

  bindAccount: (data: {
    user_id: string; provider: string; email_address: string; password: string
    imap_host?: string; imap_port?: number; smtp_host?: string; smtp_port?: number
  }) =>
    request<{ message: string; account_id: string }>("/mail/account", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  unbindAccount: (userId: string) =>
    request<{ message: string }>(`/mail/account/${userId}`, {
      method: "DELETE",
    }),

  draft: (data: { to: string; subject: string; context?: string }) =>
    request<{ code: number; message: string; data: { to: string; subject: string; body: string } }>("/mail/draft", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  send: (data: { to: string; subject: string; body: string }) =>
    request<{ code: number; message: string }>("/mail/send", {
      method: "POST",
      body: JSON.stringify(data),
    }),
}

export const healthAPI = {
  check: () =>
    request<{
      code: number
      message: string
      data: {
        vector_store: boolean
        postgres: boolean
        redis: boolean
        uptime: number
      }
    }>("/health"),
}

export const configAPI = {
  get: () =>
    request<{
      code: number
      message: string
      data: {
        model_name: string
        api_endpoint: string
        temperature: string
        embedding_model: string
      }
    }>("/config"),
}

export const authAPI = {
  login: (username: string, password: string) =>
    request<{
      access_token: string
      token_type: string
      user: {
        id: string
        username: string
        display_name: string
        email: string | null
        role: string
        department: string | null
      }
    }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  getMe: (token: string) =>
    request<{
      id: string
      username: string
      display_name: string
      email: string | null
      role: string
      department: string | null
    }>("/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    }),

  updateProfile: (data: { email?: string; display_name?: string }) =>
    request<{
      id: string
      username: string
      display_name: string
      email: string | null
      role: string
      department: string | null
    }>("/auth/profile", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  adminCheck: (token: string) =>
    request<{ is_admin: boolean; message: string }>("/auth/admin-check", {
      headers: { Authorization: `Bearer ${token}` },
    }),
}

export const conversationAPI = {
  list: () =>
    request<{ code: number; message: string; data: import("../types").ConversationItem[] }>(
      "/qa/conversations"
    ),

  create: (sessionId: string, title = "新对话") =>
    request<{ code: number; message: string; data: import("../types").ConversationItem }>(
      "/qa/conversations",
      {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId, title }),
      }
    ),

  updateTitle: (sessionId: string, title: string) =>
    request<{ code: number; message: string }>(
      `/qa/conversations/${sessionId}/title`,
      {
        method: "PUT",
        body: JSON.stringify({ title }),
      }
    ),

  generateTitle: (sessionId: string, userMessage: string) =>
    request<{ code: number; message: string; data: { title: string } }>(
      "/qa/conversations/title/generate",
      {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId, user_message: userMessage }),
      }
    ),

  toggleStar: (sessionId: string) =>
    request<{ code: number; message: string; data: { starred: boolean } }>(
      `/qa/conversations/${sessionId}/star`,
      { method: "PUT" }
    ),

  delete: (sessionId: string) =>
    request<{ code: number; message: string }>(
      `/qa/conversations/${sessionId}`,
      { method: "DELETE" }
    ),

  getHistory: (sessionId: string, limit = 50) =>
    request<{ role: string; content: string }[]>(
      `/qa/history/${sessionId}?limit=${limit}`
    ),
}