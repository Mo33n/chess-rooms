import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import net from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classify } from "../src/chess.js";

test("this package is the chess rooms app", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  assert.equal(pkg.name, "chess-rooms");
  assert.equal(typeof pkg.scripts.start, "string");
});

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startServer() {
  const port = await freePort();
  const server = fileURLToPath(new URL("../src/server.js", import.meta.url));
  const child = spawn(process.execPath, [server], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const deadline = Date.now() + 5000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.ok) {
        up = true;
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  if (!up) {
    child.kill();
    throw new Error("server did not start");
  }
  return {
    port,
    async stop() {
      child.kill();
      await once(child, "exit");
    },
  };
}

async function api(port, path, options) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options?.headers || {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  return { status: res.status, body };
}

const mate = ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"];

test("two rooms, scholar's mate, and a four-player tournament", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const { port } = server;

  const page = await fetch(`http://127.0.0.1:${port}/`);
  const html = await page.text();
  assert.equal(page.headers.get("content-type")?.includes("text/html"), true);
  assert.match(html, /id="rooms"/);

  const missingRoom = await api(port, "/api/rooms/missing");
  assert.equal(missingRoom.status, 404);
  assert.deepEqual(missingRoom.body, { error: "not found" });
  const missingTournament = await api(port, "/api/tournaments/missing");
  assert.equal(missingTournament.status, 404);
  const unknown = await api(port, "/api/nope");
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.body, { error: "not found" });

  const first = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "Club" }) });
  const second = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "Lounge" }) });
  assert.equal(first.status, 200);
  assert.equal(first.body.status, "playing");
  assert.equal(first.body.turn, "white");
  assert.deepEqual(first.body.moves, []);
  assert.notEqual(first.body.id, second.body.id);

  const white = await api(port, `/api/rooms/${first.body.id}/join`, {
    method: "POST", body: JSON.stringify({ name: "Ada", color: "white" }),
  });
  const black = await api(port, `/api/rooms/${first.body.id}/join`, {
    method: "POST", body: JSON.stringify({ name: "Bea", color: "black" }),
  });
  const stolen = await api(port, `/api/rooms/${first.body.id}/join`, {
    method: "POST", body: JSON.stringify({ name: "Cal", color: "white" }),
  });
  assert.equal(stolen.status, 409);
  const again = await api(port, `/api/rooms/${first.body.id}/join`, {
    method: "POST", body: JSON.stringify({ name: "Ada", color: "white" }),
  });
  assert.equal(again.status, 200);

  let turn = white.body.token;
  for (const uci of mate) {
    const played = await api(port, `/api/rooms/${first.body.id}/move`, {
      method: "POST", body: JSON.stringify({ token: turn, uci }),
    });
    assert.equal(played.status, 200, played.body?.error || uci);
    turn = turn === white.body.token ? black.body.token : white.body.token;
  }
  const done = await api(port, `/api/rooms/${first.body.id}`);
  assert.equal(done.body.status, "checkmate");
  assert.equal(done.body.winner, "white");
  const illegal = await api(port, `/api/rooms/${first.body.id}/move`, {
    method: "POST", body: JSON.stringify({ token: black.body.token, uci: "a7a6" }),
  });
  assert.equal(illegal.status, 400);
  const other = await api(port, `/api/rooms/${second.body.id}`);
  assert.deepEqual(other.body.moves, []);

  const listed = await api(port, "/api/rooms");
  assert.equal(listed.body.rooms.length, 2);

  const tourney = await api(port, "/api/tournaments", { method: "POST", body: JSON.stringify({ name: "Sunday" }) });
  for (const name of ["Ada", "Bea", "Cal", "Dee"]) {
    const added = await api(port, `/api/tournaments/${tourney.body.id}/players`, {
      method: "POST", body: JSON.stringify({ name }),
    });
    assert.equal(added.status, 200);
    assert.equal(added.body.players.find((player) => player.name === name).score, 0);
  }
  const started = await api(port, `/api/tournaments/${tourney.body.id}/start`, { method: "POST", body: "{}" });
  assert.equal(started.status, 200);
  assert.equal(started.body.rounds[0].pairings.length, 2);
  const seated = started.body.rounds[0].pairings.flatMap((pairing) => [pairing.white, pairing.black]).sort();
  assert.deepEqual(seated, ["Ada", "Bea", "Cal", "Dee"]);

  const game = started.body.rounds[0].pairings[0];
  const otherGame = started.body.rounds[0].pairings[1];
  const early = await api(port, `/api/tournaments/${tourney.body.id}/next`, { method: "POST", body: "{}" });
  assert.equal(early.status, 400);
  const reported = await api(port, `/api/tournaments/${tourney.body.id}/results`, {
    method: "POST",
    body: JSON.stringify({ round: 1, white: otherGame.white, black: otherGame.black, result: "1/2-1/2" }),
  });
  assert.equal(reported.status, 200);
  const agreed = await api(port, `/api/rooms/${otherGame.roomId}`);
  assert.equal(agreed.body.status, "agreed");
  assert.equal(agreed.body.winner, null);
  const afterDraw = await api(port, `/api/tournaments/${tourney.body.id}`);
  assert.equal(afterDraw.body.players.find((player) => player.name === otherGame.white).score, 0.5);
  assert.equal(afterDraw.body.players.find((player) => player.name === otherGame.black).score, 0.5);

  const hostWhite = await api(port, `/api/rooms/${game.roomId}/join`, {
    method: "POST", body: JSON.stringify({ name: game.white, color: "white" }),
  });
  const hostBlack = await api(port, `/api/rooms/${game.roomId}/join`, {
    method: "POST", body: JSON.stringify({ name: game.black, color: "black" }),
  });
  turn = hostWhite.body.token;
  for (const uci of mate) {
    const played = await api(port, `/api/rooms/${game.roomId}/move`, {
      method: "POST", body: JSON.stringify({ token: turn, uci }),
    });
    assert.equal(played.status, 200, played.body?.error || uci);
    turn = turn === hostWhite.body.token ? hostBlack.body.token : hostWhite.body.token;
  }
  const standing = await api(port, `/api/tournaments/${tourney.body.id}`);
  const finished = standing.body.rounds[0].pairings.find((pairing) => pairing.roomId === game.roomId);
  assert.equal(finished.result, "1-0");
  assert.equal(standing.body.players.find((player) => player.name === game.white).score, 1);

  const next = await api(port, `/api/tournaments/${tourney.body.id}/next`, { method: "POST", body: "{}" });
  assert.equal(next.status, 200);
  assert.equal(next.body.rounds.length, 2);
  const reseated = next.body.rounds[1].pairings.flatMap((pairing) => [pairing.white, pairing.black]).sort();
  assert.deepEqual(reseated, ["Ada", "Bea", "Cal", "Dee"]);

  const huge = await api(port, "/api/rooms", {
    method: "POST",
    body: JSON.stringify({ name: "n".repeat(70 * 1024) }),
  });
  assert.equal(huge.status, 400);
});

