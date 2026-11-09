## Summary
- `src/server.js` serves `GET /` as HTML and answers every other path with `404` and `{ "error": "not found" }`. `public/index.html` is three empty regions: `id="rooms"`, `id="board"`, `id="tournaments"`.
- There is no chess, no rooms, no seats, and no tournaments. Process memory is empty because nothing is stored. A restart already matches the PRD: there is nothing to keep.
- The gate contract in `test/hidden/product.test.js` already fixes the HTTP that must exist: rooms, join, UCI moves, Scholar's mate, and a four-player tournament through a second round. That file and `factory/checks.sh` are protected; a job cannot change them.
- The page behaviour in the PRD (two browsers, one board, the other person's move within a couple of seconds) is not in the hidden test. The test only checks that the three ids are present.
- No dependencies, Node 22+, `node:http`, bind `127.0.0.1`, port from `PORT` or `5180`. `factory/checks.sh` runs syntax check plus `test/starter.test.js` only.

## Findings
What exists:

- `package.json` names the app `chess-rooms`, `"type": "module"`, `npm start` → `node src/server.js`, `npm test` → `node --test test/starter.test.js`. `test/starter.test.js` only checks that package name and that `scripts.start` is a string.
- `src/server.js` reads `public/index.html` and returns `content-type: text/html; charset=utf-8` for `GET /`. Anything else, including every `/api/...` path, is a JSON 404. The server listens on `127.0.0.1`.
- `public/index.html` has the three required ids and no script, board, or controls. `AGENTS.md` says those ids must stay.
- `AGENTS.md` names the intended layout: rules in `src/chess.js`, state in `src/store.js`, routes beside `src/server.js`. Those modules are not in the tree. `src/` contains only `server.js`.
- Protected paths (`factory/config.json`): `factory/checks.sh`, `factory/accept.sh`, `factory/config.json`, `factory/omp.yml`, `factory/agents/*`, `factory/bin/*`, `test/hidden/*`. `factory/accept.sh` runs `node --test test/hidden/product.test.js` from the main checkout's copy, inside the job worktree. Development tests that the gate will execute have to be reached from `test/starter.test.js`, because `checks.sh` does not run the rest of `test/`.

What the hidden test already requires (do not invent a second contract):

- `POST /api/rooms` with `{ "name" }` returns 200 and a body with `id`. Two rooms are independent: after moves in the first, `GET /api/rooms/:id` on the second returns `moves: []`.
- `POST /api/rooms/:id/join` with `{ "name", "color" }` returns a body with `token`. `AGENTS.md` also requires the body to be `{ token, room }`. Colors used: `white` and `black`. A second person taking a filled seat returns 409 (`Cal` refused on white after `Ada` sat).
- `POST /api/rooms/:id/move` with `{ "token", "uci" }` returns 200 for each ply of `e2e4 e7e5 d1h5 b8c6 f1c4 g8f6 h5f7`, alternating the white token and the black token. Then `GET /api/rooms/:id` returns `status: "checkmate"` and `winner: "white"`. A later move returns 400.
- `POST /api/tournaments` with `{ "name" }` returns a body with `id`. `POST /api/tournaments/:id/players` with `{ "name" }` returns 200. Four names, then `POST /api/tournaments/:id/start` with `{}`, returns `rounds[0].pairings.length === 2`. Each pairing has `white`, `black`, and `roomId`.
- `POST /api/tournaments/:id/results` with `{ "round": 1, "white", "black", "result": "1/2-1/2" }` returns 200 for a pairing that has not been played.
- The paired names can join that pairing's room on the matching color and play Scholar's mate. `GET /api/tournaments/:id` then shows that pairing's `result` as `"1-0"` and that white player's `score` as `1`.
- `POST /api/tournaments/:id/next` with `{}` returns 200, `rounds.length === 2`, and the four names seated across `rounds[1].pairings`. Who plays whom in round 2 is not asserted. `rounds[0]` is round `1` in the results body.

What the PRD adds that the hidden test does not check:

- Legal chess beyond that one mating line: check, checkmate, stalemate, castling, en passant, and promotion. No chess library is present, and none can be added (`AGENTS.md`: no dependencies).
- A seat taken by someone else is refused. The test only covers a different name on a taken color. `AGENTS.md` phrases the 409 as a different name, which leaves the same name able to sit again. A browser refresh drops the token, because there is no account, so same-name rejoin has to work or the seat is stuck.
- Both browsers show the same board and see the other person's move within a couple of seconds. That needs a room document the page can read again, and a poll shorter than that gap. Nothing in the stack requires websockets.
- The tournament room admits only the paired name for that seat. The test joins the correct names; it does not try a stranger.
- A reported result is only accepted when that pairing is not already finished. Checkmate records `1-0` or, by the same rule, `0-1` for black. The test does not cover a second report, a start with fewer than two players, or `next` before every pairing has a result. `AGENTS.md` says start needs two or more players, and next waits until every pairing in the round has a result.
- The page lists rooms and tournaments. The hidden test never lists them. One browser cannot see a room another browser created unless the server has a list. `GET /api/rooms/:id` and `GET /api/tournaments/:id` are the reads the test already uses.

Constraints the PRD does not state:

- JSON errors stay JSON. The starter 404 body is `{ "error": "not found" }`.
- New static files are not served. Only `GET /` is wired. A script or stylesheet in `public/` needs a route, or the page script stays inside `index.html`.
- Draws by repetition, the fifty-move rule, and insufficient material are not in the PRD or the test. Do not add them.
- No clock, chat, login, saved history, or computer opponent (`prd.md`).
- Odd player counts are not specified. The tested tournament has four players, and round 2 seats each of them once.

No `revision-*.md`, no `changes/*.md`, and no `decisions/*.md` are in this program folder. `program.json` has empty `changes` and `decisions`.

## Open questions
- A tournament whose player count is odd: refuse to start that round, or pair everyone else and give the leftover player a bye (no room, and a score or not)? The PRD says at least two players and one room per pairing. It does not say what happens to the player left over. Even counts are settled by the hidden test.
