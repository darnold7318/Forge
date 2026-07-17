import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/schema";
import { apiRequest } from "./queryClient";

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
// /api/auth/login and /api/auth/logout, which set/clear a session cookie.
export function UserProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: activeUser, isLoading, isError } = useQuery<User>({
    queryKey: ["/api/auth/me"],
    retry: false,
    staleTime: 0,
  });

  const logout = async () => {
    await apiRequest("POST", "/api/auth/logout");
    queryClient.setQueryData(["/api/auth/me"], undefined);
    await queryClient.invalidateQueries();
  };

  return (
    <UserContext.Provider
      value={{
        activeUserId: activeUser?.id ?? null,
        activeUser,
        isLoading,
        isAuthenticated: !isError && activeUser != null,
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
