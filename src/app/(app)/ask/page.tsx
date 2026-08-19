import { requireProfile } from "@/modules/auth/session";
import { getDocumentStats } from "@/modules/documents/queries";
import { embeddingsConfigured } from "@/modules/rag/embed";
import { anthropicConfigured } from "@/modules/rag/answer";
import { Alert } from "@/components/ui";
import { AskPanel } from "./ask-panel";

export const metadata = { title: "Ask | AIC Documents" };

export default async function AskPage() {
  const profile = await requireProfile();
  const stats = await getDocumentStats(profile.id);

  const missing: string[] = [];
  if (!embeddingsConfigured()) missing.push("an embedding provider key");
  if (!anthropicConfigured()) missing.push("an ANTHROPIC_API_KEY");

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          Ask the documents
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {stats.indexed === 0
            ? "No documents are indexed yet."
            : `${stats.indexed} document${stats.indexed === 1 ? "" : "s"} indexed` +
              (stats.awaitingIndex > 0
                ? `, ${stats.awaitingIndex} still being processed`
                : "")}
        </p>
      </div>

      {missing.length > 0 ? (
        <Alert tone="error">
          AI answering is not configured on this environment — it is missing{" "}
          {missing.join(" and ")}. Questions will still run a keyword search where
          possible.
        </Alert>
      ) : null}

      <AskPanel />
    </div>
  );
}
