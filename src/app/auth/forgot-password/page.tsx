import Link from "next/link";

import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = { title: "Password recovery | AIC Documents" };

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Password recovery
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            We will email you a link to choose a new one.
          </p>
        </div>

        <ForgotPasswordForm />

        <p className="mt-6 text-center text-sm">
          <Link
            href="/login"
            className="text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
