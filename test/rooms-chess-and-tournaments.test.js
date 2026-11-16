import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

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

async function sit(port, roomId, name, color) {
  const joined = await api(port, `/api/rooms/${roomId}/join`, {
    method: "POST",
    body: JSON.stringify({ name, color }),
  });
  assert.equal(joined.status, 200, joined.body?.error || color);
  return joined.body.token;
}

async function playLine(port, roomId, white, black, moves) {
  let token = white;
  const played = [];
  for (const uci of moves) {
    const result = await api(port, `/api/rooms/${roomId}/move`, {
      method: "POST",
      body: JSON.stringify({ token, uci }),
    });
    played.push(result);
    token = token === white ? black : white;
  }
  return played;
}

test("new room, one move, and the lines that must be legal or mate", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const { port } = server;
  const created = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "Club" }) });
  assert.equal(created.status, 200);
  const room = await api(port, `/api/rooms/${created.body.id}`);
  assert.equal(room.body.fen, START_FEN);
  assert.deepEqual(room.body.moves, []);
  assert.equal(room.body.status, "playing");
  assert.equal(room.body.winner, null);
  assert.equal(room.body.white, null);
  assert.equal(room.body.black, null);

  const white = await sit(port, created.body.id, "Ada", "white");
  const black = await sit(port, created.body.id, "Bea", "black");
  const stolen = await api(port, `/api/rooms/${created.body.id}/join`, {
    method: "POST",
    body: JSON.stringify({ name: "Cal", color: "white" }),
  });
  assert.equal(stolen.status, 409);
  const again = await api(port, `/api/rooms/${created.body.id}/join`, {
    method: "POST",
    body: JSON.stringify({ name: "Ada", color: "white" }),
  });
  assert.equal(again.body.token, white);

  const first = await api(port, `/api/rooms/${created.body.id}/move`, {
    method: "POST",
    body: JSON.stringify({ token: white, uci: "e2e4" }),
  });
  assert.equal(first.status, 200);
  assert.notEqual(first.body.fen, START_FEN);

  const lounge = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "Lounge" }) });
  const loungeWhite = await sit(port, lounge.body.id, "Ada", "white");
  await sit(port, lounge.body.id, "Bea", "black");
  const crossed = await api(port, `/api/rooms/${created.body.id}/move`, {
    method: "POST",
    body: JSON.stringify({ token: loungeWhite, uci: "a2a3" }),
  });
  assert.equal(crossed.status, 400);
  const otherSeat = await api(port, `/api/rooms/${created.body.id}/move`, {
    method: "POST",
    body: JSON.stringify({ token: white, uci: "a2a3" }),
  });
  assert.equal(otherSeat.status, 400);
  const club = await api(port, `/api/rooms/${created.body.id}`);
  assert.deepEqual(club.body.moves, ["e2e4"]);

  const mateRoom = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "Mate" }) });
  const mateWhite = await sit(port, mateRoom.body.id, "Ada", "white");
  const mateBlack = await sit(port, mateRoom.body.id, "Bea", "black");
  const mateLine = ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"];
  const mate = await playLine(port, mateRoom.body.id, mateWhite, mateBlack, mateLine);
  assert.equal(mate.at(-1).status, 200, mate.at(-1).body?.error);
  assert.equal(mate.at(-1).body.status, "checkmate");
  assert.equal(mate.at(-1).body.winner, "white");
  assert.deepEqual(mate.at(-1).body.moves, mateLine);
  const afterMate = await api(port, `/api/rooms/${mateRoom.body.id}/move`, {
    method: "POST",
    body: JSON.stringify({ token: mateBlack, uci: "a7a6" }),
  });
  assert.equal(afterMate.status, 400);

  const early = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "Early" }) });
  const earlyWhite = await sit(port, early.body.id, "Ada", "white");
  const earlyBlack = await sit(port, early.body.id, "Bea", "black");
  const queen = await playLine(port, early.body.id, earlyWhite, earlyBlack, ["e2e4", "f7f6", "d1h5"]);
  assert.equal(queen.at(-1).status, 200);
  const ignored = await api(port, `/api/rooms/${early.body.id}/move`, {
    method: "POST",
    body: JSON.stringify({ token: earlyBlack, uci: "a7a6" }),
  });
  assert.equal(ignored.status, 400);
  const earlyRoom = await api(port, `/api/rooms/${early.body.id}`);
  assert.deepEqual(earlyRoom.body.moves, ["e2e4", "f7f6", "d1h5"]);

  const castle = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "Castle" }) });
  const castleWhite = await sit(port, castle.body.id, "Ada", "white");
  const castleBlack = await sit(port, castle.body.id, "Bea", "black");
  const kingside = await playLine(port, castle.body.id, castleWhite, castleBlack, ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "e1g1"]);
  assert.equal(kingside.at(-1).status, 200, kingside.at(-1).body?.error);
  assert.ok(kingside.at(-1).body.moves.includes("e1g1"));

  const passant = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "Passant" }) });
  const passantWhite = await sit(port, passant.body.id, "Ada", "white");
  const passantBlack = await sit(port, passant.body.id, "Bea", "black");
  const ep = await playLine(port, passant.body.id, passantWhite, passantBlack, ["e2e4", "a7a6", "e4e5", "d7d5", "e5d6"]);
  assert.equal(ep.at(-1).status, 200, ep.at(-1).body?.error);

  const queenSide = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "Queen side" }) });
  const queenWhite = await sit(port, queenSide.body.id, "Ada", "white");
  const queenBlack = await sit(port, queenSide.body.id, "Bea", "black");
  const longCastle = ["d2d4", "d7d5", "c2c4", "c7c5", "b1c3", "b8c6", "c1e3", "c8e6", "d1d2", "d8d7", "e1c1"];
  const ooo = await playLine(port, queenSide.body.id, queenWhite, queenBlack, longCastle);
  assert.equal(ooo.at(-1).status, 200, ooo.at(-1).body?.error);
  assert.ok(ooo.at(-1).body.moves.includes("e1c1"));

  const promo = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "Promo" }) });
  const promoWhite = await sit(port, promo.body.id, "Ada", "white");
  const promoBlack = await sit(port, promo.body.id, "Bea", "black");
  const line = ["a2a4", "b7b5", "a4b5", "a7a6", "b5b6", "a6a5", "b6b7", "a5a4", "b7a8q"];
  const promoted = await playLine(port, promo.body.id, promoWhite, promoBlack, line);
  assert.equal(promoted.at(-1).status, 200, promoted.at(-1).body?.error);
  const bare = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "Bare promo" }) });
  const bareWhite = await sit(port, bare.body.id, "Ada", "white");
  const bareBlack = await sit(port, bare.body.id, "Bea", "black");
  const almost = await playLine(port, bare.body.id, bareWhite, bareBlack, line.slice(0, -1));
  assert.equal(almost.at(-1).status, 200, almost.at(-1).body?.error);
  const missing = await api(port, `/api/rooms/${bare.body.id}/move`, {
    method: "POST",
    body: JSON.stringify({ token: bareWhite, uci: "b7a8" }),
  });
  assert.equal(missing.status, 400);

  const fools = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "Fools" }) });
  const foolsWhite = await sit(port, fools.body.id, "Ada", "white");
  const foolsBlack = await sit(port, fools.body.id, "Bea", "black");
  const fool = await playLine(port, fools.body.id, foolsWhite, foolsBlack, ["f2f3", "e7e5", "g2g4", "d8h4"]);
  assert.equal(fool.at(-1).status, 200, fool.at(-1).body?.error);
  assert.equal(fool.at(-1).body.status, "checkmate");
  assert.equal(fool.at(-1).body.winner, "black");
});

