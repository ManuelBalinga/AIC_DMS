import type { ComponentPropsWithoutRef, ReactNode } from "react";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

/* -------------------------------------------------------------------------- */

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 dark:focus-visible:outline-neutral-100";

  const variants = {
    primary:
      "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300",
    secondary:
      "border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800",
    ghost:
      "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100",
    danger:
      "border border-red-200 bg-white text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-neutral-900 dark:text-red-400 dark:hover:bg-red-950",
  } as const;

  return <button className={cx(base, variants[variant], className)} {...props} />;
}

/* -------------------------------------------------------------------------- */

export function Input({ className, ...props }: ComponentPropsWithoutRef<"input">) {
  return (
    <input
      className={cx(
        "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400",
        "focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-100",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentPropsWithoutRef<"textarea">) {
  return (
    <textarea
      className={cx(
        "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400",
        "focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-100",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: ComponentPropsWithoutRef<"select">) {
  return (
    <select
      className={cx(
        "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900",
        "focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-100",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentPropsWithoutRef<"label">) {
  return (
    <label
      className={cx(
        "block text-sm font-medium text-neutral-700 dark:text-neutral-300",
        className,
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "green" | "amber" | "blue" | "red";
  children: ReactNode;
}) {
  const tones = {
    neutral:
      "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
    green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    blue: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
    red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  } as const;

  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Alert({
  tone,
  children,
}: {
  tone: "error" | "success" | "warning";
  children: ReactNode;
}) {
  const tones = {
    error:
      "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
    success:
      "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
    warning:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  } as const;

  return (
    <p className={cx("rounded-lg border px-3 py-2 text-sm", tones[tone])} role="status">
      {children}
    </p>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-neutral-300 px-6 py-14 text-center dark:border-neutral-700">
      <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{title}</p>
      <p className="max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
        {description}
      </p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
