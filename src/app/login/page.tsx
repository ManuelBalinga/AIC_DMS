import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in | AIC Documents" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    /*
     * The first screen anyone sees, so it sets the expectation for the rest:
     * quiet, centred, nothing to read that is not needed to sign in.
     *
     * It deliberately does not invert to a dark full-bleed panel. That looked
     * striking and it made this the only screen in the product with its own
     * rules, so signing in felt like arriving somewhere else and then being
     * moved again. Same canvas, same sheet, same ink as every page behind it.
     */
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="rise w-full max-w-sm">
        <div className="mb-7 flex items-center gap-3">
          <svg
            viewBox="0 0 24 24"
            className="size-7 shrink-0 text-ink"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="3.5"
              y="2.5"
              width="17"
              height="19"
              rx="2.5"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path d="M7.5 2.5v19" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M11 8h6M11 12h6M11 16h3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              opacity="0.45"
            />
          </svg>
          <div>
            <h1 className="text-lg font-semibold leading-tight tracking-[-0.015em] text-ink">
              AIC Documents
            </h1>
            <p className="text-sm text-ink-soft">
              Internal platform. Sign in to continue.
            </p>
          </div>
        </div>

        <LoginForm next={next} />

        <p className="mt-6 text-xs leading-relaxed text-ink-faint">
          Accounts are created by an administrator. There is no public sign-up.
        </p>
      </div>
    </main>
  );
}
