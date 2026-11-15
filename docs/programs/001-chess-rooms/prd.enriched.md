# Chess rooms

Build a production-quality local web chess club. One Node process, no dependencies, no accounts. Two people on one machine play in separate browsers. A tournament opens one room per pairing.

The starter at `src/server.js` only serves `public/index.html`. Rooms, chess, and tournaments are missing. `test/hidden/product.test.js` is the frozen HTTP contract. `factory/accept.sh` runs it and must not be edited. `npm test` does not run it.

## Constraints

- Node 22 or newer. `"type": "module"`. No install step, no packages, no build.
- Bind `127.0.0.1`. `PORT` defaults to 5180. On listen, print `chess rooms http://127.0.0.1:<port>/`.
- All club state lives in that process. A new process has no rooms and no tournaments; old ids are `404` `{ "error": "not found" }`.
- Unknown routes stay `404` with that JSON body.
- API errors are JSON `{ "error": "<sentence a person can read>" }`. Seat theft is `409`. An illegal move, a move when the game is over, a move when it is not that seat's turn, and a result or next-round call that the rules refuse are `400`. Successful creates, joins, moves, player adds, start, results, and next are `200`.
- Do not edit `test/hidden/` or `factory/accept.sh`. `factory/checks.sh` must keep passing.

## Shared surfaces

Land these before any slice that calls them.

**Room.** `POST /api/rooms` `{ "name" }` creates an independent game. Response and `GET /api/rooms/:id` include `id`, `name`, `moves` (UCI strings), `status` (`"playing"`, `"checkmate"`, or `"finished"`), `winner` (`"white"`, `"black"`, or `null`), `fen`, and the seated names (`null` until someone sits).

**Seat.** `POST /api/rooms/:id/join` `{ "name", "color" }` with `color` `white` or `black` returns `{ "token", "room" }`. The token is an unguessable secret for that seat. The same name joining the same color again gets a working token for that seat. A different name for a taken color is `409`, and the occupant's token still moves. Only the side to move can move.

**Position.** `fen` is the standard start, then the position after every accepted move. The page renders `fen`. It does not implement a second rules engine. `POST /api/rooms/:id/move` `{ "token", "uci" }` appends the UCI to `moves` and returns the room.

**Rules.** White first. A move that is not legal, including one that leaves your own king in check, is `400` and does not change `moves` or `fen`. Required legal cases include kingside castling (`e1g1` / `e8g8`), queenside castling, en passant, and promotion with a `q`, `r`, `b`, or `n` suffix. A pawn move to the last rank without that suffix is `400`. After `"checkmate"` or `"finished"`, further moves are `400`.

**Tournament.** `POST /api/tournaments` `{ "name" }` then `POST /api/tournaments/:id/players` `{ "name" }`. Names are exact and unique in that tournament; a duplicate is `400`. `GET /api/tournaments/:id` returns `players` as `{ "name", "score" }` (numbers, starting at `0`) and `rounds`. `POST .../start` with at least two players and an even count opens one fresh room per pairing and returns the tournament. Each pairing is `{ "white", "black", "roomId", "result" }` with `result` `null` until set. Those rooms accept only the paired name for that color; anyone else is `409`. Round numbers in `results` are 1-based. `POST .../results` `{ "round", "white", "black", "result" }` records `1-0`, `0-1`, or `1/2-1/2` only when that pairing's room is still `"playing"`, then sets the room to `"finished"` and `winner` from the result (`null` for a draw). A second result for that game is `400`. Checkmate in the pairing's room records `1-0` or `0-1` by itself and does not wait for `results`. Scores: winner `+1`, loser `+0`, draw `+0.5` each, summed across rounds. `POST .../next` is `400` until every pairing in the current round has a result; then it adds a round that seats every player once in new rooms.

An odd roster is unspecified. Do not add a bye. Acceptance does not cover it.

## Order

1. **Rooms and chess.** The shared room, seat, move, and `fen` behaviour. Two games can be played through the API. `factory/accept.sh` stays red until slice 2.
2. **Tournaments.** Pairings, restricted seats, scores, agreed results, and the next round, using slice 1's rooms. With the existing page ids, `factory/accept.sh` passes after this slice.
3. **Page.** A person can play and host from the browser. The hidden test only checks the three ids; this slice is the usable club.

## Acceptance

### 1. Rooms and chess

- Create "Club" and "Lounge". Sit Ada as white and Bea as black in Club. Cal joining Club as white is `409`. Ada joining Club as white again receives a token that can move. Play `e2e4 e7e5 d1h5 b8c6 f1c4 g8f6 h5f7` with alternating tokens. Club is `status` `"checkmate"`, `winner` `"white"`, and `moves` is that sequence. A further `a7a6` is `400`. Lounge `moves` is `[]`.
- From the start, `e2e4 f7f6 d1h5` is legal, and Black's `a7a6` is `400`. `moves` does not gain `a7a6`.
- `e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 e1g1` is `200`. `moves` includes `e1g1`.
- `e2e4 a7a6 e4e5 d7d5 e5d6` is `200`. `e5d6` is en passant; a capture onto an empty `d6` is legal only because the black pawn just moved `d7d5`.
- `a2a4 b7b5 a4b5 a7a6 b5b6 a6a5 b6b7 a5a4 b7a8q` is `200` and the last move is `b7a8q`. The same line ending `b7a8` is `400`.
- `f2f3 e7e5 g2g4 d8h4` ends `status` `"checkmate"`, `winner` `"black"`.
- A move with the other seat's token, or with a token from Lounge, is `400` and does not change Club.
- Stop the process and start it again. The old room id is `404`.

Out of scope: tournaments, the playable page, stalemate, clocks, accounts.

### 2. Tournaments

- Create "Sunday". Add Ada, Bea, Cal, Dee. A second Ada is `400`. Start returns two pairings, four distinct seated names, and two different `roomId`s whose `moves` are `[]`.
- In one pairing, the paired white and black can join those colors. Any other name is `409`.
- Record `1/2-1/2` for the other pairing at `round` 1. That room becomes `"finished"`, `winner` `null`, and another result for it is `400`. A move there is `400`.
- Scholar's mate in the first pairing sets its `result` to `"1-0"` without calling `results`. That white player's `score` is `1`. The draw players' scores are `0.5` each.
- `next` before both games have results is `400`. After both do, `next` returns two rounds, and the second round's pairings seat Ada, Bea, Cal, and Dee once each in new rooms.
- Fool's mate (`f2f3 e7e5 g2g4 d8h4`) in a pairing room sets `result` `"0-1"` and that black player's `score` to `1`.
- Start with one player is `400`. Start with two players opens one pairing.

Out of scope: the browser, odd rosters, ratings other than this score.

### 3. Page

- `GET /` is `text/html` and contains `id="rooms"`, `id="board"`, and `id="tournaments"`.
- A person can type a name, open a named room, sit white in one browser and black in another, and play by clicking squares. Each click sends UCI. The other browser shows the move within one 1.5 second poll without a reload. Scholar's mate shows checkmate for white.
- An illegal move and a stolen seat show the server's `error` text on the page.
- A person can host a tournament, add at least two names, start it, open each pairing, see a checkmate become `1-0`, record `1/2-1/2` on an unfinished game, and start the next round only after every current game has a result.
- Two rooms on the page do not share moves. Reloading the server process leaves the page with no prior rooms or tournaments.

Out of scope: accounts, persistence, deploy, and changing the hidden test.
