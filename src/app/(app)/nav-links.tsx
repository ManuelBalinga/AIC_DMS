"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Section tabs.
 *
 * Where you are is carried three ways — a solid underline in the accent, a
 * weight change, and `aria-current`. Monochrome removes the option of saying it
 * with a colour, which is no loss: an underline and a weight were always the
 * two signals doing the work, and the colour was riding along.
 *
 * The underline is drawn at full width rather than inset, and it is present but
 * transparent on inactive tabs, so hovering moves nothing — the strip does not
 * reflow under the pointer.
 */
export function NavLinks({
  items,
}: {
  items: { href: string; label: string; badge?: number }[];
}) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-0.5" aria-label="Sections">
      {items.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={[
              "relative flex items-center gap-1.5 rounded-t-control px-3 py-4 text-sm transition-colors",
              "after:absolute after:inset-x-1 after:bottom-0 after:h-[2px] after:rounded-full after:transition-colors",
              isActive
                ? "font-semibold text-ink after:bg-accent"
                : "text-ink-soft after:bg-transparent hover:bg-surface-sunk hover:text-ink hover:after:bg-line-strong",
            ].join(" ")}
          >
            {item.label}
            {item.badge ? (
              <span className="min-w-[18px] rounded-full bg-accent px-1.5 py-px text-center text-[11px] font-bold leading-tight text-accent-ink">
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
