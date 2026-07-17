import { scryptSync, randomBytes, timingSafeEqual } from "crypto";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import type { Express } from "express";
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

declare global {
  namespace Express {
    interface User extends UserRecord {}
  }
}

export function configureAuth(app: Express) {
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "forge-dev-session-secret-change-in-production",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        sameSite: "lax",
      },
    }),
  );

  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(
      { usernameField: "name", passwordField: "password" },
      (name, password, done) => {
        const user = db.select().from(usersTable).where(eq(usersTable.name, name)).get();
        if (!user) return done(null, false, { message: "Invalid name or password" });
        if (!user.passwordHash) return done(null, false, { message: "Invalid name or password" });
        if (!verifyPassword(password, user.passwordHash)) {
          return done(null, false, { message: "Invalid name or password" });
        }
        return done(null, user);
      },
    ),
  );

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser((id: number, done) => {
    const user = db.select().from(usersTable).where(eq(usersTable.id, id)).get();
    if (!user) return done(null, false);
    return done(null, user);
  });
}

// Route guard: require an authenticated session. Attaches nothing extra —
// req.user is already populated by passport.session().
export function requireAuth(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ message: "Not logged in" });
  }
  next();
}

export function requireAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ message: "Not logged in" });
  }
  if (!req.user?.isAdmin) {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}
