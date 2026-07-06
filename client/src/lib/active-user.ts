// Module-level holder for the active user id so that plain functions
// (apiRequest, getQueryFn in queryClient.ts) can read the current user
// without needing to be React hooks. The UserProvider keeps this in sync
// with its own React state via a useEffect.
let activeUserId: number | null = null;

export function setActiveUserIdForRequests(id: number | null) {
  activeUserId = id;
}

export function getActiveUserIdForRequests(): number | null {
  return activeUserId;
}
