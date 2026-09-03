import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in | AIC Documents" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    // Signing in is opening the book: the cover fills the screen, and the form
    // is the first page inside it.
    <main className="flex min-h-screen items-center justify-center bg-cloth px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex items-center gap-3">
          <svg
            viewBox="0 0 24 24"
            className="size-7 shrink-0"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="3.5"
              y="2.5"
              width="17"
              height="19"
              rx="1"
              className="stroke-brass"
              strokeWidth="1.5"
            />
            <path d="M7.5 2.5v19" className="stroke-brass" strokeWidth="1.5" />
            <path
              d="M11 8h6M11 12h6M11 16h3.5"
              className="stroke-parchment-soft"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <div>
            <h1 className="text-lg font-semibold leading-tight tracking-[-0.015em] text-page">
              AIC Documents
            </h1>
            <p className="text-sm text-parchment-soft">
              Internal platform. Sign in to continue.
            </p>
          </div>
        </div>

        <LoginForm next={next} />

        <p className="mt-6 text-xs leading-relaxed text-parchment-soft">
          Accounts are created by an administrator. There is no public sign-up.
        </p>
      </div>
    </main>
  );
}
