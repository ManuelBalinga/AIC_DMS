#!/usr/bin/env node
/**
 * Creates the first administrator.
 *
 * The platform has no public sign-up and no way to invite anybody until an
 * administrator exists, so the very first account cannot be made through the
 * application. This script is that one-time exception.
 *
 * It exists rather than a paragraph of manual SQL because the manual version is
 * three steps in two different consoles, gets run at least twice (development
 * and production), and silently half-succeeds if the profile trigger did not
 * fire — which is the kind of thing that is discovered later, from the wrong end.
 *
 *   node scripts/bootstrap-admin.mjs you@aic.example
 *   node scripts/bootstrap-admin.mjs you@aic.example --password 'chosen-password'
 *
 * With no --password, a strong one is generated and printed once. Safe to re-run:
 * an address that already has an account is promoted rather than duplicated.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

/* -------------------------------------------------------------------------- */
/* Environment                                                                */
/* -------------------------------------------------------------------------- */

function loadEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // No .env.local; fall through to the exported environment.
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!url || !serviceKey) {
  fail(
    "Missing Supabase credentials.\n" +
      "Copy .env.example to .env.local and fill in NEXT_PUBLIC_SUPABASE_URL and\n" +
      "SUPABASE_SERVICE_ROLE_KEY from Project Settings -> API.",
  );
}
if (serviceKey.startsWith("placeholder") || url.includes("your-project-ref")) {
  fail(
    ".env.local still holds placeholder values.\n" +
      "Create a Supabase project and fill in the real values first.",
  );
}

/* -------------------------------------------------------------------------- */
/* Arguments                                                                  */
/* -------------------------------------------------------------------------- */

const args = process.argv.slice(2);
const email = args.find((arg) => !arg.startsWith("--"))?.trim().toLowerCase();

const passwordFlag = args.indexOf("--password");
const chosenPassword =
  passwordFlag !== -1 ? args[passwordFlag + 1] : process.env.ADMIN_PASSWORD;

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  fail("Usage: node scripts/bootstrap-admin.mjs <email> [--password <password>]");
}

/**
 * A generated password is base64url from 18 random bytes: 24 characters, well
 * past the 10-character minimum the application enforces, and never a word
 * anybody would reuse elsewhere.
 */
const generated = !chosenPassword;
const password = chosenPassword || randomBytes(18).toString("base64url");

if (chosenPassword && chosenPassword.length < 10) {
  fail("That password is shorter than the 10 characters the app requires.");
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/* -------------------------------------------------------------------------- */
/* Bootstrap                                                                  */
/* -------------------------------------------------------------------------- */

async function findExistingUser(address) {
  // The admin API has no get-by-email, so page until the address turns up.
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);

    const match = data.users.find(
      (user) => user.email?.toLowerCase() === address,
    );
    if (match) return match;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  console.log(`Project:  ${url}`);
  console.log(`Address:  ${email}\n`);

  let userId;
  let created = false;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    // Re-running after a partial failure is normal, so an existing address is a
    // state to reconcile rather than an error to stop on.
    const existing = await findExistingUser(email);
    if (!existing) throw new Error(`Could not create the user: ${error.message}`);

    userId = existing.id;
    console.log("An account already exists for that address. Promoting it.");
  } else {
    userId = data.user.id;
    created = true;
    console.log("Auth user created.");
  }

  // `handle_new_user` should have written the profile. If it did not, the
  // trigger from migration 0001 is missing, and every later assumption in the
  // app is wrong — so this is checked rather than assumed.
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) {
    fail(
      "The auth user exists but no profile row was created.\n" +
        "That means the on_auth_user_created trigger from migration 0001 did not run.\n" +
        "Re-run supabase/migrations/0001_init.sql, then run this script again.",
    );
  }

  const { error: promoteError } = await admin
    .from("profiles")
    .update({ role: "administrator" })
    .eq("id", userId);

  if (promoteError) {
    throw new Error(`Could not set the administrator role: ${promoteError.message}`);
  }

  console.log("Profile row present, role set to administrator.\n");

  if (created && generated) {
    console.log("Generated password (shown once, store it now):\n");
    console.log(`    ${password}\n`);
    console.log("Change it after signing in, from the Account page.");
  } else if (created) {
    console.log("Signing in with the password you supplied.");
  } else {
    console.log("Existing password unchanged.");
  }

  console.log("\nNext: npm run dev, then sign in at http://localhost:3000/login");
  console.log("Then invite the rest of the team from the Team page.");
}

main().catch((error) => {
  fail(`Bootstrap failed: ${error.message}`);
});
