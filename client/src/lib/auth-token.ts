import { useSyncExternalStore } from "react";

// Bearer-token session storage.
//
// The deploy preview proxy strips Set-Cookie on credentialed cross-origin
// responses, so cookie-based sessions silently fail there (see
// server/auth.ts for the full explanation). Instead, the server returns a
// `token` field on login/signup, and the client is responsible for keeping
// it around and sending it back as `Authorization: Bearer <token>`.
//
// localStorage/sessionStorage/indexedDB are blocked in this sandboxed
// iframe, but plain `document.cookie` is not — so the token is persisted
// there (first-party, written by our own JS, never relying on the server's
// Set-Cookie header) purely so a page reload doesn't log the user out.
const COOKIE_NAME = "forge_token";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function readCookie(name: string): string | null {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    // Some embedding contexts (sandboxed iframes without allow-same-origin,
    // strict cookie-partitioning policies) throw on document.cookie access.
    // Never let that crash the whole app at module-init time — just treat
    // it as "no persisted session" and fall back to in-memory-only tokens
    // for this page load.
    return null;
  }
}

function writeCookie(nameValue: string) {
  try {
    document.cookie = nameValue;
  } catch {
    // See readCookie() above — swallow cookie-write failures too. The token
    // still works for the current page load via inMemoryToken; it just
    // won't survive a reload in that environment.
  }
}

let inMemoryToken: string | null = readCookie(COOKIE_NAME);

// Tiny pub-sub so React components can subscribe to token changes via
// useSyncExternalStore. Plain module state (the pattern this replaces)
// doesn't trigger a re-render when setAuthToken()/clearAuthToken() are
// called from outside the component tree (e.g. from a mutation's onSuccess),
// which silently left the app stuck on the login screen even after a
// successful login issued a valid token.
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeAuthToken(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAuthToken(): string | null {
  return inMemoryToken;
}

export function setAuthToken(token: string) {
  inMemoryToken = token;
  writeCookie(`${COOKIE_NAME}=${encodeURIComponent(token)}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`);
  notify();
}

export function clearAuthToken() {
  inMemoryToken = null;
  writeCookie(`${COOKIE_NAME}=; path=/; max-age=0`);
  notify();
}

// React hook: re-renders the calling component whenever the token changes,
// even when setAuthToken/clearAuthToken are called outside React (e.g. a
// mutation's onSuccess callback).
export function useAuthToken(): string | null {
  return useSyncExternalStore(subscribeAuthToken, getAuthToken);
}
