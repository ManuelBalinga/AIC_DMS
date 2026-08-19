import { test, describe } from "node:test";
import assert from "node:assert/strict";

// The migration script is plain .mjs on purpose — see db/README.md — so it
// carries no type declarations. Testing it still beats not testing it.
import { arrayLiteral, literal, quote } from "../scripts/db-import.mjs";

/**
 * Migration-script tests.
 *
 * These cover the SQL literal emitter, which is the part of a provider move
 * where a bug does not throw — it writes plausible-looking wrong data into the
 * new database and is discovered months later. Every case below is one that a
 * naive `JSON.stringify` gets wrong.
 */

describe("quote", () => {
  test("doubles single quotes rather than escaping with a backslash", () => {
    // Postgres has no backslash escape in standard_conforming_strings mode;
    // getting this wrong turns O'Brien into a syntax error or an injection.
    assert.equal(quote("O'Brien"), "'O''Brien'");
    assert.equal(quote("it's a 'quoted' word"), "'it''s a ''quoted'' word'");
  });

  test("leaves double quotes alone", () => {
    assert.equal(quote('Q1 "budget" plan'), `'Q1 "budget" plan'`);
  });

  test("survives a statement-terminator attempt", () => {
    const hostile = "'; drop table documents; --";
    const emitted = quote(hostile);

    assert.equal(emitted, "'''; drop table documents; --'");
    // The payload's opening quote is doubled, so it cannot close the literal.
    assert.ok(!/^'[^']*';/.test(emitted));
  });
});

describe("arrayLiteral", () => {
  test("emits Postgres array syntax, not JSON", () => {
    // ["a","b"] is a valid JSON array and an invalid Postgres one.
    assert.equal(arrayLiteral(["i363", "product"]), `'{"i363","product"}'`);
  });

  test("quotes elements so a comma inside a tag does not split it", () => {
    assert.equal(arrayLiteral(["product, docs"]), `'{"product, docs"}'`);
  });

  test("escapes quotes and backslashes inside elements", () => {
    assert.equal(arrayLiteral(['say "hi"']), `'{"say \\"hi\\""}'`);
    assert.equal(arrayLiteral(["back\\slash"]), `'{"back\\\\slash"}'`);
  });

  test("handles an empty array", () => {
    assert.equal(arrayLiteral([]), "'{}'");
  });

  test("handles braces inside an element", () => {
    assert.equal(arrayLiteral(["{not a set}"]), `'{"{not a set}"}'`);
  });
});

describe("literal", () => {
  test("maps null and undefined to SQL NULL, unquoted", () => {
    assert.equal(literal(null), "NULL");
    assert.equal(literal(undefined), "NULL");
  });

  test("emits numbers bare so they are not coerced from text", () => {
    assert.equal(literal(0), "0");
    assert.equal(literal(10485760), "10485760");
    assert.equal(literal(-1.5), "-1.5");
  });

  test("emits booleans as Postgres keywords", () => {
    assert.equal(literal(true), "true");
    assert.equal(literal(false), "false");
  });

  test("passes a pgvector embedding through as its own input format", () => {
    // pgvector reads back as the string "[0.1,-0.2]", which is already what it
    // accepts on insert — so it needs quoting and nothing else.
    assert.equal(literal("[0.01,-0.2,0.3]"), "'[0.01,-0.2,0.3]'");
  });

  test("emits arrays as Postgres arrays", () => {
    assert.equal(literal(["a", "b"]), `'{"a","b"}'`);
  });

  test("serialises a nested object as JSON text", () => {
    assert.equal(literal({ a: 1 }), `'{"a":1}'`);
  });

  test("quotes timestamps for the column to coerce", () => {
    assert.equal(literal("2026-02-01T00:00:00Z"), "'2026-02-01T00:00:00Z'");
  });

  test("does not mistake a numeric string for a number", () => {
    // A document titled "2026" is text; emitting it bare would be a type error
    // on a text column in some cases and a silent coercion in others.
    assert.equal(literal("2026"), "'2026'");
  });

  test("escapes an apostrophe inside ordinary content", () => {
    assert.equal(literal("It's fine."), "'It''s fine.'");
  });
});
