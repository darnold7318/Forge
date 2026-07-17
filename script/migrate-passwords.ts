// One-time migration: set initial password "temp" for existing accounts and
// make Derek an admin. Safe to re-run (idempotent — only touches rows where
// password_hash is still null).
import { scryptSync, randomBytes } from "crypto";
import Database from "better-sqlite3";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const db = new Database("./data.db");

const users = db.prepare("SELECT id, name, password_hash FROM users").all() as {
  id: number;
  name: string;
  password_hash: string | null;
}[];

for (const u of users) {
  if (u.password_hash) {
    console.log(`Skipping ${u.name} (already has a password)`);
    continue;
  }
  const hash = hashPassword("temp");
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, u.id);
  console.log(`Set temp password for ${u.name}`);
}

const derek = db.prepare("SELECT id FROM users WHERE name = ?").get("Derek") as { id: number } | undefined;
if (derek) {
  db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(derek.id);
  console.log("Marked Derek as admin");
} else {
  console.log("No user named 'Derek' found — skipped admin assignment");
}

db.close();
console.log("Done.");