const startPosition = [
  "rnbqkbnr",
  "pppppppp",
  "........",
  "........",
  "........",
  "........",
  "PPPPPPPP",
  "RNBQKBNR",
];

function emptyBoard() {
  return Array.from({ length: 8 }, () => Array(8).fill("."));
}

async function sit(port, roomId, whiteName, blackName) {
  const white = await api(port, `/api/rooms/${roomId}/join`, {
    method: "POST", body: JSON.stringify({ name: whiteName, color: "white" }),
  });
  const black = await api(port, `/api/rooms/${roomId}/join`, {
    method: "POST", body: JSON.stringify({ name: blackName, color: "black" }),
  });
  return { white, black };
}

async function playLine(port, roomId, whiteToken, blackToken, moves) {
  let token = whiteToken;
  let last = null;
  for (const uci of moves) {
    last = await api(port, `/api/rooms/${roomId}/move`, {
      method: "POST", body: JSON.stringify({ token, uci }),
    });
    if (last.status !== 200) return last;
    token = token === whiteToken ? blackToken : whiteToken;
  }
  return last;
}

test("castling, en passant, promotion, stalemate, and tournament refusals", async (t) => {
  const spec = emptyBoard();
  spec[0][0] = "k";
  spec[2][1] = "K";
  spec[3][1] = "Q";
  assert.equal(classify(spec, false), "playing");
  const stalemate = emptyBoard();
  stalemate[0][0] = "k";
  stalemate[2][0] = "K";
  stalemate[2][1] = "Q";
  assert.equal(classify(stalemate, false), "stalemate");

  const server = await startServer();
  t.after(() => server.stop());
  const { port } = server;

  const created = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "Rules" }) });
  assert.deepEqual(created.body.position, startPosition);
  assert.equal(created.body.check, false);
  const seats = await sit(port, created.body.id, "Ada", "Bea");

  const kingside = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5", "e1g1"];
  let played = await playLine(port, created.body.id, seats.white.body.token, seats.black.body.token, kingside);
  assert.equal(played.status, 200);
  assert.equal(played.body.position[7][6], "K");
  assert.equal(played.body.position[7][5], "R");
  played = await playLine(port, created.body.id, seats.black.body.token, seats.white.body.token, ["g8f6", "a2a3", "e8g8"]);
  assert.equal(played.status, 200);
  const castled = await api(port, `/api/rooms/${created.body.id}`);
  assert.equal(castled.body.position[0][6], "k");
  assert.equal(castled.body.position[0][5], "r");

  const queenRoom = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "Queen" }) });
  const queenSeats = await sit(port, queenRoom.body.id, "Ada", "Bea");
  const queenside = ["d2d4", "d7d5", "b1c3", "b8c6", "c1f4", "c8f5", "d1d2", "d8d7", "e1c1"];
  played = await playLine(port, queenRoom.body.id, queenSeats.white.body.token, queenSeats.black.body.token, queenside);
  assert.equal(played.status, 200);
  assert.equal(played.body.position[7][2], "K");
  assert.equal(played.body.position[7][3], "R");

  async function refused(name, moves, uci) {
    const room = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name }) });
    const pair = await sit(port, room.body.id, "Ada", "Bea");
    const before = await playLine(port, room.body.id, pair.white.body.token, pair.black.body.token, moves);
    assert.equal(before.status, 200, name);
    const token = moves.length % 2 === 0 ? pair.white.body.token : pair.black.body.token;
    const denied = await api(port, `/api/rooms/${room.body.id}/move`, {
      method: "POST", body: JSON.stringify({ token, uci }),
    });
    assert.equal(denied.status, 400, name);
    const again = await api(port, `/api/rooms/${room.body.id}`);
    assert.deepEqual(again.body.moves, moves);
    assert.deepEqual(again.body.position, before.body.position);
    assert.equal(again.body.status, "playing");
  }

  await refused("through", ["e2e4", "b7b6", "g2g3", "c8a6", "f1g2", "h7h6"], "e1g1");
  await refused("checked", ["e2e4", "e7e5", "f1c4", "b8c6", "g1e2", "a7a6", "f2f3", "d8h4"], "e1g1");
  await refused("king moved", ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "e1e2", "f8c5", "e2e1", "a7a6"], "e1g1");
  await refused("rook moved", ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "h2h3", "f8e7", "h1h2", "a7a6", "h2h1", "a6a5"], "e1g1");

  const epRoom = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "Pass" }) });
  const epSeats = await sit(port, epRoom.body.id, "Ada", "Bea");
  played = await playLine(port, epRoom.body.id, epSeats.white.body.token, epSeats.black.body.token, ["e2e4", "a7a6", "e4e5", "d7d5", "e5d6"]);
  assert.equal(played.status, 200);
  assert.equal(played.body.position[2][3], "P");
  assert.equal(played.body.position[3][3], ".");
  assert.equal(played.body.position[3][4], ".");
  const lateRoom = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "Late" }) });
  const lateSeats = await sit(port, lateRoom.body.id, "Ada", "Bea");
  const lateMoves = ["e2e4", "a7a6", "e4e5", "d7d5", "g1f3", "h7h6"];
  played = await playLine(port, lateRoom.body.id, lateSeats.white.body.token, lateSeats.black.body.token, lateMoves);
  assert.equal(played.status, 200);
  const late = await api(port, `/api/rooms/${lateRoom.body.id}/move`, {
    method: "POST", body: JSON.stringify({ token: lateSeats.white.body.token, uci: "e5d6" }),
  });
  assert.equal(late.status, 400);
  const lateGot = await api(port, `/api/rooms/${lateRoom.body.id}`);
  assert.deepEqual(lateGot.body.moves, lateMoves);
  assert.deepEqual(lateGot.body.position, played.body.position);

  const promoRoom = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "Promo" }) });
  const promoSeats = await sit(port, promoRoom.body.id, "Ada", "Bea");
  const toPromo = ["h2h4", "a7a5", "h4h5", "a5a4", "h5h6", "a4a3", "h6g7", "a3b2"];
  played = await playLine(port, promoRoom.body.id, promoSeats.white.body.token, promoSeats.black.body.token, toPromo);
  assert.equal(played.status, 200);
  const bare = await api(port, `/api/rooms/${promoRoom.body.id}/move`, {
    method: "POST", body: JSON.stringify({ token: promoSeats.white.body.token, uci: "g7h8" }),
  });
  assert.equal(bare.status, 400);
  const bareGot = await api(port, `/api/rooms/${promoRoom.body.id}`);
  assert.deepEqual(bareGot.body.moves, toPromo);
  played = await api(port, `/api/rooms/${promoRoom.body.id}/move`, {
    method: "POST", body: JSON.stringify({ token: promoSeats.white.body.token, uci: "g7h8q" }),
  });
  assert.equal(played.status, 200);
  assert.equal(played.body.position[0][7], "Q");

  const mateRoom = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "Mate" }) });
  const mateSeats = await sit(port, mateRoom.body.id, "Ada", "Bea");
  const prefix = mate.slice(0, 5);
  played = await playLine(port, mateRoom.body.id, mateSeats.white.body.token, mateSeats.black.body.token, prefix);
  assert.equal(played.status, 200);
  assert.equal(played.body.status, "playing");
  assert.equal(played.body.check, false);
  const fool = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "Check" }) });
  const foolSeats = await sit(port, fool.body.id, "Ada", "Bea");
  played = await playLine(port, fool.body.id, foolSeats.white.body.token, foolSeats.black.body.token, ["e2e4", "f7f5", "d1h5"]);
  assert.equal(played.body.check, true);
  assert.equal(played.body.status, "playing");
  played = await playLine(port, mateRoom.body.id, mateSeats.black.body.token, mateSeats.white.body.token, ["g8f6", "h5f7"]);
  assert.equal(played.body.status, "checkmate");
  assert.equal(played.body.winner, "white");
  assert.equal(played.body.check, false);

  const drawMoves = ["e2e3", "a7a5", "d1h5", "a8a6", "h5a5", "h7h5", "a5c7", "a6h6", "h2h4", "f7f6", "c7d7", "e8f7", "d7b7", "d8d3", "b7b8", "d3h7", "b8c8", "f7g6", "c8e6"];
  const drawRoom = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "Draw" }) });
  const drawSeats = await sit(port, drawRoom.body.id, "Ada", "Bea");
  played = await playLine(port, drawRoom.body.id, drawSeats.white.body.token, drawSeats.black.body.token, drawMoves);
  assert.equal(played.status, 200);
  assert.equal(played.body.status, "stalemate");
  assert.equal(played.body.winner, null);
  assert.equal(played.body.turn, null);
  assert.equal(played.body.check, false);
  const afterDraw = await api(port, `/api/rooms/${drawRoom.body.id}/move`, {
    method: "POST", body: JSON.stringify({ token: drawSeats.black.body.token, uci: "a7a6" }),
  });
  assert.equal(afterDraw.status, 400);

  const tourney = await api(port, "/api/tournaments", { method: "POST", body: JSON.stringify({ name: "Refusals" }) });
  const added = await api(port, `/api/tournaments/${tourney.body.id}/players`, {
    method: "POST", body: JSON.stringify({ name: "Ada" }),
  });
  assert.equal(added.status, 200);
  const duplicate = await api(port, `/api/tournaments/${tourney.body.id}/players`, {
    method: "POST", body: JSON.stringify({ name: "Ada" }),
  });
  assert.equal(duplicate.status, 400);
  const afterDuplicate = await api(port, `/api/tournaments/${tourney.body.id}`);
  assert.equal(afterDuplicate.body.players.length, 1);
  const roomsBeforeAlone = await api(port, "/api/rooms");
  const alone = await api(port, `/api/tournaments/${tourney.body.id}/start`, { method: "POST", body: "{}" });
  assert.equal(alone.status, 400);
  const roomsBefore = await api(port, "/api/rooms");
  assert.equal(roomsBefore.body.rooms.length, roomsBeforeAlone.body.rooms.length);
  const odd = await api(port, "/api/tournaments", { method: "POST", body: JSON.stringify({ name: "Odd" }) });
  for (const name of ["Ada", "Bea", "Cal"]) {
    assert.equal((await api(port, `/api/tournaments/${odd.body.id}/players`, {
      method: "POST", body: JSON.stringify({ name }),
    })).status, 200);
  }
  const oddStart = await api(port, `/api/tournaments/${odd.body.id}/start`, { method: "POST", body: "{}" });
  assert.equal(oddStart.status, 400);
  const oddGot = await api(port, `/api/tournaments/${odd.body.id}`);
  assert.deepEqual(oddGot.body.rounds, []);
  const roomsAfter = await api(port, "/api/rooms");
  assert.equal(roomsAfter.body.rooms.length, roomsBefore.body.rooms.length);

  const pair = await api(port, "/api/tournaments", { method: "POST", body: JSON.stringify({ name: "Pair" }) });
  for (const name of ["Ada", "Bea", "Cal", "Dee"]) {
    await api(port, `/api/tournaments/${pair.body.id}/players`, { method: "POST", body: JSON.stringify({ name }) });
  }
  const started = await api(port, `/api/tournaments/${pair.body.id}/start`, { method: "POST", body: "{}" });
  const latePlayer = await api(port, `/api/tournaments/${pair.body.id}/players`, {
    method: "POST", body: JSON.stringify({ name: "Cal" }),
  });
  assert.equal(latePlayer.status, 400);
  const game = started.body.rounds[0].pairings[0];
  const wrong = await api(port, `/api/rooms/${game.roomId}/join`, {
    method: "POST", body: JSON.stringify({ name: "Cal", color: "white" }),
  });
  assert.equal(wrong.status, 409);
  const swapped = await api(port, `/api/rooms/${game.roomId}/join`, {
    method: "POST", body: JSON.stringify({ name: game.white, color: "black" }),
  });
  assert.equal(swapped.status, 409);
  const host = await api(port, `/api/rooms/${game.roomId}/join`, {
    method: "POST", body: JSON.stringify({ name: game.white, color: "white" }),
  });
  const guest = await api(port, `/api/rooms/${game.roomId}/join`, {
    method: "POST", body: JSON.stringify({ name: game.black, color: "black" }),
  });
  const reseat = await api(port, `/api/rooms/${game.roomId}/join`, {
    method: "POST", body: JSON.stringify({ name: game.white, color: "white" }),
  });
  assert.equal(reseat.status, 200);
  assert.equal(typeof reseat.body.token, "string");
  assert.equal(host.body.room.position.length, 8);
  assert.equal(host.body.room.check, false);

  const twice = await api(port, `/api/tournaments/${pair.body.id}/results`, {
    method: "POST", body: JSON.stringify({ round: 1, white: game.white, black: game.black, result: "1-0" }),
  });
  assert.equal(twice.status, 200);
  const againResult = await api(port, `/api/tournaments/${pair.body.id}/results`, {
    method: "POST", body: JSON.stringify({ round: 1, white: game.white, black: game.black, result: "0-1" }),
  });
  assert.equal(againResult.status, 400);
  const unknown = await api(port, `/api/tournaments/${pair.body.id}/results`, {
    method: "POST", body: JSON.stringify({ round: 1, white: "Nobody", black: game.black, result: "1-0" }),
  });
  assert.equal(unknown.status, 400);
  const win = await api(port, `/api/tournaments/${pair.body.id}/results`, {
    method: "POST", body: JSON.stringify({ round: 1, white: game.white, black: game.black, result: "win" }),
  });
  assert.equal(win.status, 400);
  const early = await api(port, `/api/tournaments/${pair.body.id}/next`, { method: "POST", body: "{}" });
  assert.equal(early.status, 400);
  const kept = await api(port, `/api/tournaments/${pair.body.id}`);
  assert.equal(kept.body.rounds[0].pairings[0].result, "1-0");
  assert.equal(kept.body.players.find((player) => player.name === game.white).score, 1);
  assert.equal(kept.body.players.find((player) => player.name === game.black).score, 0);
  const ignored = await api(port, `/api/rooms/${game.roomId}/move`, {
    method: "POST", body: JSON.stringify({ token: guest.body.token, uci: "a7a6" }),
  });
  assert.equal(ignored.status, 400);
  const still = await api(port, `/api/tournaments/${pair.body.id}`);
  assert.equal(still.body.rounds[0].pairings[0].result, "1-0");
  assert.equal(still.body.players.find((player) => player.name === game.white).score, 1);

  const halved = await api(port, "/api/tournaments", { method: "POST", body: JSON.stringify({ name: "Half" }) });
  for (const name of ["Ada", "Bea"]) {
    await api(port, `/api/tournaments/${halved.body.id}/players`, { method: "POST", body: JSON.stringify({ name }) });
  }
  const halfStart = await api(port, `/api/tournaments/${halved.body.id}/start`, { method: "POST", body: "{}" });
  const halfGame = halfStart.body.rounds[0].pairings[0];
  const halfWhite = await api(port, `/api/rooms/${halfGame.roomId}/join`, {
    method: "POST", body: JSON.stringify({ name: halfGame.white, color: "white" }),
  });
  const halfBlack = await api(port, `/api/rooms/${halfGame.roomId}/join`, {
    method: "POST", body: JSON.stringify({ name: halfGame.black, color: "black" }),
  });
  played = await playLine(port, halfGame.roomId, halfWhite.body.token, halfBlack.body.token, drawMoves);
  assert.equal(played.body.status, "stalemate");
  const scores = await api(port, `/api/tournaments/${halved.body.id}`);
  assert.equal(scores.body.rounds[0].pairings[0].result, "1/2-1/2");
  assert.equal(scores.body.players.find((player) => player.name === halfGame.white).score, 0.5);
  assert.equal(scores.body.players.find((player) => player.name === halfGame.black).score, 0.5);
});
