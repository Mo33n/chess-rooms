# 007-results-on-the-page

Issue: #7 Results on the page
Result: APPROVE
PR: #16

## What landed
- Accepted scope is ticket 7 as written: scores, reported results, and the next round on the existing page.
- `#tournaments` already creates a tournament, adds names, starts it, and lists the latest round. It does not show scores, results, or earlier rounds, and it does not call results or next.
- Checkmate and stalemate already write the pairing result in `src/store.js`. The page must poll the open tournament so that result and the scores appear.
- A person reports `1-0`, `0-1`, or `1/2-1/2` for an unfinished pairing, and starts the next round only after every pairing in the current round has a result.
- Refusals stay the API's `bad request` text in `#tournaments`. The three page ids stay. New checks go in a new test file.

## How it was proved
1. `npm test` runs `test/page-results.test.js`. That file starts the server, loads `public/index.html` the way `test/page-tournament.test.js` does, creates a four-player tournament, and starts it. After Scholar's mate in one pairing's room (`e2e4 e7e5 d1h5 b8c6 f1c4 g8f6 h5f7` by the seated tokens), a poll of the tournament view shows `1-0` on that pairing and the white player's score increased by 1. The other pairing stays without a result and that player's score stays unchanged.
2. The same file reaches stalemate in a pairing room (ticket 2's fixture is enough: white king on b6, white queen on b5, black king on a8, black to move, no legal move). The tournament view shows `1/2-1/2` on that pairing and each of those two scores increased by 0.5.
3. The same file reports `1-0` for an unfinished pairing through the page control. The view shows `1-0` and the white score increased by 1. It reports `1/2-1/2` for another unfinished pairing. The view shows `1/2-1/2` and each of those two scores increased by 0.5. Reporting again for a pairing that already has a result leaves the text of `#tournaments` matching `/bad request/` and does not change that result or those scores.
4. The same file, with one pairing still unfinished, uses the next-round control. `#tournaments` matches `/bad request/` and the view still shows a single round. After every pairing has a result, the next-round control leaves two round numbers visible, every player name exactly once among the new round's pairings, and the new pairing room names present in the rooms list.
5. `GET /` still contains `id="rooms"`, `id="board"`, and `id="tournaments"`. The worktree `AGENTS.md` describes scores, a reported result, checkmate and stalemate results on the pairing, the next-round refusal, and both rounds on the page.
6. `git diff --name-only origin/main` lists no path matching `protected_paths` in `factory/config.json`, and lists no path outside `public/**`, `test/page*`, `test/web*`, `test/seats*`, `test/board*`, `AGENTS.md`, and `README.md`.
