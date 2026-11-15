## Summary
- `src/server.js` listens on `127.0.0.1` and `PORT` (default 5180), prints `chess rooms http://127.0.0.1:<port>/`, and serves `public/index.html` for `GET /`. Every other route is `404` `{ "error": "not found" }`.
- The page is a stub with `id="rooms"`, `id="board"`, and `id="tournaments"` plus one submit button. There is no board, no script, and no API.
- There is no chess, no room store, and no tournament store. State is whatever a future process keeps in memory; a restart already drops it because nothing is stored.
- `factory/accept.sh` runs `test/hidden/product.test.js` unchanged. That one test is the HTTP contract: two rooms, seat theft `409`, Scholar's mate, a four-player tournament, a draw, an automatic `1-0`, and a second round. `npm test` does not run it.
- No dependencies and no build. Node 22+, ESM. The client has to live in what this process serves.

## Findings
`package.json` starts `node src/server.js`. `factory/checks.sh` syntax-checks that file and runs `node --test test/*.test.js`. The only match today is `test/starter.test.js`, which checks the package name and that `start` is a string. `test/hidden/` is outside that glob. `factory/config.json` points the page smoke at `node src/server.js` and `/`. The smoke requires a `<button>` or `<input>`; the stub button already qualifies. It does not require a chessboard.

`AGENTS.md` and `test/hidden/product.test.js` agree on the contract the stub does not implement:

- `POST /api/rooms` `{ "name" }` → `200` and a body with `id`. Two creates ("Club", "Lounge") are independent.
- `POST /api/rooms/:id/join` `{ "name", "color" }` → body with `token`. `color` is `white` or `black`. A different name on a taken seat is `409`.
- `POST /api/rooms/:id/move` `{ "token", "uci" }` → `200` for Scholar's mate `e2e4 e7e5 d1h5 b8c6 f1c4 g8f6 h5f7`, played by alternating the white and black tokens. Failure bodies are JSON; the test reads `error`.
- `GET /api/rooms/:id` then has `status` `"checkmate"`, `winner` `"white"`, and the other room has `moves` `[]`. A later move is `400`.
- `POST /api/tournaments` `{ "name" }` → body with `id`. `POST /api/tournaments/:id/players` `{ "name" }` → `200` for Ada, Bea, Cal, Dee.
- `POST .../start` with body `{}` → `rounds[0].pairings.length === 2`. Each pairing has `white`, `black`, and `roomId`.
- `POST .../results` `{ "round": 1, "white", "black", "result": "1/2-1/2" }` → `200`.
- Checkmate in the other pairing's room sets that pairing's `result` to `"1-0"` and that white player's `score` to `1` on `GET /api/tournaments/:id`.
- `POST .../next` with body `{}` → `200`, `rounds.length === 2`, and round 2 seats Ada, Bea, Cal, and Dee once each.
- `GET /` is `text/html` and contains those three ids.

`AGENTS.md` adds details the test does not assert: join returns `{ token, room }`; the same name may sit again; a tournament room admits only the paired name; results are `1-0`, `0-1`, or `1/2-1/2` only while that room is unfinished; next waits until every current pairing has a result; the page polls every 1.5 seconds.

The PRD also requires castling, en passant, promotion, and refusal of a move that leaves your own king in check. None of that is in the hidden test. Legal terminals besides checkmate (stalemate, resignation, insufficient material) are not in the PRD. A recorded result is a second way a game becomes finished.

Fool's mate is the short black win the tournament rule needs for `0-1`: `f2f3 e7e5 g2g4 d8h4` ends with Black's queen on h4 and White's king on e1, with e2, d1, d2, and f1 still occupied by White's own pieces. See Sources.

Strings the hidden test does not fix, and that this enrichment treats as product rules so tickets do not diverge:

- Room `status` is `"playing"` until mate, then `"checkmate"`. An agreed result sets `"finished"`. `winner` is `"white"`, `"black"`, or `null`.
- The room body includes `fen` so the page can paint squares without a second copy of the rules. Start FEN is the standard initial position.
- Scores are numbers: `1` for a win, `0` for a loss, `0.5` for each side of `1/2-1/2`. The hidden test only checks the `1`.
- Results and seat checks key off exact player-name strings, so a tournament rejects a duplicate name.
- An odd roster is not in the PRD's examples or the hidden test. "At least two" allows three; "every player is seated" does not say what a bye is.

`factory/accept.sh` is one scenario. Room play alone still fails that file until the tournament calls exist. The three page ids are already present, so the HTML assertions do not force the usable board.

No `revision-*.md`, no `changes/*.md`, and no `decisions/*.md` in the program folder.

## Open questions
- What should `POST .../start` do when the roster length is odd (3, 5, …)? Acceptance covers even fields of 2 and 4 only. Do not invent a bye until a person decides.

## Sources
- https://en.wikipedia.org/wiki/Fool%27s_mate — fastest black mate is 1. f3 e5 (or e6) 2. g4 Qh4#, and the f-pawn may be f3 or f4.
- https://chess.phd/learn/checkmates/fools-mate/ — UCI-equivalent `f2f3 e7e5 g2g4 d8h4` is mate because White's own pieces still occupy the king's escape squares.
