import type { ComponentPropsWithoutRef, ReactNode } from "react";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

/* -------------------------------------------------------------------------- */
/* Marks                                                                      */
/*                                                                            */
/* Drawn at one stroke weight, sized to sit on a line of text. In a monochrome */
/* interface a status has exactly two signals — this mark and a word — so the  */
/* shape is doing real work rather than decorating a colour. That constraint   */
/* is why the set stayed when the palette went.                                */
/* -------------------------------------------------------------------------- */

type MarkName =
  | "seal"
  | "received"
  | "indexed"
  | "open"
  | "void"
  | "check"
  | "alert";

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
    // It worked.
    check: <path d="m2.4 6.3 2.4 2.3 4.8-5.2" />,
    // It did not. A bare exclamation rather than a triangle: at 12px a triangle
    // is three strokes competing for the same four pixels and reads as a blob.
    alert: (
      <>
        <path d="M6 2.4v4.2" />
        <path d="M6 9.2v.05" />
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

/** The affordance on a row that opens something. Revealed on hover or focus. */
export function Chevron({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={cx("size-3.5 shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m4.5 2.5 4 3.5-4 3.5" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Buttons                                                                    */
/*                                                                            */
/* Without colour, hierarchy has to come from fill, border and weight. The     */
/* primary is the only filled control on a screen; secondary is bounded;       */
/* ghost is bare. Read together they rank without a hue between them.          */
/* -------------------------------------------------------------------------- */

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  const base =
    // `press` carries the transitions and the give on hold. min-h keeps every
    // control at a comfortable target on a phone, which several were not.
    "press inline-flex items-center justify-center gap-2 rounded-control font-medium tracking-[-0.01em] disabled:pointer-events-none disabled:opacity-45";

  const sizes = {
    md: "min-h-10 px-4 py-2 text-sm",
    sm: "min-h-8 px-3 py-1.5 text-[13px]",
  } as const;

  const variants = {
    primary:
      "bg-accent text-accent-ink shadow-[0_1px_2px_rgba(0,0,0,0.16)] hover:opacity-90",
    secondary:
      "border border-control bg-surface text-ink hover:bg-surface-sunk",
    ghost: "text-ink-soft hover:bg-surface-sunk hover:text-ink",
    // Monochrome leaves weight as the only signal, so danger takes a doubled
    // border in the full ink where secondary takes a hairline in grey — a
    // visible difference at rest, which is when the decision is made. It then
    // inverts to a fill on hover, so the control arms itself under the pointer.
    // The first attempt gave it secondary's border and differed on hover alone,
    // which made "Remove" and "Cancel" the same button until you touched one.
    danger:
      "border-2 border-ink bg-surface font-semibold text-ink hover:bg-accent hover:text-accent-ink",
  } as const;

  return (
    <button
      className={cx(base, sizes[size], variants[variant], className)}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Fields                                                                     */
/*                                                                            */
/* Bounded boxes rather than the underlines this replaced. An underline is     */
/* handsome and it is also the reason the login screen read as though the      */
/* password field were missing: nothing said where to click before you clicked.*/
/* `border-control` clears 3:1 so the boundary is visible on its own.          */
/* -------------------------------------------------------------------------- */

const FIELD =
  "w-full min-h-10 rounded-field border border-control bg-surface px-3 py-2 text-sm text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-ink-faint hover:border-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-50";

export function Input({
  className,
  ...props
}: ComponentPropsWithoutRef<"input">) {
  return <input className={cx(FIELD, className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: ComponentPropsWithoutRef<"textarea">) {
  return (
    <textarea
      className={cx(FIELD, "resize-y leading-relaxed", className)}
      {...props}
    />
  );
}

export function Select({
  className,
  ...props
}: ComponentPropsWithoutRef<"select">) {
  return (
    <select
      className={cx(FIELD, "cursor-pointer pr-8", className)}
      {...props}
    />
  );
}

export function Label({
  className,
  ...props
}: ComponentPropsWithoutRef<"label">) {
  return (
    <label
      className={cx("block text-[13px] font-medium text-ink-soft", className)}
      {...props}
    />
  );
}

/** Guidance under a field. Reaches the field's own description, not just sighted readers. */
export function Hint({ className, ...props }: ComponentPropsWithoutRef<"p">) {
  return (
    <p
      className={cx("text-xs leading-relaxed text-ink-faint", className)}
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
        "rounded-sheet border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.05)]",
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
  // The call sites across the app speak in these tone names and keep doing so.
  // What each means is decided here, once — now as a mark and a weight rather
  // than a hue, which is the whole of the monochrome change at this level.
  const tones = {
    blue: { className: "text-ink font-semibold", mark: "seal" },
    neutral: { className: "text-ink-soft", mark: "received" },
    green: { className: "text-ink-soft", mark: "indexed" },
    amber: { className: "text-ink font-semibold", mark: "open" },
    red: { className: "text-ink font-semibold", mark: "void" },
  } as const satisfies Record<string, { className: string; mark: MarkName }>;

  const { className, mark } = tones[tone];

  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.06em]",
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
  // Monochrome, so the three are told apart by their mark and by weight. An
  // error also carries the heavier surface, because it is the one a reader must
  // not skim past.
  const tones = {
    error: {
      className: "border-ink bg-surface-sunk text-ink font-medium",
      mark: "alert" as MarkName,
    },
    success: {
      className: "border-line bg-surface-sunk text-ink-soft",
      mark: "check" as MarkName,
    },
    warning: {
      className: "border-line-strong bg-surface-sunk text-ink",
      mark: "open" as MarkName,
    },
  } as const;

  const { className, mark } = tones[tone];

  return (
    <p
      className={cx(
        "flex items-start gap-2 rounded-field border px-3 py-2.5 text-sm leading-relaxed",
        className,
      )}
      // An error interrupts; a confirmation waits its turn.
      role={tone === "error" ? "alert" : "status"}
    >
      <span className="mt-1">
        <Mark name={mark} />
      </span>
      <span className="min-w-0">{children}</span>
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
  // Draws no ruling. The previous version painted ruled paper behind an empty
  // list, so "nothing here" and "this failed to load" looked identical.
  return (
    <div className="rounded-sheet border border-dashed border-line-strong px-6 py-16 text-center">
      <p className="text-base font-semibold tracking-[-0.01em] text-ink">
        {title}
      </p>
      <p className="mx-auto mt-2 max-w-[46ch] text-sm leading-relaxed text-ink-soft">
        {description}
      </p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
