# 005-a-live-board

Issue: #5 A live board
Result: APPROVE
PR: #14

## What landed
- Intake accepted ticket 5 with no rescope; this spec follows that Scope.
- `public/index.html` already sits and posts UCI; this ticket draws the open room's `position` on `#board`, white at the bottom.
- The other browser sees that drawing, including a new move, by the existing open-room poll under two seconds.
- The board shows check, checkmate, stalemate, and the winner. A refused move leaves the drawing unchanged. Two open rooms do not share a position.
- The three page ids stay. Decision 0001 is ticket 8 and does not apply here.

## How it was proved
1. `GET /` still returns HTML containing `id="rooms"`, `id="board"`, and `id="tournaments"`. `node --test test/board-live.test.js` asserts that.
2. With the server running, two clients sit in one room and the white client submits `e2e4` from the page move path. The returned room `position` has a white pawn on e4. `test/board-live.test.js` drives `playMove` (or the `#move-form` submit) and reads the drawing: the top rank is the first `position` string and the bottom rank is the last, and the e4 square's text is `P`.
3. A second page load with that room open, not reloaded after the move, shows that same e4 pawn once a poll has run. The test reads the open-room interval from the page and fails if it is missing or not under 2000, and fails if the polled `position` is not what `#board` renders.
4. After `e2e4 e7e5 d1h5 b8c6 f1c4` through the page, the board text includes `check` while `status` is `playing`. After `g8f6 h5f7`, the board text includes `checkmate` and `white`, and does not include a live-check claim. The test asserts those strings on `#board`.
5. A game the API finishes as `stalemate` (`winner` null), played or loaded through the same drawing path, shows `stalemate` on `#board` and does not show `winner: white` or `winner: black`. The test uses a room the server already reports as stalemate, or plays one, and reads the board text.
6. One castling move, one en-passant capture, and one promotion, each posted through the page, leave the drawing equal to that response's `position` (king and rook on the castled squares, capturer on the passed-over square, promoted piece letter on the last rank). The test compares the eight rendered ranks to `position`.
7. Submitting `e2e5` from the start, and submitting any UCI after Scholar's mate, each leave the rendered ranks identical to the position from before that request, and `#seat-error` is non-empty. The test records the rank text, submits, and compares.
8. Create room A and room B, sit both, play `e2e4` in A. A page with B open renders B's starting position, not A's e4 pawn. The test opens each room and compares the eight ranks.
9. A room name and a seat name `<img src=x onerror=alert(1)>` still appear as literal text. The test asserts no element was created from that string.
10. `AGENTS.md` states that the open board draws `position` with white at the bottom and shows check, checkmate, stalemate, and the winner, and that another browser sees a move by polling within two seconds.
11. `git diff --name-only origin/main` does not list any path matching `protected_paths` in `factory/config.json`.
