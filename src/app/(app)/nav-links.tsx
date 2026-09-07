"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string; badge?: number; count?: number };

/**
 * The rail's sections.
 *
 * Where you are is carried three ways — a filled surface, a weight change, and
 * `aria-current`. A rail can afford to say it with a whole panel rather than a
 * two-pixel underline, which is one of the things that makes it calmer than the
 * tab strip it replaces.
 */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5" aria-label="Sections">
      {items.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={[
              "flex items-center justify-between gap-2 rounded-control px-2.5 py-2 text-[13.5px] transition-colors",
              isActive
                ? "bg-surface font-semibold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.07)]"
                : "text-ink-soft hover:bg-surface/70 hover:text-ink",
            ].join(" ")}
          >
            <span className="truncate">{item.label}</span>
            {item.badge ? (
              <span className="min-w-[18px] shrink-0 rounded-full bg-accent px-1.5 py-px text-center text-[11px] font-bold leading-tight text-accent-ink">
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            ) : item.count !== undefined ? (
              <span className="shrink-0 text-xs tabular-nums text-ink-faint">
                {item.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Tags in the rail, shown only on the register.
 *
 * They are global data — every tag any visible document carries — but they only
 * *mean* anything next to the document list, so a rail that showed them while
 * you were reading a message would be listing controls for a screen you are not
 * on. The layout is a server component and cannot read the path, so the
 * decision is made here, where it can.
 */
export function NavTags({
  tags,
  className,
}: {
  tags: { tag: string; document_count: number }[];
  className?: string;
}) {
  const pathname = usePathname();
  if (pathname !== "/dashboard" || tags.length === 0) return null;

  return (
    <div className={className}>
      <p className="px-2.5 pb-1.5 pt-5 text-xs text-ink-faint">Tags</p>
      <nav className="flex flex-col gap-0.5" aria-label="Filter by tag">
        {tags.slice(0, 12).map(({ tag, document_count }) => (
          <Link
            key={tag}
            href={`/dashboard?tag=${encodeURIComponent(tag)}`}
            className="flex items-center justify-between gap-2 rounded-control px-2.5 py-1.5 text-[13px] text-ink-soft transition-colors hover:bg-surface/70 hover:text-ink"
          >
            <span className="truncate">{tag}</span>
            <span className="shrink-0 text-xs tabular-nums text-ink-faint">
              {document_count}
            </span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
