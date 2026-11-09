# Chess rooms

A local web app for more than one chess game at a time, and for a tournament
that opens a room per pairing. State lives in the server process; restarting
clears it. There are no accounts: a seat token, returned when a player sits
down, is what lets that seat move.

The product is being built by the software factory from the PRD in
`docs/programs/`. `src/server.js` serves the page and the rooms and tournaments API.

## Setup

Node 22 or newer. No install step and no dependencies.

```bash
npm test
PORT=5180 npm start
```

`npm start` prints the URL. `npm test` is what `factory/checks.sh` runs. The
gate also runs `factory/accept.sh`, which is `node --test
test/hidden/product.test.js`: the product contract, run from the main
checkout's copy so a branch cannot change it. Read it to see the exact HTTP
behaviour expected. Do not edit `test/hidden/` or anything under `factory/`
that `factory/config.json` protects; a branch that changes those files fails
the gate.

## Layout

- `src/server.js` HTTP server, plain `node:http`, ES modules
- `src/` is where rules (`chess.js`), state (`store.js`) and routes belong
- `public/index.html` the page; it must keep `id="rooms"`, `id="board"`, `id="tournaments"`. The page creates a named room and lists rooms by polling `GET /api/rooms`.
- `test/starter.test.js` development tests; add to this directory
- `test/hidden/product.test.js` the contract the gate runs

## HTTP contract

`POST /api/rooms` `{ "name" }` creates a room.

`POST /api/rooms/:id/join` `{ "name", "color" }` with `color` of `white` or
`black` returns `{ token, room }`. A taken seat rejects a different name with
409. A tournament room only admits the paired name.

`POST /api/rooms/:id/move` `{ "token", "uci" }` plays a move for the seat whose
turn it is. Scholar's mate (`e2e4 e7e5 d1h5 b8c6 f1c4 g8f6 h5f7`) ends
`status: "checkmate"`, `winner: "white"`. An illegal move or a move after the
game is over is 400.

`POST /api/tournaments` `{ "name" }`, then `POST /api/tournaments/:id/players`
`{ "name" }`. `POST .../start` needs two or more players and opens a room for
each pairing. `POST .../results` `{ "round", "white", "black", "result" }`
records `1-0`, `0-1`, or `1/2-1/2` when the room was not already finished. A
checkmate in the pairing's room records the result itself. `POST .../next`
starts another round after every pairing in the current round has a result.

`GET /` is the page.

## Software factory

`python3 factory/bin/board` serves the board at http://127.0.0.1:8000/. Paste
a PRD there; the factory researches, plans tickets with dependencies, builds
every ready ticket in parallel through intake → spec → build → gate → review
→ approve (one PR per ticket), and drafts a release note. Approvals,
decisions and change requests are buttons on the board. Program documents are
committed under `docs/programs/<id>/`. Working state is in `factory/jobs/`
and `factory/programs/` (gitignored); each job builds in `.worktrees/<job-id>`
(gitignored). Auto-merge is off: an approved PR waits for a person to merge it
on the board. Merged jobs leave a note in `factory/memory/` for the next spec.
