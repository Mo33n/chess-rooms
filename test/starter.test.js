import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import net from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
});
