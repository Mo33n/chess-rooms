# Chess rooms

A small club server for more than one chess game at a time, plus a tournament that opens one room per pairing. Everything lives in the process you start. There are no accounts, no database, and no ratings beyond the tournament score.

## Setup

You need Node 22 or newer. There is no install step and no dependencies.

```bash
npm test
PORT=5180 npm start
```

The process prints a URL on `http://127.0.0.1` and listens only on that host. Restarting the process clears rooms and tournaments.

## Play

Type a name, open a room, and sit white in one browser and black in another. Clicks send UCI. The board polls every 1.5 seconds and paints `fen` from the server. Two rooms do not share moves.

Scholar's mate `e2e4 e7e5 d1h5 b8c6 f1c4 g8f6 h5f7` is checkmate for white. An illegal move is refused, and a move after the game is over is refused. The rules include castling, en passant, and promotion. Promotion needs a `q`, `r`, `b`, or `n` suffix. The page sends the two clicked squares with no suffix, so a click with no suffix on the last rank is refused. Stalemate stays `playing`.

## Tournament

Host a tournament, add players, and start. Start needs an even field of at least two. An odd field is refused. Start opens one room per pairing in the order players were added, white then black, and only those paired names may sit.

Checkmate records `1-0` or `0-1` by itself. A person may record `1-0`, `0-1`, or `1/2-1/2` while the game is unfinished. The next round starts only after every pairing in the current round has a result. It seats the same players in the same add order and does not rotate opponents. The score is the tournament score: `1`, `0`, or `0.5`.

## HTTP

| Route | What it does |
| --- | --- |
| `POST /api/rooms` | Open a room. |
| `POST /api/rooms/:id/join` | Sit white or black. The join token is what lets that seat move. A taken seat is `409`. |
| `POST /api/rooms/:id/move` | Play a UCI move for the seat whose turn it is. A refused move is `400`. |
| `GET /api/rooms/:id` | Read the room. |
| `POST /api/tournaments` | Open a tournament. |
| `POST /api/tournaments/:id/players` | Add a player. |
| `POST /api/tournaments/:id/start` | Pair the field and open a room for each pairing. |
| `POST /api/tournaments/:id/results` | Record a result while the game is unfinished. A refused result is `400`. |
| `POST /api/tournaments/:id/next` | Start the next round. A refused next round is `400`. |
| `GET /api/tournaments/:id` | Read players, scores, and rounds. |

An unknown id is `404` `{ "error": "not found" }`.
