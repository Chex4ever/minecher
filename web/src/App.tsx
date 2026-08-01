import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import ServerPage from "./pages/ServerPage";
import Launcher from "./pages/Launcher";

function Guard({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="page-loading">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <Guard>
              <Dashboard />
            </Guard>
          }
        />
        <Route
          path="/servers/:id"
          element={
            <Guard>
              <ServerPage />
            </Guard>
          }
        />
        <Route
          path="/launcher"
          element={
            <Guard>
              <Launcher />
            </Guard>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
