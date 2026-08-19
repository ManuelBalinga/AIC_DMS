import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_TAGS_PER_DOCUMENT,
  MAX_TAG_LENGTH,
  formatFileSize,
  isAcceptedMimeType,
  parseTags,
  sanitiseFileName,
} from "@/modules/documents/constants";
import { isIndexableMimeType, UNINDEXABLE_MIME_TYPES } from "@/modules/rag/extract";

/**
 * Upload-path tests (master plan §15, "unit testing" and §14's input validation).
 *
 * `sanitiseFileName` is the security-relevant one: it stands between an
 * uploaded name and a storage path.
 */

describe("sanitiseFileName", () => {
  test("keeps an ordinary name intact", () => {
    assert.equal(sanitiseFileName("Q1-report_v2.pdf"), "Q1-report_v2.pdf");
  });

  test("strips path separators so a name cannot climb the storage tree", () => {
    for (const attempt of [
      "../../etc/passwd",
      "..\\..\\windows\\system32",
      "/absolute/path.pdf",
      "nested/dir/file.docx",
    ]) {
      const safe = sanitiseFileName(attempt);
      assert.ok(!safe.includes("/"), `forward slash survived in "${safe}"`);
      assert.ok(!safe.includes("\\"), `backslash survived in "${safe}"`);
    }
  });

  test("replaces characters that have meaning to a filesystem or URL", () => {
    const safe = sanitiseFileName("re:port?<>|*.pdf");

    assert.match(safe, /^[A-Za-z0-9._-]+$/);
  });

  test("collapses runs of underscores rather than leaving a smear", () => {
    assert.ok(!sanitiseFileName("a???????b.pdf").includes("__"));
  });

  test("bounds the length", () => {
    assert.ok(sanitiseFileName(`${"n".repeat(500)}.pdf`).length <= 120);
  });

  test("never returns an empty name", () => {
    // The contract is a non-empty, path-safe segment — not any particular
    // string. Uniqueness comes from the `{userId}/{uuid}/` prefix the upload
    // route puts in front of it, so a name that collapses to "_" is fine.
    for (const input of ["???", "", "///", "...", "   ", "\u0000"]) {
      const safe = sanitiseFileName(input);
      assert.ok(safe.length > 0, `"${input}" produced an empty name`);
      assert.match(safe, /^[A-Za-z0-9._-]+$/);
    }

    assert.equal(sanitiseFileName(""), "document");
  });
});

describe("parseTags", () => {
  test("splits on commas and newlines", () => {
    assert.deepEqual(parseTags("i363, product\nupdate"), [
      "i363",
      "product",
      "update",
    ]);
  });

  test("lower-cases so one tag does not split into two shelves", () => {
    assert.deepEqual(parseTags("Product, product, PRODUCT"), ["product"]);
  });

  test("collapses internal whitespace and trims", () => {
    assert.deepEqual(parseTags("  product   docs  "), ["product docs"]);
  });

  test("drops empty entries", () => {
    assert.deepEqual(parseTags("a,,  ,\n,b"), ["a", "b"]);
  });

  test("returns an empty list for empty input", () => {
    assert.deepEqual(parseTags(""), []);
    assert.deepEqual(parseTags("   ,  \n "), []);
  });

  test("bounds tag length and count", () => {
    const tags = parseTags(
      Array.from({ length: MAX_TAGS_PER_DOCUMENT + 8 }, (_, i) => `tag${i}`).join(","),
    );
    assert.ok(tags.length <= MAX_TAGS_PER_DOCUMENT);

    const [long] = parseTags("x".repeat(MAX_TAG_LENGTH * 3));
    assert.ok(long.length <= MAX_TAG_LENGTH);
  });
});

describe("mime type gates", () => {
  test("accepts the formats the plan names", () => {
    for (const mime of [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
      "text/csv",
    ]) {
      assert.ok(isAcceptedMimeType(mime), `${mime} should be accepted`);
    }
  });

  test("rejects executables and unknown types", () => {
    for (const mime of [
      "application/x-msdownload",
      "application/x-sh",
      "application/zip",
      "",
    ]) {
      assert.equal(isAcceptedMimeType(mime), false, `${mime} should be rejected`);
    }
  });

  test("accepts images for storage but not for indexing", () => {
    // Images are storable; indexing them needs OCR, which is not built.
    assert.ok(isAcceptedMimeType("image/png"));
    assert.equal(isIndexableMimeType("image/png"), false);
    assert.ok(UNINDEXABLE_MIME_TYPES["image/png"]);
  });

  test("every unindexable type carries a reason to show the user", () => {
    for (const [mime, reason] of Object.entries(UNINDEXABLE_MIME_TYPES)) {
      assert.equal(typeof reason, "string");
      assert.ok(reason.length > 0, `${mime} has no explanation`);
    }
  });
});

describe("formatFileSize", () => {
  test("scales units and never shows a negative or NaN", () => {
    assert.equal(formatFileSize(0), "0 B");
    assert.equal(formatFileSize(512), "512 B");
    assert.equal(formatFileSize(2048), "2 KB");
    assert.equal(formatFileSize(5 * 1024 * 1024), "5.0 MB");
  });
});