test("Sunday scores, next round, and a restarted process", async (t) => {
  const server = await startServer();
  const { port } = server;
  const created = await api(port, "/api/tournaments", { method: "POST", body: JSON.stringify({ name: "Sunday" }) });
  const ada = await api(port, `/api/tournaments/${created.body.id}/players`, {
    method: "POST",
    body: JSON.stringify({ name: "Ada" }),
  });
  assert.equal(ada.status, 200);
  const duplicate = await api(port, `/api/tournaments/${created.body.id}/players`, {
    method: "POST",
    body: JSON.stringify({ name: "Ada" }),
  });
  assert.equal(duplicate.status, 400);
  const alone = await api(port, `/api/tournaments/${created.body.id}/start`, { method: "POST", body: "{}" });
  assert.equal(alone.status, 400);

  const pair = await api(port, "/api/tournaments", { method: "POST", body: JSON.stringify({ name: "Two" }) });
  for (const name of ["Ada", "Bea"]) {
    assert.equal((await api(port, `/api/tournaments/${pair.body.id}/players`, {
      method: "POST",
      body: JSON.stringify({ name }),
    })).status, 200);
  }
  const oneGame = await api(port, `/api/tournaments/${pair.body.id}/start`, { method: "POST", body: "{}" });
  assert.equal(oneGame.body.rounds[0].pairings.length, 1);

  for (const name of ["Bea", "Cal", "Dee"]) {
    assert.equal((await api(port, `/api/tournaments/${created.body.id}/players`, {
      method: "POST",
      body: JSON.stringify({ name }),
    })).status, 200);
  }
  const started = await api(port, `/api/tournaments/${created.body.id}/start`, { method: "POST", body: "{}" });
  assert.equal(started.status, 200);
  const [game, other] = started.body.rounds[0].pairings;
  assert.notEqual(game.roomId, other.roomId);
  assert.deepEqual([game.white, game.black, other.white, other.black], ["Ada", "Bea", "Cal", "Dee"]);
  const seated = new Set([game.white, game.black, other.white, other.black]);
  assert.equal(seated.size, 4);
  for (const pairing of [game, other]) {
    const board = await api(port, `/api/rooms/${pairing.roomId}`);
    assert.deepEqual(board.body.moves, []);
    assert.equal(board.body.status, "playing");
    assert.equal(board.body.white, pairing.white);
    assert.equal(board.body.black, pairing.black);
  }

  const earlyNext = await api(port, `/api/tournaments/${created.body.id}/next`, { method: "POST", body: "{}" });
  assert.equal(earlyNext.status, 400);
  const draw = await api(port, `/api/tournaments/${created.body.id}/results`, {
    method: "POST",
    body: JSON.stringify({ round: 1, white: other.white, black: other.black, result: "1/2-1/2" }),
  });
  assert.equal(draw.status, 200);
  const drawn = await api(port, `/api/rooms/${other.roomId}`);
  assert.equal(drawn.body.status, "finished");
  assert.equal(drawn.body.winner, null);
  const again = await api(port, `/api/tournaments/${created.body.id}/results`, {
    method: "POST",
    body: JSON.stringify({ round: 1, white: other.white, black: other.black, result: "1-0" }),
  });
  assert.equal(again.status, 400);
  const drawnMove = await api(port, `/api/rooms/${other.roomId}/join`, {
    method: "POST",
    body: JSON.stringify({ name: other.white, color: "white" }),
  });
  const afterDraw = await api(port, `/api/rooms/${other.roomId}/move`, {
    method: "POST",
    body: JSON.stringify({ token: drawnMove.body.token, uci: "e2e4" }),
  });
  assert.equal(afterDraw.status, 400);
  const stillEarly = await api(port, `/api/tournaments/${created.body.id}/next`, { method: "POST", body: "{}" });
  assert.equal(stillEarly.status, 400);

  const white = await sit(port, game.roomId, game.white, "white");
  const black = await sit(port, game.roomId, game.black, "black");
  const mate = await playLine(port, game.roomId, white, black, ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"]);
  assert.equal(mate.at(-1).body.status, "checkmate");
  const standing = await api(port, `/api/tournaments/${created.body.id}`);
  const finished = standing.body.rounds[0].pairings.find((pairing) => pairing.roomId === game.roomId);
  assert.equal(finished.result, "1-0");
  assert.equal(standing.body.players.find((player) => player.name === game.white).score, 1);
  assert.equal(standing.body.players.find((player) => player.name === other.white).score, 0.5);
  assert.equal(standing.body.players.find((player) => player.name === other.black).score, 0.5);

  const next = await api(port, `/api/tournaments/${created.body.id}/next`, { method: "POST", body: "{}" });
  assert.equal(next.status, 200);
  assert.equal(next.body.rounds.length, 2);
  const roundTwo = next.body.rounds[1].pairings.flatMap((pairing) => [pairing.white, pairing.black]).sort();
  assert.deepEqual(roundTwo, ["Ada", "Bea", "Cal", "Dee"]);

  const foolGame = next.body.rounds[1].pairings[0];
  const foolWhite = await sit(port, foolGame.roomId, foolGame.white, "white");
  const foolBlack = await sit(port, foolGame.roomId, foolGame.black, "black");
  const fool = await playLine(port, foolGame.roomId, foolWhite, foolBlack, ["f2f3", "e7e5", "g2g4", "d8h4"]);
  assert.equal(fool.at(-1).body.status, "checkmate");
  const afterFool = await api(port, `/api/tournaments/${created.body.id}`);
  const foolPairing = afterFool.body.rounds[1].pairings.find((pairing) => pairing.roomId === foolGame.roomId);
  assert.equal(foolPairing.result, "0-1");
  assert.equal(afterFool.body.players.find((player) => player.name === foolGame.black).score, 1);

  const oldId = game.roomId;
  await server.stop();
  const restarted = await startServer();
  t.after(() => restarted.stop());
  const missing = await api(restarted.port, `/api/rooms/${oldId}`);
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { error: "not found" });
});
