import { BrowserRouter, Routes, Route } from "react-router-dom"
import { AuthProvider } from "./contexts/AuthContext"
import { ThemeProvider } from "./contexts/ThemeContext"
import ErrorBoundary from "./components/ErrorBoundary"
import Layout from "./components/Layout"
import { ProtectedRoute, AdminRoute, GuestRoute } from "./components/RouteGuard"
import LoginView from "./views/LoginView"
import DashboardView from "./views/DashboardView"
import KnowledgeView from "./views/KnowledgeView"
import QaView from "./views/QaView"
import MailView from "./views/MailView"
import SettingsView from "./views/SettingsView"
import ProfileView from "./views/ProfileView"
import NotFoundView from "./views/NotFoundView"

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
          <Routes>
            <Route element={<GuestRoute />}>
              <Route path="/login" element={<LoginView />} />
            </Route>

            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route path="/" element={<DashboardView />} />
                <Route path="/dashboard" element={<DashboardView />} />
                <Route path="/knowledge" element={<KnowledgeView />} />
                <Route path="/chat" element={<QaView />} />
                <Route path="/mail" element={<MailView />} />
                <Route path="/profile" element={<ProfileView />} />
                <Route element={<AdminRoute />}>
                  <Route path="/settings" element={<SettingsView />} />
                </Route>
                <Route path="*" element={<NotFoundView />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}