import { randomBytes } from "node:crypto";
import { play, sideInCheck, startingBoard, startingCastle } from "./chess.js";

const rooms = new Map();
const tournaments = new Map();
const seats = new Map();
let nextId = 1;

function id() {
  return String(nextId++);
}

function publicRoom(room) {
  return {
    id: room.id,
    name: room.name,
    moves: room.moves.slice(),
    status: room.status,
    winner: room.winner,
    white: room.white,
    black: room.black,
    turn: room.turn,
    position: room.board.map((row) => row.join("")),
    check: room.status === "playing" && sideInCheck(room.board, room.turn === "white"),
  };
}

function publicTournament(tournament) {
  return {
    id: tournament.id,
    name: tournament.name,
    players: tournament.players.map((player) => ({ name: player.name, score: player.score })),
    rounds: tournament.rounds.map((round) => ({
      round: round.round,
      pairings: round.pairings.map((pairing) => ({
        white: pairing.white,
        black: pairing.black,
        roomId: pairing.roomId,
        result: pairing.result,
      })),
    })),
  };
}

function player(tournament, name) {
  return tournament.players.find((entry) => entry.name === name);
}

export function createRoom(name) {
  if (typeof name !== "string" || name.length === 0) return { status: 400, body: { error: "bad request" } };
  const room = {
    id: id(),
    name,
    moves: [],
    status: "playing",
    winner: null,
    white: null,
    black: null,
    turn: "white",
    board: startingBoard(),
    castle: startingCastle(),
    ep: null,
    tournamentId: null,
  };
  rooms.set(room.id, room);
  return { status: 200, body: publicRoom(room) };
}

export function listRooms() {
  return {
    rooms: [...rooms.values()].map((room) => ({ id: room.id, name: room.name, status: room.status })),
  };
}

export function getRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return { status: 404, body: { error: "not found" } };
  return { status: 200, body: publicRoom(room) };
}

export function joinRoom(roomId, name, color) {
  const room = rooms.get(roomId);
  if (!room) return { status: 404, body: { error: "not found" } };
  if ((color !== "white" && color !== "black") || typeof name !== "string" || name.length === 0) {
    return { status: 400, body: { error: "bad request" } };
  }
  if (room.tournamentId && room[color] !== name) return { status: 409, body: { error: "seat taken" } };
  if (room[color] !== null && room[color] !== name) return { status: 409, body: { error: "seat taken" } };
  room[color] = name;
  const token = randomBytes(16).toString("hex");
  seats.set(token, { roomId, color });
  return { status: 200, body: { token, room: publicRoom(room) } };
}

function addScore(tournament, name, points) {
  const entry = player(tournament, name);
  if (entry) entry.score += points;
}

function finishAgreed(room, result) {
  if (!room || room.status !== "playing") return;
  room.status = "agreed";
  room.turn = null;
  room.winner = result === "1-0" ? "white" : result === "0-1" ? "black" : null;
}

function applyResult(tournament, pairing, result) {
  pairing.result = result;
  if (result === "1-0") addScore(tournament, pairing.white, 1);
  else if (result === "0-1") addScore(tournament, pairing.black, 1);
  else {
    addScore(tournament, pairing.white, 0.5);
    addScore(tournament, pairing.black, 0.5);
  }
  finishAgreed(rooms.get(pairing.roomId), result);
}

function recordGame(room, result) {
  if (!room.tournamentId) return;
  const tournament = tournaments.get(room.tournamentId);
  if (!tournament) return;
  for (const round of tournament.rounds) {
    const pairing = round.pairings.find((entry) => entry.roomId === room.id);
    if (!pairing || pairing.result !== null) continue;
    pairing.result = result;
    if (result === "1-0") addScore(tournament, pairing.white, 1);
    else if (result === "0-1") addScore(tournament, pairing.black, 1);
    else {
      addScore(tournament, pairing.white, 0.5);
      addScore(tournament, pairing.black, 0.5);
    }
  }
}

