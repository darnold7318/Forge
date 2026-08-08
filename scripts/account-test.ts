/**
 * End-to-end checks for self-service password change and profile deletion.
 * Run against a throwaway copy of the database:
 *   DATABASE_PATH=/tmp/x.db node dist/index.cjs &
 *   BASE=http://localhost:PORT npx tsx scripts/account-test.ts
 */
const BASE = process.env.BASE ?? "http://localhost:5099";

let pass = 0;
let fail = 0;

function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}\n      got=${JSON.stringify(got)}  want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

async function req(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, json };
}

async function main() {
  const suffix = Date.now();
  const alice = `alice_${suffix}`;
  const bob = `bob_${suffix}`;

  const a = await req("POST", "/api/auth/signup", { name: alice, password: "orig1234" });
  const aliceTok = a.json.token as string;
  const aliceId = a.json.id as number;
  const b = await req("POST", "/api/auth/signup", { name: bob, password: "bob12345" });
  const bobId = b.json.id as number;
  console.log(`\n${alice}=${aliceId}  ${bob}=${bobId}\n`);

  // --- password change ---
  check(
    "wrong current password rejected",
    (await req("PATCH", `/api/users/${aliceId}/password`, { currentPassword: "nope", password: "new12345" }, aliceTok)).status,
    400,
  );
  check(
    "missing current password rejected",
    (await req("PATCH", `/api/users/${aliceId}/password`, { password: "new12345" }, aliceTok)).status,
    400,
  );
  check(
    "too-short new password rejected",
    (await req("PATCH", `/api/users/${aliceId}/password`, { currentPassword: "orig1234", password: "ab" }, aliceTok)).status,
    400,
  );
  check(
    "correct current password accepted",
    (await req("PATCH", `/api/users/${aliceId}/password`, { currentPassword: "orig1234", password: "new12345" }, aliceTok)).status,
    200,
  );
  check("old password no longer works", (await req("POST", "/api/auth/login", { name: alice, password: "orig1234" })).status, 401);
  check("new password works", (await req("POST", "/api/auth/login", { name: alice, password: "new12345" })).status, 200);

  // --- cross-account access ---
  check(
    "cannot change another user's password",
    (await req("PATCH", `/api/users/${bobId}/password`, { currentPassword: "new12345", password: "hacked12" }, aliceTok)).status,
    403,
  );
  check(
    "cannot delete another user",
    (await req("DELETE", `/api/users/${bobId}`, { password: "new12345" }, aliceTok)).status,
    403,
  );

  // --- self deletion ---
  check(
    "self-delete with wrong password rejected",
    (await req("DELETE", `/api/users/${aliceId}`, { password: "wrong" }, aliceTok)).status,
    400,
  );
  check(
    "self-delete with no password rejected",
    (await req("DELETE", `/api/users/${aliceId}`, {}, aliceTok)).status,
    400,
  );
  check(
    "self-delete with correct password succeeds",
    (await req("DELETE", `/api/users/${aliceId}`, { password: "new12345" }, aliceTok)).status,
    200,
  );
  check("token revoked after self-delete", (await req("GET", "/api/auth/me", undefined, aliceTok)).status, 401);
  check("deleted account cannot log in", (await req("POST", "/api/auth/login", { name: alice, password: "new12345" })).status, 401);

  console.log(`\n${fail === 0 ? "ALL ACCOUNT TESTS PASSED" : `${fail} FAILURE(S)`}  (${pass} passed)`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
