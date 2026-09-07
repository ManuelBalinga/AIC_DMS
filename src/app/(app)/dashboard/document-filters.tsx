"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Input } from "@/components/ui";

/**
 * Search box and tag filter for the document list.
 *
 * State lives in the URL rather than in component state so a filtered view can
 * be linked to a colleague, survives a refresh, and keeps the list itself a
 * server component that queries the database directly.
 *
 * Tags are not here: they moved into the rail, where they sit beside the other
 * ways of narrowing the register rather than forming a second row of pills
 * under the first. Two rows of pills asked the reader to work out which row a
 * given word belonged to before they could use either.
 */
export function DocumentFilters({
  activeQuery,
  activeScope,
  activeView,
}: {
  activeQuery?: string;
  activeScope?: string;
  activeView?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function withParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);

    const search = params.toString();
    return search ? `${pathname}?${search}` : pathname;
  }

  const scopes = [
    { key: undefined, label: "All" },
    { key: "mine", label: "Mine" },
    { key: "shared", label: "Shared with me" },
  ] as const;

  return (
    <div className="space-y-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("q");
          router.push(withParam("q", String(value ?? "").trim() || null));
        }}
      >
        <Input
          // Uncontrolled, and keyed on the URL so that navigating to a different
          // filtered view resets the box. A controlled input would need an effect
          // to stay in step with the URL, and effects that call setState during
          // typing are exactly the cascading-render pattern to avoid.
          key={activeQuery ?? ""}
          name="q"
          type="search"
          defaultValue={activeQuery ?? ""}
          placeholder="Search titles, descriptions and tags…"
          aria-label="Search documents"
          className="text-[15px]"
        />
      </form>

      {/* A segmented control rather than the cut-in tabs this replaces. The
          tabs were handsome and they read as decoration: nothing about a notch
          in a page edge says "these three are one choice". A track with the
          selected segment filled says it at a glance, and it is the control
          people already know from every settings screen they have used. */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="inline-flex max-w-full gap-1 overflow-x-auto rounded-control border border-line bg-surface-sunk p-1"
          role="group"
          aria-label="Filter by ownership"
        >
          {scopes.map((scope) => {
            const isActive = (activeScope ?? undefined) === scope.key;
            return (
              <Link
                key={scope.label}
                href={withParam("scope", scope.key ?? null)}
                aria-current={isActive ? "true" : undefined}
                className={
                  isActive
                    ? "flex-1 whitespace-nowrap rounded-[5px] bg-surface px-3.5 py-1.5 text-center text-[13px] font-semibold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)] sm:flex-none"
                    : "flex-1 whitespace-nowrap rounded-[5px] px-3.5 py-1.5 text-center text-[13px] text-ink-soft transition-colors hover:text-ink sm:flex-none"
                }
              >
                {scope.label}
              </Link>
            );
          })}
        </div>

        {/* Cards are the default because recognising a document by its own words
          is the point of this screen. Rows stay one click away, because at
          forty documents a shelf is a lot of scrolling and somebody who knows
          exactly what they are looking for wants the dense view. */}
        <div
          className="ml-auto inline-flex gap-1 rounded-control border border-line bg-surface-sunk p-1"
          role="group"
          aria-label="How to show documents"
        >
          {[
            { key: null, label: "Cards" },
            { key: "list", label: "Rows" },
          ].map((option) => {
            const isActive = (activeView ?? null) === option.key;
            return (
              <Link
                key={option.label}
                href={withParam("view", option.key)}
                aria-current={isActive ? "true" : undefined}
                className={
                  isActive
                    ? "rounded-[5px] bg-surface px-3 py-1.5 text-[13px] font-semibold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                    : "rounded-[5px] px-3 py-1.5 text-[13px] text-ink-soft transition-colors hover:text-ink"
                }
              >
                {option.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
