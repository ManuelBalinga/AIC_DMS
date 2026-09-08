/**
 * Prepares two disposable accounts for the end-to-end run and prints their
 * credentials as JSON. Two, not one: the boundary worth testing is what the
 * second person cannot see.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const stamp = Date.now();
const password = `E2ePlaywright!${stamp}`;
const accounts = {};

for (const who of ["owner", "outsider"]) {
  const email = `e2e-${who}-${stamp}@example.invalid`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    console.error(`could not create ${who}:`, error.message);
    process.exit(1);
  }
  accounts[who] = { email, id: data.user.id };
}

const out = { password, ...accounts, createdAt: new Date().toISOString() };
writeFileSync("e2e-accounts.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
