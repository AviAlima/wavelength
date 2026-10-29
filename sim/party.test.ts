import { test } from "node:test";
import assert from "node:assert/strict";
import { scorePartyRound } from "../src/party-logic.js";

test("each guesser earns their points and the giver earns their average", () => {
  const result = scorePartyRound(["a", "b", "c", "d", "e", "f"], "a", 50, { b: 50, c: 58, d: 65, e: 75, f: 90 });
  assert.deepEqual(result.awards, { a: 2, b: 4, c: 3, d: 2, e: 1, f: 0 });
  assert.equal(result.teamPoints, 2);
});

test("team points are independent of party size for identical guess quality", () => {
  assert.equal(scorePartyRound(["a", "b"], "a", 50, { b: 50 }).teamPoints, 4);
  assert.equal(scorePartyRound(["a", "b", "c", "d"], "a", 50, { b: 50, c: 50, d: 50 }).teamPoints, 4);
});

test("fractional giver awards preserve precision and unregistered guesses are ignored", () => {
  const result = scorePartyRound(["a", "b", "c", "d"], "b", 50, { a: 50, c: 65, d: 80, outsider: 50 });
  assert.equal(result.awards.b, 2);
  assert.equal(result.awards.outsider, undefined);
  assert.equal(scorePartyRound(["a", "b", "c"], "a", 50, { b: 50, c: 65 }).awards.a, 3);
  assert.equal(scorePartyRound(["a", "b", "c", "d"], "a", 50, { b: 50, c: 50, d: 80 }).awards.a, 8 / 3);
});

test("incomplete or invalid guesses cannot be scored", () => {
  const cases: Record<string, number>[] = [{ b: 50 }, { b: 50, c: NaN }, { b: 50, c: -1 }, { b: 50, c: 101 }, { b: 50, c: 50.5 }];
  for (const invalid of cases) {
    assert.throws(() => scorePartyRound(["a", "b", "c"], "a", 50, invalid));
  }
});
