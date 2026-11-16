import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

const facts = [
  "Node 22",
  "no install step and no dependencies",
  "npm test",
  "PORT=5180 npm start",
  "http://127.0.0.1",
  "listens only on that host",
  "Restarting the process clears rooms and tournaments",
  "sit white in one browser and black in another",
  "UCI",
  "1.5 seconds",
  "fen",
  "Two rooms do not share moves",
  "e2e4 e7e5 d1h5 b8c6 f1c4 g8f6 h5f7",
  "checkmate for white",
  "illegal move is refused",
  "move after the game is over is refused",
  "castling, en passant, and promotion",
  "`q`, `r`, `b`, or `n`",
  "click with no suffix on the last rank is refused",
  "Stalemate stays `playing`",
  "no accounts, no database, and no ratings beyond the tournament score",
  "even field of at least two",
  "odd field is refused",
  "order players were added, white then black",
  "only those paired names may sit",
  "Checkmate records `1-0` or `0-1`",
  "record `1-0`, `0-1`, or `1/2-1/2` while the game is unfinished",
  "only after every pairing in the current round has a result",
  "same players in the same add order and does not rotate",
  "`1`, `0`, or `0.5`",
  "POST /api/rooms",
  "POST /api/rooms/:id/join",
  "POST /api/rooms/:id/move",
  "GET /api/rooms/:id",
  "POST /api/tournaments",
  "POST /api/tournaments/:id/players",
  "POST /api/tournaments/:id/start",
  "POST /api/tournaments/:id/results",
  "POST /api/tournaments/:id/next",
  "GET /api/tournaments/:id",
  "join token is what lets that seat move",
  "taken seat is `409`",
  "refused move is `400`",
  "refused result is `400`",
  "refused next round is `400`",
  "404",
  '{ "error": "not found" }',
];

test("the product README states the club facts", () => {
  for (const fact of facts) {
    assert.ok(readme.includes(fact), `missing: ${fact}`);
  }
});
