import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useActiveUser } from "@/lib/user-context";
import type { ThemeColorId, ThemeModeId } from "@shared/schema";

type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  themeColor: ThemeColorId;
  toggleTheme: () => void;
  setTheme: (mode: Theme, color: ThemeColorId) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// Fallback used before the active user's data has loaded (matches the
// previous hardcoded default so there's no flash-of-wrong-theme beyond what
// already existed before per-user persistence was added).
const FALLBACK_MODE: Theme = "dark";
const FALLBACK_COLOR: ThemeColorId = "green";

// Forge persists theme mode + accent color per-user in the database (see
// users.themeMode / users.themeColor in shared/schema.ts). No localStorage/
// sessionStorage/cookies — those APIs are blocked in this sandbox. Reads the
// active user via useActiveUser() (ThemeProvider is nested inside
// UserProvider in App.tsx for this reason) and writes changes optimistically
// while persisting them via PATCH /api/users/:id/preferences.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { activeUser, activeUserId } = useActiveUser();

  const [optimisticMode, setOptimisticMode] = useState<Theme | null>(null);
  const [optimisticColor, setOptimisticColor] = useState<ThemeColorId | null>(null);

  // Reset optimistic overrides whenever the active profile changes, so a
  // freshly-switched-to profile shows its own persisted preferences instead
  // of briefly showing the previous profile's optimistic state.
  useEffect(() => {
    setOptimisticMode(null);
    setOptimisticColor(null);
  }, [activeUserId]);

  const theme: Theme = optimisticMode ?? (activeUser?.themeMode as Theme | undefined) ?? FALLBACK_MODE;
  const themeColor: ThemeColorId =
    optimisticColor ?? (activeUser?.themeColor as ThemeColorId | undefined) ?? FALLBACK_COLOR;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.setAttribute("data-theme-color", themeColor);
  }, [theme, themeColor]);

  const setTheme = (mode: Theme, color: ThemeColorId) => {
    // Update immediately so the UI reflects the change without waiting on refetch.
    setOptimisticMode(mode);
    setOptimisticColor(color);

    if (activeUserId == null) return;
    apiRequest("PATCH", `/api/users/${activeUserId}/preferences`, {
      themeMode: mode,
      themeColor: color,
    })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      })
      .catch(() => {
        // Revert optimistic state on failure so the UI doesn't lie about
        // what's persisted.
        setOptimisticMode(null);
        setOptimisticColor(null);
      });
  };

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark", themeColor);

  return (
    <ThemeContext.Provider value={{ theme, themeColor, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
