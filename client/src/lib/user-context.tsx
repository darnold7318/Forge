import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/schema";
import { setActiveUserIdForRequests } from "./active-user";

interface UserContextValue {
  activeUserId: number | null;
  activeUser: User | undefined;
  users: User[];
  isLoading: boolean;
  setActiveUserId: (id: number) => void;
}

const UserContext = createContext<UserContextValue | undefined>(undefined);

// NOTE: Active profile selection lives only in React state (no localStorage/
// sessionStorage/cookies — those APIs are blocked in this sandbox). This means
// the active profile resets to the first user on a full page reload.
export function UserProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const [activeUserId, setActiveUserIdState] = useState<number | null>(null);

  // Default to the first user once the list loads (only if nothing selected yet).
  useEffect(() => {
    if (activeUserId == null && users.length > 0) {
      setActiveUserIdState(users[0].id);
    }
  }, [users, activeUserId]);

  // Keep the module-level holder (read by apiRequest/getQueryFn) in sync.
  useEffect(() => {
    setActiveUserIdForRequests(activeUserId);
  }, [activeUserId]);

  const setActiveUserId = (id: number) => {
    setActiveUserIdState(id);
    setActiveUserIdForRequests(id);
    // Invalidate all user-scoped queries so switching profiles refetches
    // fresh data instead of showing stale cross-user cache.
    queryClient.invalidateQueries();
  };

  const activeUser = useMemo(
    () => users.find((u) => u.id === activeUserId),
    [users, activeUserId],
  );

  return (
    <UserContext.Provider value={{ activeUserId, activeUser, users, isLoading, setActiveUserId }}>
      {children}
    </UserContext.Provider>
  );
}

export function useActiveUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useActiveUser must be used within a UserProvider");
  return ctx;
}
