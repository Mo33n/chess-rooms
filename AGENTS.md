# Chess rooms

A local web app for more than one chess game at a time, and for a tournament that opens a room per pairing. State lives in the server process. Restarting the server clears it. There are no accounts: a seat token, returned by join, is what lets that seat move.

## Setup

Node 22 or newer. No install step and no dependencies.

```bash
npm test
PORT=5180 npm start
```

`npm test` runs `factory/checks.sh`. The product contract is `factory/accept.sh`, which runs `node --test test/hidden/product.test.js`. Do not edit `test/hidden/` or `factory/accept.sh`.

Open the printed URL. Type a name, open a room, sit white in one browser and black in another. The board polls every 1.5 seconds. Host a tournament from the page, enter at least two names, start it, and open each pairing's board.

## HTTP

`POST /api/rooms` `{ "name" }` creates a room. A room has `id`, `name`, `moves` (UCI strings), `status` (`playing`, `checkmate`, or `finished`), `winner` (`white`, `black`, or `null`), `fen`, and seated `white` and `black` (`null` until that color sits). `fen` starts at `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1`.

`POST /api/rooms/:id/join` `{ "name", "color" }` with `color` of `white` or `black` returns `{ token, room }`. A taken seat rejects a different name with 409. A tournament room only admits the paired name.

`POST /api/rooms/:id/move` `{ "token", "uci" }` plays a move for the seat whose turn it is. Scholar's mate (`e2e4 e7e5 d1h5 b8c6 f1c4 g8f6 h5f7`) ends `status: "checkmate"`, `winner: "white"`. An illegal move or a move after the game is over is 400.

`GET /api/rooms/:id` returns the room, including `moves`, `status`, `winner`, `fen`, `white`, and `black`. A missing id is `404` `{ "error": "not found" }`.

`POST /api/tournaments` `{ "name" }`, then `POST /api/tournaments/:id/players` `{ "name" }`. `GET /api/tournaments/:id` returns `players` as `{ "name", "score" }` (a win is 1, a draw is 0.5 each) and `rounds` of pairings `{ "white", "black", "roomId", "result" }`. `POST .../start` needs two or more players and opens a room for each pairing. `POST .../results` `{ "round", "white", "black", "result" }` records `1-0`, `0-1`, or `1/2-1/2` when the room is still `playing`, then sets that room to `finished`. A checkmate in the pairing's room records `1-0` or `0-1` itself. `POST .../next` starts another round after every pairing in the current round has a result.

`GET /` is the page. It contains `id="rooms"`, `id="board"`, and `id="tournaments"`, plus controls to open a room, sit, move, and run a tournament.

## Software factory

`python3 factory/bin/board` serves the board at http://127.0.0.1:8000/. Paste a PRD there. Program documents land under `docs/programs/<id>/`. Job state is in `factory/jobs/` and `factory/programs/` (gitignored). Each job builds in `.worktrees/<job-id>` (gitignored).
