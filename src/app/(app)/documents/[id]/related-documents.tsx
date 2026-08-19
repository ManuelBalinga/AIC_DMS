import Link from "next/link";

import { Badge, Card } from "@/components/ui";
import type { RelatedDocument } from "@/lib/types/database";

/**
 * Documents covering similar ground.
 *
 * Similarity is shown as a plain percentage rather than hidden, because every
 * row here is a claim the interface is making about two documents belonging
 * together — and a person who can see the strength of that claim can discount
 * a weak one. Anything below the configured floor never reaches this component.
 */
export function RelatedDocuments({ related }: { related: RelatedDocument[] }) {
  if (related.length === 0) return null;

  return (
    <Card className="p-5">
      <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
        Related documents
      </h2>
      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
        Found by comparing document contents, not titles. Only documents shared
        with you appear here.
      </p>

      <ul className="mt-4 space-y-2">
        {related.map((item) => (
          <li key={item.document_id}>
            <Link
              href={`/documents/${item.document_id}`}
              className="flex items-start justify-between gap-4 rounded-lg border border-neutral-200 px-3 py-2 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:border-neutral-700 dark:hover:bg-neutral-900"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {item.title}
                </p>
                {item.tags.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {item.tags.slice(0, 4).map((tag) => (
                      <Badge key={tag} tone="neutral">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>

              <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
                {Math.round(item.similarity * 100)}% similar
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
