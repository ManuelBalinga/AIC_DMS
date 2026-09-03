"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The binding's tab dividers.
 *
 * Where you are is carried three ways — a brass edge, a weight change, and
 * `aria-current` — because the filter pills further down the page already
 * compute an active state, and having the header alone stay silent about the
 * current section was the inconsistency the review picked up.
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
              "relative flex items-center gap-1.5 px-3 py-4 text-sm transition-colors",
              "after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:transition-colors",
              isActive
                ? "font-semibold text-page after:bg-brass"
                : "text-parchment-soft after:bg-transparent hover:text-parchment hover:after:bg-cloth-edge",
            ].join(" ")}
          >
            {item.label}
            {item.badge ? (
              <span className="rounded-[2px] bg-brass px-1.5 py-px text-[11px] font-bold leading-tight text-cloth-deep">
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
