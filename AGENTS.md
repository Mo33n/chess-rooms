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
- `public/index.html` the page; it must keep `id="rooms"`, `id="board"`, `id="tournaments"`. The page creates a named room and lists rooms by polling `GET /api/rooms`. The open room sits white and black by name, shows both names, and moves with the token from the latest join. The open board draws `position` with white at the bottom and shows check, checkmate, stalemate, and the winner. Another browser sees a move by polling within two seconds. `#tournaments` creates a named tournament, adds player names, starts it, and shows the round and its pairings. Pairing rooms show up in the rooms list. A refused seat and a start with fewer than two players are shown on the page.
- `test/starter.test.js` development tests; add to this directory
- `test/hidden/product.test.js` the contract the gate runs

## HTTP contract

`POST /api/rooms` `{ "name" }` creates a room.

`POST /api/rooms/:id/join` `{ "name", "color" }` with `color` of `white` or
`black` returns `{ token, room }`. A taken seat rejects a different name with
409. A tournament room admits only the paired name on the paired color: any
other name, or that name on the other color, is 409. The paired name may sit
again and receives a new token.

A room document from create, get, join, and move includes `position` and
`check`. `position` is eight strings of length 8, rank 8 first: white pieces
`KQRBNP`, black pieces lowercase, empty `.`. The start is `rnbqkbnr`,
`pppppppp`, four ranks of `........`, `PPPPPPPP`, `RNBQKBNR`. `check` is true
only while `status` is `playing` and the side to move is in check. After
`checkmate`, `stalemate`, or `agreed`, `check` is false.

`POST /api/rooms/:id/move` `{ "token", "uci" }` plays a move for the seat whose
turn it is. Castling (`e1g1`, `e1c1`, `e8g8`, `e8c8`), en passant, and
promotion (`e7e8q` and the same with `r`, `b`, or `n`) are legal when the
position allows them. Scholar's mate (`e2e4 e7e5 d1h5 b8c6 f1c4 g8f6 h5f7`)
ends `status: "checkmate"`, `winner: "white"`. Stalemate ends
`status: "stalemate"`, `winner: null`, `turn: null`. An illegal move, or a
move after the game is over, is 400 and does not change the room.

`POST /api/tournaments` `{ "name" }`, then `POST /api/tournaments/:id/players`
`{ "name" }`. A duplicate name is 400. A player added after start is 400.
`POST .../start` needs two or more players and an even count: fewer than two,
or an odd count, is 400 and opens no rooms (an odd count is not a bye).
`POST .../results` `{ "round", "white", "black", "result" }` records `1-0`,
`0-1`, or `1/2-1/2` when that pairing has no result yet. A second result, an
unknown pairing, or any other result is 400. A checkmate in the pairing's room
records `1-0` or `0-1` itself. A stalemate records `1/2-1/2` and adds 0.5 to
each of those two scores, and does not replace a result already stored.
`POST .../next` is 400 while any pairing in the current round has no result,
and otherwise starts another round.

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
