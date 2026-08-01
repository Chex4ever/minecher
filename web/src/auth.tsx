import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { User } from "@minecher/types";
import { api, clearToken, getToken, setToken } from "./api";

export type Session = User;

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  updateUser: (user: Session) => void;
  isAdmin: boolean;
  canOperate: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then(({ user }) => setSession(user))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { token, user } = await api.login(username, password);
    setToken(token);
    setSession(user);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setSession(null);
  }, []);

  const updateUser = useCallback((user: Session) => {
    setSession(user);
  }, []);

  const value = useMemo(
    () => ({
      session,
      loading,
      login,
      logout,
      updateUser,
      isAdmin: session?.role === "admin",
      canOperate: session?.role === "admin" || session?.role === "operator",
    }),
    [session, loading, login, logout, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
