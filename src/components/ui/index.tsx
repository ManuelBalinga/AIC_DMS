import type { ComponentPropsWithoutRef, ReactNode } from "react";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

/* -------------------------------------------------------------------------- */
/* Marks                                                                      */
/*                                                                            */
/* Drawn at one stroke weight, sized to sit on a line of text. A status here   */
/* is a mark plus a word; colour is the third signal, never the only one, so   */
/* the meaning survives a monochrome screen and a screen reader alike.         */
/* -------------------------------------------------------------------------- */

type MarkName = "seal" | "received" | "indexed" | "open" | "void";

function Mark({ name }: { name: MarkName }) {
  const paths: Record<MarkName, ReactNode> = {
    // A struck seal: this entry is yours.
    seal: (
      <>
        <circle cx="6" cy="6" r="4.25" />
        <path d="M6 3.4v5.2M3.4 6h5.2" />
      </>
    ),
    // Entered from elsewhere: someone granted it to you.
    received: (
      <>
        <path d="M2 6h6.2" />
        <path d="M5.9 3.7 8.4 6l-2.5 2.3" />
      </>
    ),
    // Indexed: readable by Ask.
    indexed: (
      <>
        <circle cx="5.3" cy="5.3" r="3.3" />
        <path d="m7.9 7.9 2.2 2.2" />
      </>
    ),
    // An unresolved margin note.
    open: (
      <>
        <path d="M2.2 3.2h7.6v4.6H6.1L3.7 9.6V7.8H2.2z" />
      </>
    ),
    // Struck through: withdrawn, and still on the record.
    void: (
      <>
        <path d="M2.4 6h7.2" />
        <path d="M3.6 3.2h4.8M3.6 8.8h4.8" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 12 12"
      className="size-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-[2px] px-4 py-2 text-sm font-medium tracking-[-0.01em] transition-[background-color,color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-45";

  const variants = {
    // The stamp. Pressing it commits a record, and it moves like it.
    primary:
      "stamp-commit bg-cloth text-parchment shadow-[0_1px_2px_rgba(36,31,20,0.28)] hover:bg-cloth-deep hover:text-page",
    secondary:
      "border border-rule-faint bg-page-raised text-ink hover:border-ink-faint hover:bg-page",
    ghost: "text-ink-soft hover:bg-page-sunk hover:text-ink",
    danger:
      "stamp-commit border border-rule/40 bg-page-raised text-rule hover:bg-rule hover:text-page",
  } as const;

  return <button className={cx(base, variants[variant], className)} {...props} />;
}

/* -------------------------------------------------------------------------- */
/* Fields are entry lines. A ledger is written on a rule, not inside a box, so */
/* the underline carries the field and thickens where the pen is.              */
/* -------------------------------------------------------------------------- */

const FIELD =
  "w-full rounded-none border-0 border-b border-rule-faint bg-transparent px-0.5 pb-1.5 pt-1 text-sm text-ink transition-colors placeholder:text-ink-faint focus:border-rule focus:outline-none focus:ring-0";

export function Input({ className, ...props }: ComponentPropsWithoutRef<"input">) {
  return <input className={cx(FIELD, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentPropsWithoutRef<"textarea">) {
  return <textarea className={cx(FIELD, "resize-y", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentPropsWithoutRef<"select">) {
  return <select className={cx(FIELD, "pr-6", className)} {...props} />;
}

export function Label({ className, ...props }: ComponentPropsWithoutRef<"label">) {
  return (
    <label
      className={cx(
        "block text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-soft",
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
        "rounded-[2px] border border-rule-faint bg-page shadow-[0_1px_3px_rgba(36,31,20,0.09)]",
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
  // Tone names are the call sites' vocabulary across the app and stay put; what
  // each one means in the ledger is decided here, once.
  const tones = {
    blue: { className: "text-cloth", mark: "seal" },
    neutral: { className: "text-ink-soft", mark: "received" },
    green: { className: "text-cloth-edge", mark: "indexed" },
    amber: { className: "text-mark-open", mark: "open" },
    red: { className: "text-mark-void", mark: "void" },
  } as const satisfies Record<string, { className: string; mark: MarkName }>;

  const { className, mark } = tones[tone];

  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.07em]",
        className,
      )}
    >
      <Mark name={mark} />
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
    error: "border-rule/45 bg-rule/[0.07] text-rule",
    success: "border-cloth-edge/40 bg-cloth-edge/[0.07] text-cloth",
    warning: "border-brass-deep/45 bg-brass/[0.10] text-mark-open",
  } as const;

  return (
    <p
      className={cx("rounded-[2px] border px-3 py-2 text-sm", tones[tone])}
      // An error interrupts; a confirmation waits its turn.
      role={tone === "error" ? "alert" : "status"}
    >
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
  // Draws no container of its own: it sits on the page sheet the app layout
  // already provides, and a bordered box inside that sheet would be a card
  // inside a card.
  return (
    <div className="ledger-ruled border-y border-rule-faint px-6 py-16 text-center">
      <p className="text-base font-semibold tracking-[-0.01em] text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-[46ch] text-sm leading-relaxed text-ink-soft">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
