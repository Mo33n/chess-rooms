import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { START_FEN, play } from "./chess.js";

const page = new URL("../public/index.html", import.meta.url);
const port = Number(process.env.PORT || 5180);
const rooms = new Map();
const tournaments = new Map();

function id() {
  return randomBytes(8).toString("hex");
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function roomView(room) {
  return {
    id: room.id,
    name: room.name,
    moves: room.moves,
    status: room.status,
    winner: room.winner,
    fen: room.fen,
    white: room.white?.name ?? null,
    black: room.black?.name ?? null,
  };
}

function tournamentView(tournament) {
  return {
    id: tournament.id,
    name: tournament.name,
    players: tournament.players.map((player) => ({ name: player.name, score: player.score })),
    rounds: tournament.rounds.map((round) => ({
      pairings: round.pairings.map((pairing) => ({
        white: pairing.white,
        black: pairing.black,
        roomId: pairing.roomId,
        result: pairing.result,
      })),
    })),
  };
}

function createRoom(name, seats = {}) {
  const room = {
    id: id(),
    name,
    moves: [],
    status: "playing",
    winner: null,
    fen: START_FEN,
    white: seats.white ? { name: seats.white, token: null } : null,
    black: seats.black ? { name: seats.black, token: null } : null,
    tournamentId: seats.tournamentId || null,
  };
  rooms.set(room.id, room);
  return room;
}

function addScore(tournament, pairing) {
  const white = tournament.players.find((player) => player.name === pairing.white);
  const black = tournament.players.find((player) => player.name === pairing.black);
  if (pairing.result === "1-0") white.score += 1;
  else if (pairing.result === "0-1") black.score += 1;
  else {
    white.score += 0.5;
    black.score += 0.5;
  }
}

function recordMate(room) {
  if (!room.tournamentId || room.status !== "checkmate") return;
  const tournament = tournaments.get(room.tournamentId);
  for (const round of tournament.rounds) {
    for (const pairing of round.pairings) {
      if (pairing.roomId !== room.id || pairing.result) continue;
      pairing.result = room.winner === "white" ? "1-0" : "0-1";
      addScore(tournament, pairing);
    }
  }
}

function openRound(tournament, names) {
  const pairings = [];
  for (let index = 0; index < names.length; index += 2) {
    const room = createRoom(tournament.name, {
      white: names[index],
      black: names[index + 1],
      tournamentId: tournament.id,
    });
    pairings.push({
      white: names[index],
      black: names[index + 1],
      roomId: room.id,
      result: null,
    });
  }
  tournament.rounds.push({ pairings });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(await readFile(page));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readJson(req);
    if (!body || typeof body.name !== "string" || !body.name) {
      send(res, 400, { error: "A room needs a name." });
      return;
    }
    send(res, 200, roomView(createRoom(body.name)));
    return;
  }

  const roomId = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
  if (req.method === "GET" && roomId) {
    const room = rooms.get(roomId[1]);
    if (!room) {
      send(res, 404, { error: "not found" });
      return;
    }
    send(res, 200, roomView(room));
    return;
  }

  const join = url.pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
  if (req.method === "POST" && join) {
    const room = rooms.get(join[1]);
    if (!room) {
      send(res, 404, { error: "not found" });
      return;
    }
    const body = await readJson(req);
    if (!body || (body.color !== "white" && body.color !== "black") || typeof body.name !== "string" || !body.name) {
      send(res, 400, { error: "Choose white or black and give a name." });
      return;
    }
    const seat = room[body.color];
    if (seat && seat.name !== body.name) {
      send(res, 409, { error: "That seat is already taken." });
      return;
    }
    if (!seat) room[body.color] = { name: body.name, token: null };
    if (!room[body.color].token) room[body.color].token = randomBytes(24).toString("hex");
    send(res, 200, { token: room[body.color].token, room: roomView(room) });
    return;
  }

  const move = url.pathname.match(/^\/api\/rooms\/([^/]+)\/move$/);
  if (req.method === "POST" && move) {
    const room = rooms.get(move[1]);
    if (!room) {
      send(res, 404, { error: "not found" });
      return;
    }
    const body = await readJson(req);
    if (!body || typeof body.token !== "string" || typeof body.uci !== "string") {
      send(res, 400, { error: "A move needs a seat token and a UCI move." });
      return;
    }
    if (room.status !== "playing") {
      send(res, 400, { error: "The game is over." });
      return;
    }
    const side = room.moves.length % 2 === 0 ? "white" : "black";
    const seat = room[side];
    if (!seat || seat.token !== body.token) {
      send(res, 400, { error: "It is not that seat's turn." });
      return;
    }
    const played = play(room.fen, body.uci);
    if (!played) {
      send(res, 400, { error: "That move is not legal." });
      return;
    }
    room.moves.push(body.uci);
    room.fen = played.fen;
    room.status = played.status;
    room.winner = played.winner;
    recordMate(room);
    send(res, 200, roomView(room));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tournaments") {
    const body = await readJson(req);
    if (!body || typeof body.name !== "string" || !body.name) {
      send(res, 400, { error: "A tournament needs a name." });
      return;
    }
    const tournament = { id: id(), name: body.name, players: [], rounds: [] };
    tournaments.set(tournament.id, tournament);
    send(res, 200, tournamentView(tournament));
    return;
  }

  const tournamentId = url.pathname.match(/^\/api\/tournaments\/([^/]+)$/);
  if (req.method === "GET" && tournamentId) {
    const tournament = tournaments.get(tournamentId[1]);
    if (!tournament) {
      send(res, 404, { error: "not found" });
      return;
    }
    send(res, 200, tournamentView(tournament));
    return;
  }

  const players = url.pathname.match(/^\/api\/tournaments\/([^/]+)\/players$/);
  if (req.method === "POST" && players) {
    const tournament = tournaments.get(players[1]);
    if (!tournament) {
      send(res, 404, { error: "not found" });
      return;
    }
    const body = await readJson(req);
    if (!body || typeof body.name !== "string" || !body.name) {
      send(res, 400, { error: "A player needs a name." });
      return;
    }
    if (tournament.rounds.length || tournament.players.some((player) => player.name === body.name)) {
      send(res, 400, { error: "That player cannot be added." });
      return;
    }
    tournament.players.push({ name: body.name, score: 0 });
    send(res, 200, tournamentView(tournament));
    return;
  }

  const start = url.pathname.match(/^\/api\/tournaments\/([^/]+)\/start$/);
  if (req.method === "POST" && start) {
    const tournament = tournaments.get(start[1]);
    if (!tournament) {
      send(res, 404, { error: "not found" });
      return;
    }
    if (tournament.rounds.length || tournament.players.length < 2 || tournament.players.length % 2 !== 0) {
      send(res, 400, { error: "Start needs an even field of at least two players." });
      return;
    }
    openRound(tournament, tournament.players.map((player) => player.name));
    send(res, 200, tournamentView(tournament));
    return;
  }

  const results = url.pathname.match(/^\/api\/tournaments\/([^/]+)\/results$/);
  if (req.method === "POST" && results) {
    const tournament = tournaments.get(results[1]);
    if (!tournament) {
      send(res, 404, { error: "not found" });
      return;
    }
    const body = await readJson(req);
    const allowed = new Set(["1-0", "0-1", "1/2-1/2"]);
    if (!body || !Number.isInteger(body.round) || !allowed.has(body.result)) {
      send(res, 400, { error: "A result needs a round and a score." });
      return;
    }
    const round = tournament.rounds[body.round - 1];
    const pairing = round?.pairings.find((item) => item.white === body.white && item.black === body.black);
    const room = pairing && rooms.get(pairing.roomId);
    if (!pairing || pairing.result || !room || room.status !== "playing") {
      send(res, 400, { error: "That result is not accepted." });
      return;
    }
    pairing.result = body.result;
    room.status = "finished";
    room.winner = body.result === "1-0" ? "white" : body.result === "0-1" ? "black" : null;
    addScore(tournament, pairing);
    send(res, 200, tournamentView(tournament));
    return;
  }

  const next = url.pathname.match(/^\/api\/tournaments\/([^/]+)\/next$/);
  if (req.method === "POST" && next) {
    const tournament = tournaments.get(next[1]);
    if (!tournament) {
      send(res, 404, { error: "not found" });
      return;
    }
    const current = tournament.rounds.at(-1);
    if (!current || current.pairings.some((pairing) => !pairing.result)) {
      send(res, 400, { error: "Finish every game in this round first." });
      return;
    }
    openRound(tournament, tournament.players.map((player) => player.name));
    send(res, 200, tournamentView(tournament));
    return;
  }

  send(res, 404, { error: "not found" });
}).listen(port, "127.0.0.1", () => {
  console.log(`chess rooms http://127.0.0.1:${port}/`);
});
