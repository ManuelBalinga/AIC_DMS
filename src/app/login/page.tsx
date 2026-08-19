import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in | AIC Documents" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            AIC Documents
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Internal platform. Sign in to continue.
          </p>
        </div>

        <LoginForm next={next} />

        <p className="mt-6 text-center text-xs text-neutral-500 dark:text-neutral-400">
          Accounts are created by an administrator. There is no public sign-up.
        </p>
      </div>
    </main>
  );
}
