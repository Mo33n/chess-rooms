# Tickets

## 1. Rooms, games, and tournaments
Depends: none
Kind: contract
Touches: api/rooms, api/tournaments

The working room, rules, and tournament surface later tickets use. It has to stand on its own: the product test creates two rooms, sits two players, plays Scholar's mate, then runs a four-player tournament through a reported draw, a mate, and a second round.

Rooms live in process memory. Restarting the server clears them. `POST /api/rooms` with `{ "name" }` returns 200 and a body with `id` and `name`. Names do not have to be unique. Ids do. `GET /api/rooms` returns `{ "rooms": [ ... ] }` with `id`, `name`, and `status` for every room. `GET /api/rooms/:id` returns the room document, or 404 when the id is missing.

The room document has `id`, `name`, `moves`, `status`, `winner`, `white`, `black`, and `turn`. A new room has `moves: []`, `status: "playing"`, `winner: null`, both seats null, and `turn: "white"`. `moves` are UCI strings in play order. `turn` is `white` or `black` while the game is playing, and null otherwise. `winner` is `white`, `black`, or null.

`POST /api/rooms/:id/join` with `{ "name", "color" }` and `color` of `white` or `black` returns 200 `{ "token", "room" }`, where `room` is that document. A different name on a taken color returns 409. The same name and color returns a token for that seat, so a player can sit after a refresh and so a paired player can sit in a tournament room. A missing room returns 404.

`POST /api/rooms/:id/move` with `{ "token", "uci" }` plays only when that token owns the side to move and the UCI is legal. Success is 200 and includes the room document. An illegal move, the wrong seat, or a move when the game is not playing returns 400 and does not change the room. A move that leaves the mover's king in check is illegal. Two rooms do not share moves. Scholar's mate `e2e4 e7e5 d1h5 b8c6 f1c4 g8f6 h5f7` ends `status: "checkmate"` and `winner: "white"`, and a later move is 400. Detect that by the rules, not by matching this one line. Castling, en passant, promotion, and stalemate are not required in this ticket.

`POST /api/tournaments` with `{ "name" }` returns 200 and a body with `id`. `GET /api/tournaments` returns `{ "tournaments": [ ... ] }` with `id` and `name`. `GET /api/tournaments/:id` returns the tournament document, or 404 when the id is missing. The document has `id`, `name`, `players`, and `rounds`. Each player is `{ "name", "score" }` with `score` a number, `0` when added. `rounds` is empty until the tournament starts. Each started round has `round` (1-based) and `pairings`. `rounds[0]` is round 1. A pairing has `white`, `black`, `roomId`, and `result`. `result` is null until set, then `1-0`, `0-1`, or `1/2-1/2`.

`POST /api/tournaments/:id/players` with `{ "name" }` before start returns 200. `POST /api/tournaments/:id/start` with `{}` and four players opens two rooms and returns the tournament document. Each player is in at most one pairing. With an even count, everyone is paired. The pairing's white name is white in that room, and black is black: those players can join that color and receive a token. Those rooms show up in the rooms list. Who plays whom beyond that is free. Rematches are allowed later.

`POST /api/tournaments/:id/results` with `{ "round", "white", "black", "result" }` records `1-0`, `0-1`, or `1/2-1/2` when that pairing has no result yet, and returns the tournament document. A win adds 1 to the winner's score, a loss adds 0, and a draw adds 0.5 to each of those two scores. Recording a result sets that room to `status: "agreed"` with `winner` of `white`, `black`, or null for a draw, so a later move there is 400. Checkmate in a pairing's room records the result itself: white mates as `1-0`, black mates as `0-1`, and the winner's score gains 1. Checkmate does not change a pairing that already has a result.

`POST /api/tournaments/:id/next` with `{}` starts another round only when every pairing in the current round has a result. It appends a round, opens a new room per pairing, and returns the tournament document. Round 2 of a four-player event seats all four names again.

Unknown routes stay 404 with `{ "error": "not found" }`. Error responses are JSON. `GET /` stays the HTML page. No accounts, saved history, clock, chat, computer opponent, repetition draws, fifty-move rule, or insufficient material. Cover this with tests `npm test` runs.

## 2. Special moves and the other refusals
Depends: 1
Touches: api/rooms, api/tournaments

Finish the rules and the refusals the product test does not walk. Scholar's mate stays checkmate for white, and a four-player tournament still reaches a second round.

