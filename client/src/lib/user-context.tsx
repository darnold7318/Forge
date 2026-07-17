import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/schema";
import { apiRequest } from "./queryClient";
import { useAuthToken, clearAuthToken } from "./auth-token";

interface UserContextValue {
  // Kept as activeUserId/activeUser for compatibility with existing pages —
  // now always the logged-in session user, not a client-picked profile.
  activeUserId: number | null;
  activeUser: User | undefined;
  isLoading: boolean;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
}

const UserContext = createContext<UserContextValue | undefined>(undefined);

// NOTE: "active user" is now always the authenticated session user — there is
// no client-side profile switcher anymore. Login/logout happen via
// /api/auth/login and /api/auth/logout, which issue/revoke a bearer token
// (see lib/auth-token.ts and server/auth.ts for why this isn't a cookie).
export function UserProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const token = useAuthToken();
  const hasToken = !!token;
  const { data: activeUser, isLoading: queryLoading, isError } = useQuery<User>({
    queryKey: ["/api/auth/me"],
    retry: false,
    staleTime: 0,
    enabled: hasToken,
  });
  // When there's no token, the query never runs (and would otherwise stay
  // "loading" forever) — treat that as "done loading, logged out" instead.
  const isLoading = hasToken && queryLoading;

  const logout = async () => {
    await apiRequest("POST", "/api/auth/logout");
    clearAuthToken();
    queryClient.setQueryData(["/api/auth/me"], undefined);
    await queryClient.invalidateQueries();
  };

  return (
    <UserContext.Provider
      value={{
        activeUserId: activeUser?.id ?? null,
        activeUser,
        isLoading,
        isAuthenticated: hasToken && !isError && activeUser != null,
        logout,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useActiveUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useActiveUser must be used within UserProvider");
  return ctx;
}
