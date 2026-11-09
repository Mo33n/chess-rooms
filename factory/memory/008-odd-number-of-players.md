# 008-odd-number-of-players

Issue: #8 Odd number of players
Result: APPROVE
PR: #17

## What landed
- Accepted decision 0001 says a tournament never has an odd number of players, so the locked policy is to refuse the round.
- `POST .../start` and `POST .../next` stay 400 with no new rooms when the player count is odd; even counts and a four-player second round stay as they are.
- The tournaments page says the number of players is odd after that refusal. A leftover player gets no room and no score change.
- New coverage goes in `test/tournament-odd-players.test.js`. `AGENTS.md` records the page sentence.

## How it was proved
1. `node --test test/tournament-odd-players.test.js` creates a tournament, adds three players, `POST .../start` returns 400 with `{ "error": "bad request" }`, `GET` shows `rounds: []` and the same scores, and `GET /api/rooms` has no room whose name is that tournament's pairing.
2. That test loads the page script the way `test/page-tournament.test.js` does, starts those three players, and the text of `#tournaments` matches `/number of players is odd/`.
3. That test still shows `bad request` for a one-player start, and does not treat that refusal as the odd-count sentence.
4. That test starts four named players, records a result for every pairing in round 1, `POST .../next` returns 200 with `rounds.length === 2`, and every player name appears once in round 2.
5. `src/store.js` `nextRound` returns 400 `{ "error": "bad request" }` when `players.length % 2 !== 0`, before `pairPlayers`, and does not push a round. A finished even round still advances.
6. `AGENTS.md` states that an odd count of three or more on start is shown on the page as the number of players being odd, and that `POST .../next` refuses an odd count with 400 and opens no rooms.
7. `git diff --name-only origin/main` does not list a path matching `protected_paths` in `factory/config.json`.
