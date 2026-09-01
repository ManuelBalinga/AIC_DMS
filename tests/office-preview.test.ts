import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { __testing, hasOfficePreview } from "@/modules/documents/office-preview";

const { sanitiseHtml } = __testing;

/**
 * The Office preview sanitiser.
 *
 * This is the one part of the preview with a security consequence rather than
 * a cosmetic one. The HTML being sanitised is derived from a file any colleague
 * can upload, and it is rendered with dangerouslySetInnerHTML — so anything
 * that survives this function runs in the reader's session, with the reader's
 * cookies, on a page listing documents they are allowed to see.
 *
 * mammoth is not the adversary here and does not emit scripts. The document is
 * the adversary: a hyperlink in a .docx carries through to an anchor, and
 * `javascript:` in that hyperlink is the reachable attack.
 */

describe("which formats are rendered here", () => {
  test("the OOXML three, and not the legacy binaries", () => {
    assert.equal(
      hasOfficePreview("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      true,
    );
    assert.equal(
      hasOfficePreview("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
      true,
    );
    assert.equal(
      hasOfficePreview("application/vnd.openxmlformats-officedocument.presentationml.presentation"),
      true,
    );

    // No parser in the project reads these; indexing refuses them for the same
    // reason. Claiming a preview we cannot produce would be worse than the gap.
    assert.equal(hasOfficePreview("application/msword"), false);
    assert.equal(hasOfficePreview("application/vnd.ms-excel"), false);
    assert.equal(hasOfficePreview("application/vnd.ms-powerpoint"), false);
    assert.equal(hasOfficePreview("application/pdf"), false);
  });
});

describe("sanitising converter output", () => {
  test("keeps the structure that makes a document readable", () => {
    const html = sanitiseHtml(
      "<h1>Fee schedule</h1><p>The <strong>i363</strong> fee <em>rises</em>.</p>" +
        "<ul><li>One</li><li>Two</li></ul>",
    );
    assert.match(html, /<h1>Fee schedule<\/h1>/);
    assert.match(html, /<strong>i363<\/strong>/);
    assert.match(html, /<em>rises<\/em>/);
    assert.match(html, /<li>One<\/li>/);
  });

  test("keeps tables, including spans", () => {
    const html = sanitiseHtml('<table><tr><td colspan="2" rowspan="3">Cell</td></tr></table>');
    assert.match(html, /<table>/);
    assert.match(html, /colspan="2"/);
    assert.match(html, /rowspan="3"/);
  });

  test("removes a script element and its contents", () => {
    const html = sanitiseHtml("<p>before</p><script>alert(1)</script><p>after</p>");
    assert.doesNotMatch(html, /script/i);
    assert.doesNotMatch(html, /alert/);
    assert.match(html, /before/);
    assert.match(html, /after/);
  });

  test("removes iframes, objects, embeds and forms", () => {
    for (const tag of ["iframe", "object", "embed", "form"]) {
      const html = sanitiseHtml(`<p>kept</p><${tag} src="x">inner</${tag}>`);
      assert.doesNotMatch(html, new RegExp(tag, "i"), `${tag} survived`);
      assert.match(html, /kept/);
    }
  });

  test("drops a javascript: link rather than rewriting it", () => {
    const html = sanitiseHtml('<a href="javascript:alert(document.cookie)">click</a>');
    assert.doesNotMatch(html, /javascript:/i);
    assert.doesNotMatch(html, /href=/);
    // The text survives; only the link does. A link that cannot be made safe
    // is not silently turned into a working one.
    assert.match(html, /click/);
  });

  test("drops data: and vbscript: links too", () => {
    for (const scheme of ["data:text/html;base64,PHNjcmlwdD4=", "vbscript:msgbox"]) {
      const html = sanitiseHtml(`<a href="${scheme}">x</a>`);
      assert.doesNotMatch(html, /href=/, `${scheme} survived`);
    }
  });

  test("keeps http, https and mailto, and makes them safe to click", () => {
    const html = sanitiseHtml('<a href="https://aic.test/fees">fees</a>');
    assert.match(html, /href="https:\/\/aic\.test\/fees"/);
    assert.match(html, /rel="noopener noreferrer nofollow"/);
    assert.match(html, /target="_blank"/);

    assert.match(sanitiseHtml('<a href="mailto:a@aic.test">mail</a>'), /href="mailto:a@aic\.test"/);
  });

  test("strips every attribute that is not explicitly allowed", () => {
    const html = sanitiseHtml('<p onclick="steal()" style="position:fixed" class="x">text</p>');
    assert.equal(html, "<p>text</p>");
  });

  test("removes an img with an onerror handler entirely", () => {
    // img is not on the allowlist, so the classic payload has nowhere to land.
    const html = sanitiseHtml('<p>a</p><img src="x" onerror="alert(1)">');
    assert.doesNotMatch(html, /img/i);
    assert.doesNotMatch(html, /onerror/i);
  });

  test("an unknown tag is unwrapped, not kept", () => {
    const html = sanitiseHtml("<marquee><p>still here</p></marquee>");
    assert.doesNotMatch(html, /marquee/i);
    assert.match(html, /<p>still here<\/p>/);
  });

  test("uppercase and mixed-case tags are handled", () => {
    assert.doesNotMatch(sanitiseHtml("<SCRIPT>alert(1)</SCRIPT>"), /alert/);
    assert.match(sanitiseHtml("<P>text</P>"), /<p>text<\/p>/);
  });
});
