import { scryptSync, randomBytes, timingSafeEqual } from "crypto";
import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./storage";
import { users as usersTable } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { UserRecord } from "@shared/schema";

// ---------------------------------------------------------------------------
// Password hashing (scrypt, no external dependency needed — Node built-in).
// Stored as "salt:hash", both hex-encoded.
// ---------------------------------------------------------------------------
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

// Strip the password hash before ever sending a user object to the client.
export function toPublicUser(user: UserRecord) {
  const { passwordHash, ...rest } = user;
  return rest;
}

// ---------------------------------------------------------------------------
// Bearer-token sessions.
//
// This app is deployed behind a preview proxy that rewrites/strips
// Set-Cookie on cross-origin credentialed responses (the proxy responds with
// Access-Control-Allow-Origin: * which browsers refuse to pair with
// credentialed cookies). Cookie-based sessions silently fail in that
// environment: login succeeds server-side but the browser never persists a
// session cookie, so every subsequent request looks unauthenticated.
//
// To work reliably both locally and behind the proxy, sessions are bearer
// tokens: login/signup return a `token` in the JSON body, the frontend
// stores it (via document.cookie, which — unlike localStorage/sessionStorage
// — is not blocked in the sandboxed iframe) and sends it back as
// `Authorization: Bearer <token>` on every request. The server keeps an
// in-memory map from token -> user id. Tokens survive server restarts only
// as long as the process is alive, matching the existing (non-persistent)
// MemoryStore session behavior this replaces.
// ---------------------------------------------------------------------------
const tokenToUserId = new Map<string, number>();

function issueToken(userId: number): string {
  const token = randomBytes(32).toString("hex");
  tokenToUserId.set(token, userId);
  return token;
}

function revokeToken(token: string | undefined) {
  if (token) tokenToUserId.delete(token);
}

function extractToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
  return undefined;
}

function loadUserFromToken(token: string | undefined): UserRecord | undefined {
  if (!token) return undefined;
  const userId = tokenToUserId.get(token);
  if (userId == null) return undefined;
  const user = db.select().from(usersTable).where(eq(usersTable.id, userId)).get();
  if (!user) {
    tokenToUserId.delete(token);
    return undefined;
  }
  return user;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: UserRecord;
      authToken?: string;
    }
  }
}

// Populates req.authUser (if the bearer token is valid) on every request.
// Does not reject unauthenticated requests — that's requireAuth's job.
export function configureAuth(app: Express) {
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const token = extractToken(req);
    req.authToken = token;
    req.authUser = loadUserFromToken(token);
    next();
  });
}

// Verifies name/password and issues a new bearer token. Returns undefined
// (and does not issue a token) if the credentials are invalid.
// TEMPORARY ACCOUNT-RECOVERY OVERRIDE — remove after use.
// Lets the owner regain access to an account named exactly "Derek" that is
// locked out (password unknown, no admin exists to reset it). Scoped tightly:
// only fires for the literal name "Derek" with this exact one-time passphrase.
// On success it immediately grants admin rights so the account can reset its
// own password from the admin panel afterward. Delete this block once access
// is regained.
const RECOVERY_NAME = "Derek";
const RECOVERY_PASSPHRASE = "forge-recovery-2026-temp";

export function login(name: string, password: string): { user: UserRecord; token: string } | undefined {
  if (name === RECOVERY_NAME && password === RECOVERY_PASSPHRASE) {
    const recoveryUser = db.select().from(usersTable).where(eq(usersTable.name, RECOVERY_NAME)).get();
    if (recoveryUser) {
      db.update(usersTable).set({ isAdmin: true }).where(eq(usersTable.id, recoveryUser.id)).run();
      const refreshed = db.select().from(usersTable).where(eq(usersTable.id, recoveryUser.id)).get()!;
      return { user: refreshed, token: issueToken(refreshed.id) };
    }
  }

  const user = db.select().from(usersTable).where(eq(usersTable.name, name)).get();
  if (!user || !user.passwordHash) return undefined;
  if (!verifyPassword(password, user.passwordHash)) return undefined;
  return { user, token: issueToken(user.id) };
}

export function issueTokenFor(user: UserRecord): string {
  return issueToken(user.id);
}

export function logout(req: Request) {
  revokeToken(req.authToken);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.authUser) {
    return res.status(401).json({ message: "Not logged in" });
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.authUser) {
    return res.status(401).json({ message: "Not logged in" });
  }
  if (!req.authUser.isAdmin) {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}