export function moveRoom(roomId, token, uci) {
  const room = rooms.get(roomId);
  if (!room) return { status: 404, body: { error: "not found" } };
  const seat = seats.get(token);
  if (!seat || seat.roomId !== roomId || room.status !== "playing" || seat.color !== room.turn) {
    return { status: 400, body: { error: "bad move" } };
  }
  const played = play(room.board, uci, room.turn === "white", { castle: room.castle, ep: room.ep });
  if (!played) return { status: 400, body: { error: "bad move" } };
  room.board = played.board;
  room.castle = played.castle;
  room.ep = played.ep;
  room.moves.push(uci);
  if (played.checkmate) {
    room.status = "checkmate";
    room.winner = room.turn;
    room.turn = null;
    recordGame(room, room.winner === "white" ? "1-0" : "0-1");
  } else if (played.stalemate) {
    room.status = "stalemate";
    room.winner = null;
    room.turn = null;
    recordGame(room, "1/2-1/2");
  } else {
    room.turn = room.turn === "white" ? "black" : "white";
  }
  return { status: 200, body: publicRoom(room) };
}

function openPairingRoom(tournament, roundNumber, white, black) {
  const created = createRoom(`${tournament.name} ${white} vs ${black}`);
  const room = rooms.get(created.body.id);
  room.white = white;
  room.black = black;
  room.tournamentId = tournament.id;
  return { white, black, roomId: room.id, result: null };
}

function pairPlayers(tournament, roundNumber) {
  const names = tournament.players.map((entry) => entry.name);
  const pairings = [];
  for (let i = 0; i + 1 < names.length; i += 2) {
    const swap = roundNumber % 2 === 0;
    const white = swap ? names[i + 1] : names[i];
    const black = swap ? names[i] : names[i + 1];
    pairings.push(openPairingRoom(tournament, roundNumber, white, black));
  }
  return pairings;
}

export function createTournament(name) {
  if (typeof name !== "string" || name.length === 0) return { status: 400, body: { error: "bad request" } };
  const tournament = { id: id(), name, players: [], rounds: [] };
  tournaments.set(tournament.id, tournament);
  return { status: 200, body: publicTournament(tournament) };
}

export function listTournaments() {
  return { tournaments: [...tournaments.values()].map((tournament) => ({ id: tournament.id, name: tournament.name })) };
}

export function getTournament(tournamentId) {
  const tournament = tournaments.get(tournamentId);
  if (!tournament) return { status: 404, body: { error: "not found" } };
  return { status: 200, body: publicTournament(tournament) };
}

export function addPlayer(tournamentId, name) {
  const tournament = tournaments.get(tournamentId);
  if (!tournament) return { status: 404, body: { error: "not found" } };
  if (tournament.rounds.length > 0 || typeof name !== "string" || name.length === 0) {
    return { status: 400, body: { error: "bad request" } };
  }
  if (tournament.players.some((entry) => entry.name === name)) {
    return { status: 400, body: { error: "bad request" } };
  }
  tournament.players.push({ name, score: 0 });
  return { status: 200, body: publicTournament(tournament) };
}

export function startTournament(tournamentId) {
  const tournament = tournaments.get(tournamentId);
  if (!tournament) return { status: 404, body: { error: "not found" } };
  if (tournament.rounds.length > 0 || tournament.players.length < 2 || tournament.players.length % 2 !== 0) {
    return { status: 400, body: { error: "bad request" } };
  }
  tournament.rounds.push({ round: 1, pairings: pairPlayers(tournament, 1) });
  return { status: 200, body: publicTournament(tournament) };
}

export function recordResult(tournamentId, roundNumber, white, black, result) {
  const tournament = tournaments.get(tournamentId);
  if (!tournament) return { status: 404, body: { error: "not found" } };
  if (result !== "1-0" && result !== "0-1" && result !== "1/2-1/2") {
    return { status: 400, body: { error: "bad request" } };
  }
  const round = tournament.rounds.find((entry) => entry.round === roundNumber);
  const pairing = round?.pairings.find((entry) => entry.white === white && entry.black === black);
  if (!pairing || pairing.result !== null) return { status: 400, body: { error: "bad request" } };
  applyResult(tournament, pairing, result);
  return { status: 200, body: publicTournament(tournament) };
}

export function nextRound(tournamentId) {
  const tournament = tournaments.get(tournamentId);
  if (!tournament) return { status: 404, body: { error: "not found" } };
  const current = tournament.rounds[tournament.rounds.length - 1];
  if (!current || current.pairings.some((pairing) => pairing.result === null)) {
    return { status: 400, body: { error: "bad request" } };
  }
  const roundNumber = current.round + 1;
  tournament.rounds.push({ round: roundNumber, pairings: pairPlayers(tournament, roundNumber) });
  return { status: 200, body: publicTournament(tournament) };
}
