"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Input } from "@/components/ui";

type TagCount = { tag: string; document_count: number };

/**
 * Search box and tag filter for the document list.
 *
 * State lives in the URL rather than in component state so a filtered view can
 * be linked to a colleague, survives a refresh, and keeps the list itself a
 * server component that queries the database directly.
 *
 * The two filters are deliberately different objects: scope is a tab cut into
 * the top edge of the page, tags are marks written in the margin. They were
 * one undifferentiated row of pills before, which made a five-choice decision
 * out of what is really two much smaller ones.
 */
export function DocumentFilters({
  tags,
  activeTag,
  activeQuery,
  activeScope,
}: {
  tags: TagCount[];
  activeTag?: string;
  activeQuery?: string;
  activeScope?: string;
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
      <div
        className="inline-flex w-full max-w-full gap-1 overflow-x-auto rounded-control border border-line bg-surface-sunk p-1 sm:w-auto"
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

      {tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-faint">
            Tags
          </span>
          {tags.map((tag) => {
            const isActive = activeTag === tag.tag;
            return (
              <Link
                key={tag.tag}
                href={withParam("tag", isActive ? null : tag.tag)}
                aria-current={isActive ? "true" : undefined}
                className={
                  isActive
                    ? "inline-flex items-center rounded-full bg-accent px-3 py-1 text-[13px] font-medium text-accent-ink"
                    : "inline-flex items-center rounded-full border border-line px-3 py-1 text-[13px] text-ink-soft transition-colors hover:border-control hover:text-ink"
                }
              >
                {tag.tag}
                <span className="ml-1.5 text-[11px] tabular-nums opacity-60">
                  {tag.document_count}
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
