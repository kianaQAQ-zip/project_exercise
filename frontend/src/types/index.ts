export interface DocumentItem {
  id: string
  filename: string
  file_size: number
  mime_type: string
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED"
  category?: string | null
  created_at: string
  updated_at: string
  error_msg?: string
  chunk_count: number
}

export interface UploadResponse {
  code: number
  message: string
  data: {
    document_id: string
    filename: string
    status: string
  }
}

export interface ListResponse {
  code: number
  message: string
  data: DocumentItem[]
  total: number
}

export interface DeleteResponse {
  code: number
  message: string
  data: boolean
}

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: string
  citations?: Citation[]
}

export interface Citation {
  index: number
  doc_name: string
  header_path: string
  snippet: string
}

export interface MailItem {
  id: string
  subject: string
  sender: string
  received_at: string
  category: "URGENT" | "INQUIRY" | "NOTIFICATION" | "SPAM" | "UNKNOWN"
  summary: string
  body: string
  confidence: number
  has_attachments: boolean
  draft_reply?: string
  is_read: boolean
}

export interface MailClassification {
  category: "urgent" | "reply_needed" | "normal" | "spam"
  summary: string
  priority_score: number
  action_items: string[]
  sentiment: string
}

export interface ReplyDraft {
  subject: string
  body: string
  tone: string
  action_items_included: string[]
}

export interface SSEMeta {
  citations: Citation[]
  context_found: boolean
}

export interface ToastMessage {
  id: string
  type: "success" | "error" | "warning" | "info"
  message: string
}

export interface UserInfo {
  id: string
  username: string
  display_name: string
  email: string | null
  role: "admin" | "employee"
  department: string | null
}

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  access_token: string
  token_type: string
  user: UserInfo
}

export interface DraftRequest {
  to: string
  subject: string
  context?: string
}

export interface DraftResponse {
  to: string
  subject: string
  body: string
}

export interface SendMailRequest {
  to: string
  subject: string
  body: string
}

export interface ConversationItem {
  id: string
  session_id: string
  title: string
  starred: boolean
  message_count: number
  created_at: string
  updated_at: string
}