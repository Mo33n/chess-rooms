# 006-tournament-on-the-page

Issue: #6 Tournament on the page
Result: APPROVE
PR: #15

## What landed
- Intake accepted ticket 6 with no rescope; this spec follows that Scope.
- `#tournaments` on `public/index.html` creates a named tournament, adds distinct player names, and starts it through the existing tournament routes.
- After start, that area shows round 1 and each pairing. Pairing rooms already appear in `GET /api/rooms`, so the existing rooms poll lists them.
- A name that is not the paired seat, and a start with fewer than two players, show the API error text. Casual rooms, seats, and the live board stay as they are.
- The three page ids stay. Decision 0001 and results on the page are later tickets.

## How it was proved
1. `GET /` returns HTML containing `id="rooms"`, `id="board"`, and `id="tournaments"`. `node --test test/page-tournament.test.js` asserts that.
2. With the server running, submitting a tournament name and two distinct player names, then starting, returns a tournament whose `rounds[0].round` is `1` and whose pairings contain those two names. `#tournaments` text includes the tournament name, `1`, and both player names. The test drives the page script (the create, add, and start functions or their form submits) and reads `#tournaments`.
3. After that start, `GET /api/rooms` includes one room per pairing, and a poll of the existing rooms list renders each pairing room's `name` inside `#rooms`. The test asserts those names are the button text, not HTML.
4. Opening a pairing room and submitting a different name on white returns 409, `#seat-error` text is `seat taken`, and `GET /api/rooms/:id` still has the paired white name. Submitting the paired white name returns 200 and a `token`. The test uses the page's `sit` path.
5. Creating a tournament, adding one player, and starting returns 400, `#tournaments` includes `bad request`, and `GET /api/rooms` has no room from that start. Adding the same player name twice returns 400 on the second add, `#tournaments` includes `bad request`, and the tournament document lists that name once.
6. A tournament name and a player name `<img src=x onerror=alert(1)>` appear in `#tournaments` as literal text and do not become an element. The test renders them the way the page does and asserts no element was created from that string.
7. A casual room created from `#create-room` is still listed, can be opened, sat, and moved with `e2e4`, and `#board` still draws that position. The test runs that path and checks the e4 square text is `P`.
8. `AGENTS.md` states that the tournaments area creates a named tournament, adds players, starts it, shows the round and pairings, that those rooms appear in the rooms list, and that a refused seat and a start with fewer than two players are shown on the page.
9. `git diff --name-only origin/main` does not list any path matching `protected_paths` in `factory/config.json`, and does not list `src/`.