Castling UCI `e1g1`, `e1c1`, `e8g8`, and `e8c8` works when that side may castle: the king and that rook have not moved, the squares between them are empty, and the king is not in check, does not pass through check, and does not land in check. En passant works for a pawn that has just moved two squares, and only as the next move. Promotion UCI includes the piece, `q`, `r`, `b`, or `n`, as in `e7e8q`. Stalemate ends the game with `status: "stalemate"` and `winner: null`. One fixture is white king on b6 and white queen on b5, black king on a8, black to move. A move that is illegal for any of these reasons is 400 and does not change the room.

The room document also has `position` and `check`, including rooms already created. `position` is eight strings of eight characters, rank 8 first, then down to rank 1. White pieces are `KQRBNP`, black pieces are the same letters in lowercase, and an empty square is `.`. The starting position is `rnbqkbnr`, `pppppppp`, eight dots, eight dots, eight dots, eight dots, `PPPPPPPP`, `RNBQKBNR`. `check` is true only when `status` is `playing` and the side to move is in check. Both fields update on a legal move, including castling, en passant, and promotion.

A tournament room accepts join only for the paired name on the paired color. Any other name on that color is 409. The paired name can sit again.

Adding a player whose name is already in that tournament is 400. Adding a player after start is 400. Start with fewer than two players is 400 and opens no rooms. An odd count is 400, opens no rooms, and is not a bye; the later decision owns what an odd count should do.

A second result for a pairing, an unknown pairing, or a result other than `1-0`, `0-1`, or `1/2-1/2` is 400. Next is 400 while any pairing in the current round has no result. Stalemate in a pairing's room records `1/2-1/2` and adds 0.5 to each of those two scores, and does not replace a result that pairing already has. Cover this with tests `npm test` runs.

## 3. Rooms on the page
Depends: 1
Touches: web

A person creates a named room from the page. The rooms area lists it, and the list updates on its own within two seconds, so another browser pointed at the same server shows the same rooms without a reload. Opening a room shows its name and an empty board area. Restarting the server clears the list. `id="rooms"`, `id="board"`, and `id="tournaments"` stay on the page. The page is served from the existing document. Anything else the browser loads needs a route.

## 4. Seats on the page
Depends: 1
After: 3
Touches: web

In a room, one person sits as white and another as black, each with a name, from two browsers. The page shows both names. A third name taking a filled color is refused, and the page says so. After a refresh, the same name and color can sit again and move with the token from that join. The three ids stay.

## 5. A live board
Depends: 2
After: 4
Touches: web

A seated player plays from the board. The other browser shows the same position, and shows the new move within two seconds, by polling. The board draws the room's `position` with white at the bottom, and shows check when `check` is true. It shows checkmate and stalemate, and who won when there is a winner, including games that use castling, en passant, and promotion. An illegal move, or a move after the game is over, is refused and the position does not change. Two rooms in play do not share moves. Scholar's mate ends as checkmate for white. The three ids stay.

## 6. Tournament on the page
Depends: 2
After: 5
Touches: web

A person creates a named tournament, adds at least two distinct names, and starts it. The tournaments area shows the round and its pairings. Each pairing's room appears in the rooms list. Only the paired name can sit in that seat, and the page says so when another name is refused. Starting with fewer than two players is refused, and the page says so. Casual rooms from the earlier slices still work. The three ids stay.

## 7. Results on the page
Depends: 2
After: 6
Touches: web

Checkmate in a pairing's room shows `1-0` or `0-1` on that pairing and adds 1 to the winner's score. Stalemate shows `1/2-1/2`. Someone can report `1-0`, `0-1`, or `1/2-1/2` for a pairing that is not finished, and the page updates both scores. A report after a result exists is refused, and the page says so. The next round is refused until every pairing in the current round has a result, and the page says so. After that, the next round opens new rooms and the page shows both rounds. With an even count, every player is seated once in the new round. The three ids stay.

## 8. Odd number of players
Depends: 2
After: 7
Decision: What happens when a tournament round has an odd number of players?
Touches: api/tournaments, web

Even counts stay as they are: everyone is paired, and a four-player event still reaches a second round. Replace the odd-count refusal with the choice below. Do not give the leftover player a room unless that choice says so. The page states what happened to the odd player.

## Options
- Refuse to start the round. No rooms open, and the page says the number of players is odd.
- Pair everyone else. The player left over has no room and no score change.
- Pair everyone else. The player left over has no room and gains half a point for that round.
