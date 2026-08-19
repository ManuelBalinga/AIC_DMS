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
    <div className="space-y-3">
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
        />
      </form>

      <div className="flex flex-wrap items-center gap-1.5">
        {scopes.map((scope) => {
          const isActive = (activeScope ?? undefined) === scope.key;
          return (
            <Link
              key={scope.label}
              href={withParam("scope", scope.key ?? null)}
              className={
                isActive
                  ? "rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-900"
              }
            >
              {scope.label}
            </Link>
          );
        })}

        {tags.length > 0 ? (
          <span className="mx-1 h-4 w-px bg-neutral-200 dark:bg-neutral-800" />
        ) : null}

        {tags.map((tag) => {
          const isActive = activeTag === tag.tag;
          return (
            <Link
              key={tag.tag}
              href={withParam("tag", isActive ? null : tag.tag)}
              className={
                isActive
                  ? "rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white"
                  : "rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-900"
              }
            >
              {tag.tag}
              <span className="ml-1 opacity-60">{tag.document_count}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
