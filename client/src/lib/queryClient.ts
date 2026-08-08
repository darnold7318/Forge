import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getAuthToken } from "./auth-token";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * The device's IANA timezone, sent on every request.
 *
 * The server needs this to compute civil dates ("what day is it for this
 * user?") correctly — it runs in UTC, so without this an evening workout
 * would be filed under tomorrow's date. Whether the server actually honours
 * the device zone or overrides it with the user's configured home zone is
 * decided server-side by their timezoneMode preference.
 */
function timezoneHeaders(): Record<string, string> {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz ? { "X-Client-Timezone": tz } : {};
  } catch {
    return {};
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...authHeaders(),
      ...timezoneHeaders(),
    },
    body: data ? JSON.stringify(data) : undefined,
    // No cookies are used for auth (see auth-token.ts) — the Authorization
    // header carries the session. `credentials: "include"` must NOT be set:
    // the deploy proxy responds with `Access-Control-Allow-Origin: *`, and
    // browsers hard-block any credentialed request (fetch credentials mode
    // "include"/"same-origin" sending cookies) against a wildcard CORS
    // origin — this was the actual cause of every "Failed to fetch" error
    // in the deployed preview.
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, {
      // See apiRequest() above — credentials must not be "include".
      headers: { ...authHeaders(), ...timezoneHeaders() },
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
