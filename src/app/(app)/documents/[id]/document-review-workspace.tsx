"use client";

import { useState } from "react";

import type { CommentThread } from "@/modules/comments/queries";
import type { SelectedPassage } from "@/modules/documents/preview-selection";

import { CommentPanel } from "./comment-panel";
import { DocumentPreview } from "./document-preview";

export function DocumentReviewWorkspace({
  documentId,
  mimeType,
  title,
  threads,
  canComment,
  canResolveAny,
  currentUserId,
}: {
  documentId: string;
  mimeType: string;
  title: string;
  threads: CommentThread[];
  canComment: boolean;
  canResolveAny: boolean;
  currentUserId: string;
}) {
  const [selectedPassage, setSelectedPassage] =
    useState<SelectedPassage | null>(null);

  return (
    <div className="space-y-6">
      <DocumentPreview
        documentId={documentId}
        mimeType={mimeType}
        title={title}
        onPassageSelected={canComment ? setSelectedPassage : undefined}
      />
      <CommentPanel
        key={
          selectedPassage
            ? `${selectedPassage.pageNumber}:${selectedPassage.quotedText}`
            : "unanchored"
        }
        documentId={documentId}
        threads={threads}
        canComment={canComment}
        canResolveAny={canResolveAny}
        currentUserId={currentUserId}
        selectedPassage={selectedPassage}
      />
    </div>
  );
}
