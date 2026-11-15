import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("this package is the chess rooms app", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  assert.equal(pkg.name, "chess-rooms");
  assert.equal(typeof pkg.scripts.start, "string");
});
