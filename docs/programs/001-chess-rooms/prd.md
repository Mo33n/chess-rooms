# Chess rooms

Build a production-quality local web chess club. One Node process, no dependencies, no accounts. Two people on one machine play in separate browsers. A tournament opens one room per pairing.

## Play

- The page has a room column, a chessboard, and a tournament column.
- A person types a name, opens a named room, and sits white or black.
- A taken seat rejects a different name. The same name can sit again.
- Moves are clicks on the board, sent as UCI. The board polls every 1.5 seconds so the other browser shows the move without a reload.
- Scholar's mate (e2e4 e7e5 d1h5 b8c6 f1c4 g8f6 h5f7) is checkmate for white.
- An illegal move, or a move after the game is over, is refused.
- Two rooms do not share moves.
- Legal chess includes castling, en passant, and promotion. A move that leaves your own king in check is illegal.

## Tournaments

- Host a tournament, add at least two named players, and start it.
- Start opens one room per pairing and only those names may sit in that room.
- A checkmate records 1-0 or 0-1 by itself. A person can also record 1-0, 0-1, or 1/2-1/2 when the room is not already finished.
- The next round starts only after every pairing in the current round has a result. Every player is seated again.

## Quality bar

- `npm test` passes.
- `factory/accept.sh` passes. It runs `test/hidden/product.test.js`. Do not edit that file or `factory/accept.sh`.
- `PORT=5180 npm start` prints a URL. The page is usable: named controls, a visible board, and errors a person can read.
- Restarting the server clears rooms and tournaments.

## Out of scope

Accounts, passwords, a database, ratings beyond the tournament score, and deploy.
