# Tickets

## 1. Rooms, chess, and tournaments
Depends: none
Risk: high
Surfaces: security
Touches: api/club

One process keeps every room and tournament in memory. A restart has none of them: a previous id is `404` `{ "error": "not found" }`. Unknown routes stay that same `404`. Errors are JSON `{ "error": "<sentence a person can read>" }`. Seat theft is `409`. An illegal move, a move when the game is over, a move when it is not that seat's turn, and a result or next-round call the rules refuse are `400`. Creates, joins, moves, player adds, start, results, and next are `200`. No packages. The existing page keeps `id="rooms"`, `id="board"`, and `id="tournaments"`. The listen line, the default port, and `npm test` stay as they are. Do not edit the hidden product test or the acceptance script. That script passes only when this ticket is done: it plays two rooms and a four-player tournament in one process.

`POST /api/rooms` `{ "name" }` creates an independent game. The response and `GET /api/rooms/:id` include `id`, `name`, `moves` (UCI strings), `status` (`"playing"`, `"checkmate"`, or `"finished"`), `winner` (`"white"`, `"black"`, or `null`), `fen`, and the seated names (`null` until someone sits). `fen` starts at the standard initial position and is the position after every accepted move.

`POST /api/rooms/:id/join` `{ "name", "color" }` with `color` `white` or `black` returns `{ "token", "room" }`. The token is an unguessable secret for that seat. The same name joining the same color again gets a working token. A different name for a taken color is `409`, and the occupant's token still moves. Only the side to move can move. `POST /api/rooms/:id/move` `{ "token", "uci" }` appends that UCI and returns the room. A move that is not legal, including one that leaves your own king in check, is `400` and does not change `moves` or `fen`. White moves first. Kingside and queenside castling, en passant, and promotion with a `q`, `r`, `b`, or `n` suffix are legal. A pawn move to the last rank without that suffix is `400`. After `"checkmate"` or `"finished"`, further moves are `400`.

Create "Club" and "Lounge". Ada sits white and Bea sits black in Club. Cal joining Club as white is `409`. Ada joining again receives a token that can move. `e2e4 e7e5 d1h5 b8c6 f1c4 g8f6 h5f7` ends `status` `"checkmate"`, `winner` `"white"`, with that `moves` list. A further `a7a6` is `400`. Lounge `moves` is `[]`. A Lounge token, or the other seat's token, is `400` and does not change Club. From the start, `e2e4 f7f6 d1h5` is legal and Black's `a7a6` is `400`. `e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 e1g1` is `200` and includes `e1g1`. `e2e4 a7a6 e4e5 d7d5 e5d6` is `200` (en passant). `a2a4 b7b5 a4b5 a7a6 b5b6 a6a5 b6b7 a5a4 b7a8q` is `200`; the same line ending `b7a8` is `400`. `f2f3 e7e5 g2g4 d8h4` ends `"checkmate"`, `winner` `"black"`.

`POST /api/tournaments` `{ "name" }`, then `POST /api/tournaments/:id/players` `{ "name" }`. Names are exact and unique; a duplicate is `400`. `GET /api/tournaments/:id` returns `players` as `{ "name", "score" }` (numbers, starting at `0`) and `rounds`. `POST .../start` with one player is `400`. With two players it opens one pairing. With Ada, Bea, Cal, and Dee it opens two pairings: four distinct seated names, two different `roomId`s, `moves` `[]`. Each pairing is `{ "white", "black", "roomId", "result" }` with `result` `null` until set. Those rooms accept only the paired name for that color; anyone else is `409`. An odd roster is out of scope: do not add a bye.

`POST .../results` `{ "round", "white", "black", "result" }` records `1-0`, `0-1`, or `1/2-1/2` only while that pairing's room is `"playing"`, then sets the room to `"finished"` and `winner` from the result (`null` for a draw). Round numbers are 1-based. A second result for that game is `400`, and a move there is `400`. Checkmate in the pairing's room records `1-0` or `0-1` by itself. Scores: winner `+1`, loser `+0`, draw `+0.5` each, summed across rounds. `POST .../next` is `400` until every pairing in the current round has a result; then it adds a round that seats every player once in new rooms.

Record `1/2-1/2` on one Sunday pairing: that room is `"finished"`, `winner` `null`, another result is `400`. Scholar's mate in the other pairing sets `result` `"1-0"` and that white player's `score` to `1`; the draw players are `0.5` each. `next` before both have results is `400`. After both do, `next` returns two rounds, and the second seats Ada, Bea, Cal, and Dee once each. Fool's mate in a pairing room sets `result` `"0-1"` and that black player's `score` to `1`.

## 2. Play a room on the board
Depends: 1
Risk: medium
Surfaces: ui, security
Touches: web/page

`GET /` stays `text/html` and still contains `id="rooms"`, `id="board"`, and `id="tournaments"`. The document still has a button or text field. A person types a name, opens a named room, and sits white in one browser and black in another. Clicks on the board send UCI for the seat whose token this browser holds. The board paints `fen` from the server and does not implement its own rules. The other browser shows the move within one 1.5 second poll without a reload. Scholar's mate shows checkmate for white. An illegal move and a stolen seat show the server's `error` text. Two rooms on the page do not share moves. After the server process restarts, the page shows no prior rooms. Leave the tournament column empty aside from its id. `npm test` and the acceptance script still pass.

## 3. Host a tournament on the page
Depends: 2
Risk: medium
Surfaces: ui, security
Touches: web/page

A person hosts a tournament from the tournament column, adds at least two names, and starts it. Each pairing opens on the board from the previous ticket: the paired names sit, and that room's `fen` polls every 1.5 seconds. A checkmate on that board shows `1-0` or `0-1` without a separate result action. The person can record `1/2-1/2` on an unfinished game and sees that game become finished. The next round can be started only after every pairing in the current round has a result, then those new rooms open the same way. Names and the server's `error` text are shown as text. Two club rooms still do not share moves. Restarting the server leaves no prior tournament. The three ids stay, and `npm test` and the acceptance script still pass.
