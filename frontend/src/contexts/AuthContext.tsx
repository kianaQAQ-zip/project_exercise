import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import type { UserInfo } from "../types"
import { authAPI } from "../services/api"

interface AuthState {
  user: UserInfo | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | undefined>(undefined)

const TOKEN_KEY = "auth_token"
const USER_KEY = "auth_user"

function loadStoredAuth(): { token: string | null; user: UserInfo | null } {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    const userRaw = localStorage.getItem(USER_KEY)
    const user = userRaw ? JSON.parse(userRaw) : null
    return { token, user }
  } catch {
    return { token: null, user: null }
  }
}

function saveAuth(token: string, user: UserInfo) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const stored = loadStoredAuth()
    if (stored.token && stored.user) {
      setToken(stored.token)
      setUser(stored.user)
      authAPI.getMe(stored.token).then((me) => {
        const updated: UserInfo = {
          id: me.id,
          username: me.username,
          display_name: me.display_name,
          email: me.email,
          role: me.role as "admin" | "employee",
          department: me.department,
        }
        setUser(updated)
        saveAuth(stored.token!, updated)
      }).catch(() => {
        clearAuth()
        setToken(null)
        setUser(null)
      }).finally(() => setIsLoading(false))
    } else {
      setIsLoading(false)
    }
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const res = await authAPI.login(username, password)
    const userInfo: UserInfo = {
      id: res.user.id,
      username: res.user.username,
      display_name: res.user.display_name,
      email: res.user.email,
      role: res.user.role as "admin" | "employee",
      department: res.user.department,
    }
    saveAuth(res.access_token, userInfo)
    setToken(res.access_token)
    setUser(userInfo)
  }, [])

  const logout = useCallback(() => {
    clearAuth()
    setToken(null)
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!token && !!user,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return ctx
}