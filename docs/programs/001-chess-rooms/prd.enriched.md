# Chess rooms

A local web app where several chess games run at once, and a tournament opens one room per pairing.

No accounts and no database. State lives in the server process. Restarting the server clears every room and tournament. A player is a name plus a seat token returned when they sit. That token is what lets that seat move.

Out of scope: login, saved history, clock, chat, computer opponent, draws by repetition, the fifty-move rule, and insufficient material.

## Constraints

- Node 22 or newer. Plain `node:http`, ES modules, no dependencies. Bind `127.0.0.1`. `PORT` or `5180`. `npm start` prints the URL.
- Do not edit `test/hidden/` or the protected factory files. The gate runs the main checkout's `test/hidden/product.test.js`. Behaviour below that the test already asserts is fixed.
- `factory/checks.sh` only syntax-checks `src/server.js` and runs `test/starter.test.js`. Tests the gate should run have to be part of that file's run.
- `GET /` stays HTML and keeps `id="rooms"`, `id="board"`, and `id="tournaments"`.
- Error responses are JSON. An unknown route stays `404` with `{ "error": "not found" }`.
- The page and the API share one origin. The page polls; it does not need a second transport. A poll interval under two seconds is what "within a couple of seconds" means.
- Only `GET /` is served today. Anything else the browser loads needs a route, or it lives in `public/index.html`.

## Shared surfaces

Land these before the slices that share them. Shapes below are the contract the slices build on. The hidden test already depends on the fields it reads.

### Chess rules

A pure game: starting position, a list of UCI moves, and an answer for one more UCI.

- Accept only legal chess. A move that leaves the mover's king in check is illegal.
- Know check, checkmate, and stalemate.
- Castling, en passant, and promotion work in positions that allow them. Promotion UCI includes the piece (`q`, `r`, `b`, `n`), as in `e7e8q`. Castling UCI is `e1g1`, `e1c1`, `e8g8`, `e8c8`.
- Scholar's mate `e2e4 e7e5 d1h5 b8c6 f1c4 g8f6 h5f7` ends as checkmate for white.
- Status is `playing` until the game ends, then `checkmate` or `stalemate`. `winner` is `white`, `black`, or null. Stalemate has no winner.

### Room document

`GET /api/rooms/:id` returns:

- `id`, `name`
- `moves`: UCI strings in play order. A new room has `[]`.
- `status`: `playing`, `checkmate`, `stalemate`, or `agreed`
- `winner`: `white`, `black`, or null
- `white` and `black`: the seated name, or null
- `turn`: `white` or `black` while `playing`, otherwise null

`GET /api/rooms` returns `{ "rooms": [ ... ] }` with `id`, `name`, and `status` for every room, including rooms a tournament opened.

`POST /api/rooms` with `{ "name" }` returns 200 and a body with `id` and `name`. Names do not have to be unique.

`POST /api/rooms/:id/join` with `{ "name", "color" }` and `color` of `white` or `black` returns 200 `{ "token", "room" }` where `room` is the room document. A different name on a taken color returns 409. The same name and color returns a token for that seat again, so a refresh can keep playing. The other color is still open.

`POST /api/rooms/:id/move` with `{ "token", "uci" }` plays only when that token owns the side to move and the UCI is legal. Success is 200 and includes the room document. An illegal move, the wrong seat, or a move when `status` is not `playing` returns 400.

Missing room: 404.

### Tournament document

`GET /api/tournaments/:id` returns:

- `id`, `name`
- `players`: `{ "name", "score" }`. `score` is a number. A win is 1, a loss is 0, a draw is 0.5, added to the earlier score. A new player has score 0.
- `rounds`: one entry per round that has started. `rounds[0]` is round 1. Each round has `round` (1-based) and `pairings`.
- A pairing has `white`, `black`, `roomId`, and `result`. `result` is null until set, then `1-0`, `0-1`, or `1/2-1/2`.

`GET /api/tournaments` returns `{ "tournaments": [ ... ] }` with `id` and `name`.

`POST /api/tournaments` with `{ "name" }` returns 200 and a body with `id`.

`POST /api/tournaments/:id/players` with `{ "name" }` adds that name before the tournament has started and returns 200. A duplicate name in the same tournament is 400. Adding a player after start is 400.

`POST /api/tournaments/:id/start` with `{}` needs at least two players. It opens one room per pairing in round 1 and returns the tournament document. Each player is seated at most once. With an even count, everyone is seated. The pairing's `white` name is the white seat in that room; `black` is the black seat.

`POST /api/tournaments/:id/results` with `{ "round", "white", "black", "result" }` records a result only when that pairing has no result yet. `result` is `1-0`, `0-1`, or `1/2-1/2`. Success is 200 and the tournament document. A second report, an unknown pairing, or a bad result is 400. Recording a result sets the pairing result, updates the two scores, and sets that room to `agreed` with `winner` of `white`, `black`, or null for a draw, so later moves in that room are 400.

Checkmate in a pairing's room records the result itself: white mates as `1-0`, black mates as `0-1`, and the winner's score gains 1. Stalemate records `1/2-1/2` the same way. A room that already has a result does not change it.

`POST /api/tournaments/:id/next` with `{}` starts another round only when every pairing in the current round has a result. It appends a round, opens a new room per pairing, and returns the tournament document. Otherwise 400.

A tournament room is still a room. Join there accepts only the paired name on the paired color. Any other name on that color is 409.

Who plays whom, beyond "each player at most once, and everyone when the count is even", is free. Round 2 of a four-player event must seat all four names again. Rematches are allowed. Odd counts wait on the open question in `research.md`; do not invent a bye.

## Slices

Each slice is useful on its own. Later slices build on the shared surfaces, not on a private copy of them.

### 1. Named rooms on the page

A person creates a named room. The rooms area lists it. Another browser, pointed at the same server, shows the same list. Opening a room shows its empty board area and its name. Restarting the server clears the list.

### 2. Two seats

In a room, one person sits as white and another as black, each with a name, from two browsers. The page shows both names. A third name taking a filled color is refused and the page says so. The same name and color can sit again after a refresh and still move with the token from that join.

### 3. A legal game, live

A seated player plays from the board. The other browser shows the same position and shows the new move within a couple of seconds. Only legal moves are accepted. The board shows check, checkmate, and stalemate, including games that use castling, en passant, and promotion. Scholar's mate ends as checkmate for white. An illegal move, or a move after the game is over, is refused and the position does not change. Two rooms in play do not share moves.

### 4. Start a tournament

A person creates a named tournament, adds at least two distinct names, and starts it. The tournaments area shows the round and its pairings. Each pairing has a room, and that room appears in the rooms list. Only the paired name can sit in that seat. Starting with fewer than two players is refused. The casual rooms from earlier slices still work.

### 5. Results and the next round

Checkmate in a pairing's room records `1-0` or `0-1` on that pairing and adds 1 to the winner's score. Stalemate records `1/2-1/2`. Someone can report `1-0`, `0-1`, or `1/2-1/2` for a pairing that is not finished, and the page updates scores. A report after a result exists is refused. The next round is refused until every pairing in the current round has a result. After that, the next round opens new rooms and seats every player once when the count is even. The page shows both rounds.

## Suggested order

1. Chess rules surface, then the room document and its routes. Slice 1 only needs create, list, and get. Slice 2 adds join. Slice 3 adds move and the board poll.
2. Tournament document and its routes, using the room surface to open pairing rooms. Slice 4, then slice 5.
3. The page follows each slice: rooms list, then seats, then the board, then tournaments, then results. The three ids stay where they are.
