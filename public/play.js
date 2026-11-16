export const POLL_MS = 1500;

const FILES = "abcdefgh";

export function placementOf(fen) {
  return String(fen || "").split(" ")[0];
}

export function sideToMove(fen) {
  return String(fen || "").split(" ")[1] === "b" ? "black" : "white";
}

export function squaresFromFen(fen) {
  const ranks = placementOf(fen).split("/");
  const squares = [];
  for (let rankIndex = 0; rankIndex < 8; rankIndex++) {
    const rank = 8 - rankIndex;
    let file = 0;
    for (const char of ranks[rankIndex] || "") {
      if (char >= "1" && char <= "8") {
        const empty = Number(char);
        for (let step = 0; step < empty; step++) {
          squares.push({ square: FILES[file] + rank, piece: "" });
          file += 1;
        }
      } else if (file < 8) {
        squares.push({ square: FILES[file] + rank, piece: char });
        file += 1;
      }
    }
    while (file < 8) {
      squares.push({ square: FILES[file] + rank, piece: "" });
      file += 1;
    }
  }
  return squares;
}

export function mount(doc, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch.bind(globalThis);
  const setIntervalImpl = options.setInterval || globalThis.setInterval.bind(globalThis);
  const clearIntervalImpl = options.clearInterval || globalThis.clearInterval.bind(globalThis);
  const base = options.base || "";
  const roomsEl = doc.getElementById("rooms");
  const boardEl = doc.getElementById("board");
  const tournamentsEl = doc.getElementById("tournaments");
  const nameInput = doc.querySelector("input[type='text']");
  const openButton = doc.querySelector("[data-action='open']");
  const whiteButton = doc.querySelector("[data-action='sit-white']");
  const blackButton = doc.querySelector("[data-action='sit-black']");
  const tournamentNameInput = doc.getElementById("tournament-name");
  const playerNameInput = doc.getElementById("player-name");
  const hostButton = doc.querySelector("[data-action='host']");
  const addPlayerButton = doc.querySelector("[data-action='add-player']");
  const startButton = doc.querySelector("[data-action='start-tournament']");
  const nextButton = doc.querySelector("[data-action='next-round']");

  const known = new Map();
  const tokens = new Map();
  const listed = new Map();
  let chosen = null;
  let armed = null;
  let pollTimer = null;
  let tournamentTimer = null;
  let tournamentId = null;
  let error = "";
  let tournamentError = "";

  function request(path, init) {
    return fetchImpl(base + path, init);
  }

  function held(id) {
    return tokens.get(id) || {};
  }

  function tokenFor(room) {
    const seats = held(room.id);
    const side = sideToMove(room.fen);
    if (seats[side]) return seats[side];
    return seats.white || seats.black || "";
  }

  function stopPoll() {
    if (pollTimer != null) clearIntervalImpl(pollTimer);
    pollTimer = null;
  }

  function startPoll() {
    stopPoll();
    if (!chosen) return;
    pollTimer = setIntervalImpl(() => poll().catch((err) => showError(err.message)), POLL_MS);
  }

  function stopTournamentPoll() {
    if (tournamentTimer != null) clearIntervalImpl(tournamentTimer);
    tournamentTimer = null;
  }

  function startTournamentPoll() {
    stopTournamentPoll();
    if (!tournamentId) return;
    tournamentTimer = setIntervalImpl(() => pollTournament().catch((err) => showTournamentError(err.message)), POLL_MS);
  }

  function showError(message) {
    error = message || "";
    paint();
  }

  function showTournamentError(message) {
    tournamentError = message || "";
    paint();
  }

  function paint() {
    roomsEl.replaceChildren();
    for (const room of known.values()) {
      const button = doc.createElement("button");
      button.type = "button";
      button.textContent = room.name;
      button.dataset.roomId = room.id;
      button.addEventListener("click", () => choose(room.id));
      roomsEl.append(button);
    }

    boardEl.replaceChildren();
    const room = chosen && known.get(chosen);
    if (!room) {
      if (error) {
        const note = doc.createElement("p");
        note.textContent = error;
        boardEl.append(note);
      }
    } else {
      const status = doc.createElement("p");
      status.textContent = room.status;
      const winner = doc.createElement("p");
      winner.textContent = room.winner == null ? "" : room.winner;
      const seats = doc.createElement("p");
      seats.textContent = [room.white, room.black].filter(Boolean).join(" ");
      const moves = doc.createElement("p");
      moves.dataset.role = "moves";
      moves.textContent = room.moves.join(" ");
      const fen = doc.createElement("p");
      fen.dataset.role = "fen";
      fen.textContent = placementOf(room.fen);
      const grid = doc.createElement("div");
      grid.style.display = "grid";
      grid.style.gridTemplateColumns = "repeat(8, minmax(0, 1fr))";
      for (const cell of squaresFromFen(room.fen)) {
        const square = doc.createElement("button");
        square.type = "button";
        square.dataset.square = cell.square;
        square.setAttribute("aria-label", cell.square);
        square.style.minWidth = "0";
        square.style.width = "100%";
        square.textContent = cell.piece;
        square.addEventListener("click", () => onSquare(cell.square));
        grid.append(square);
      }
      const note = doc.createElement("p");
      note.textContent = error;
      boardEl.append(status, winner, seats, moves, fen, grid, note);
    }

    if (!tournamentsEl) return;
    tournamentsEl.replaceChildren();
    for (const tournament of listed.values()) {
      const button = doc.createElement("button");
      button.type = "button";
      button.textContent = tournament.name;
      button.dataset.tournamentId = tournament.id;
      button.addEventListener("click", () => selectTournament(tournament.id));
      tournamentsEl.append(button);
      if (tournament.id !== tournamentId) continue;
      for (const player of tournament.players) {
        const name = doc.createElement("p");
        name.textContent = player.name;
        tournamentsEl.append(name);
      }
      tournament.rounds.forEach((round, index) => {
        for (const pairing of round.pairings) {
          const label = `${pairing.white} ${pairing.black}`;
          const white = doc.createElement("span");
          white.textContent = `${pairing.white} `;
          const black = doc.createElement("span");
          black.textContent = `${pairing.black} `;
          const roomId = doc.createElement("span");
          roomId.textContent = `${pairing.roomId} `;
          const result = doc.createElement("span");
          result.dataset.role = "result";
          result.textContent = pairing.result == null ? "" : pairing.result;
          const open = doc.createElement("button");
          open.type = "button";
          open.textContent = "Open";
          open.setAttribute("aria-label", `Open ${label}`);
          open.addEventListener("click", () => {
            openPairing(pairing).catch((err) => showTournamentError(err.message));
          });
          tournamentsEl.append(white, black, roomId, result, open);
          if (!pairing.result) {
            const draw = doc.createElement("button");
            draw.type = "button";
            draw.textContent = "Draw";
            draw.setAttribute("aria-label", `Draw ${label}`);
            draw.addEventListener("click", () => {
              recordDraw(index + 1, pairing).catch((err) => showTournamentError(err.message));
            });
            tournamentsEl.append(draw);
          }
        }
      });
    }
    if (tournamentError) {
      const note = doc.createElement("p");
      note.textContent = tournamentError;
      tournamentsEl.append(note);
    }
  }

  function remember(room) {
    known.set(room.id, {
      id: room.id,
      name: room.name,
      moves: room.moves.slice(),
      status: room.status,
      winner: room.winner,
      fen: room.fen,
      white: room.white ?? null,
      black: room.black ?? null,
    });
  }

  function rememberTournament(body) {
    listed.set(body.id, body);
    tournamentId = body.id;
    tournamentError = "";
    startTournamentPoll();
  }

  function selectTournament(id) {
    tournamentId = id;
    tournamentError = "";
    paint();
    startTournamentPoll();
  }

  async function readBody(response) {
    const text = await response.text();
    if (!text) return {};
    return JSON.parse(text);
  }

  async function openRoom() {
    const response = await request("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: nameInput.value }),
    });
    const body = await readBody(response);
    if (!response.ok) {
      showError(body.error || "");
      return;
    }
    error = "";
    remember(body);
    choose(body.id);
  }

  function choose(id) {
    chosen = id;
    armed = null;
    error = "";
    paint();
    startPoll();
  }

  async function sit(color, seatName = nameInput.value, roomId = chosen) {
    if (!roomId) {
      showError("Choose a room before sitting.");
      return null;
    }
    const response = await request(`/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: seatName, color }),
    });
    const body = await readBody(response);
    if (!response.ok) {
      showError(body.error || "");
      return null;
    }
    const seats = held(roomId);
    seats[color] = body.token;
    tokens.set(roomId, seats);
    error = "";
    remember(body.room);
    return body;
  }

  async function onSquare(square) {
    const room = chosen && known.get(chosen);
    if (!room) return;
    if (!armed) {
      armed = square;
      return;
    }
    const uci = armed + square;
    armed = null;
    const response = await request(`/api/rooms/${room.id}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: tokenFor(room), uci }),
    });
    const body = await readBody(response);
    if (!response.ok) {
      showError(body.error || "");
      return;
    }
    error = "";
    remember(body);
    paint();
    await pollTournament();
  }

  function drop(id) {
    known.delete(id);
    tokens.delete(id);
    if (chosen === id) {
      chosen = null;
      armed = null;
      stopPoll();
    }
    error = "";
    paint();
  }

  function dropTournament(id) {
    listed.delete(id);
    if (tournamentId === id) {
      tournamentId = null;
      stopTournamentPoll();
    }
    tournamentError = "";
    paint();
  }

  async function poll() {
    if (!chosen) return;
    const id = chosen;
    const response = await request(`/api/rooms/${id}`);
    if (response.status === 404) {
      drop(id);
      return;
    }
    const body = await readBody(response);
    if (!response.ok) {
      showError(body.error || "");
      return;
    }
    remember(body);
    paint();
  }

  async function pollTournament() {
    if (!tournamentId) return;
    const id = tournamentId;
    const response = await request(`/api/tournaments/${id}`);
    if (response.status === 404) {
      dropTournament(id);
      return;
    }
    const body = await readBody(response);
    if (!response.ok) {
      showTournamentError(body.error || "");
      return;
    }
    rememberTournament(body);
    paint();
  }

  async function hostTournament() {
    const response = await request("/api/tournaments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: tournamentNameInput.value }),
    });
    const body = await readBody(response);
    if (response.status === 404) {
      dropTournament(tournamentId);
      return;
    }
    if (!response.ok) {
      showTournamentError(body.error || "");
      return;
    }
    rememberTournament(body);
    paint();
  }

  async function addPlayer() {
    if (!tournamentId) {
      showTournamentError("Host a tournament before adding a player.");
      return;
    }
    const response = await request(`/api/tournaments/${tournamentId}/players`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: playerNameInput.value }),
    });
    const body = await readBody(response);
    if (response.status === 404) {
      dropTournament(tournamentId);
      return;
    }
    if (!response.ok) {
      showTournamentError(body.error || "");
      return;
    }
    rememberTournament(body);
    paint();
  }

  async function startTournament() {
    if (!tournamentId) {
      showTournamentError("Host a tournament before starting.");
      return;
    }
    const response = await request(`/api/tournaments/${tournamentId}/start`, { method: "POST" });
    const body = await readBody(response);
    if (response.status === 404) {
      dropTournament(tournamentId);
      return;
    }
    if (!response.ok) {
      showTournamentError(body.error || "");
      return;
    }
    rememberTournament(body);
    paint();
  }

  async function openPairing(pairing) {
    const white = await sit("white", pairing.white, pairing.roomId);
    if (!white) return;
    const black = await sit("black", pairing.black, pairing.roomId);
    if (!black) return;
    choose(pairing.roomId);
  }

  async function recordDraw(round, pairing) {
    if (!tournamentId) return;
    const response = await request(`/api/tournaments/${tournamentId}/results`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        round,
        white: pairing.white,
        black: pairing.black,
        result: "1/2-1/2",
      }),
    });
    const body = await readBody(response);
    if (response.status === 404) {
      dropTournament(tournamentId);
      return;
    }
    if (!response.ok) {
      showTournamentError(body.error || "");
      return;
    }
    rememberTournament(body);
    if (known.has(pairing.roomId)) {
      const roomResponse = await request(`/api/rooms/${pairing.roomId}`);
      const room = await readBody(roomResponse);
      if (roomResponse.ok) remember(room);
    }
    paint();
  }

  async function nextRound() {
    if (!tournamentId) {
      showTournamentError("Host a tournament before the next round.");
      return;
    }
    const response = await request(`/api/tournaments/${tournamentId}/next`, { method: "POST" });
    const body = await readBody(response);
    if (response.status === 404) {
      dropTournament(tournamentId);
      return;
    }
    if (!response.ok) {
      showTournamentError(body.error || "");
      return;
    }
    rememberTournament(body);
    paint();
  }

  openButton.addEventListener("click", () => {
    openRoom().catch((err) => showError(err.message));
  });
  whiteButton.addEventListener("click", () => {
    sit("white").then((body) => {
      if (body) paint();
    }).catch((err) => showError(err.message));
  });
  blackButton.addEventListener("click", () => {
    sit("black").then((body) => {
      if (body) paint();
    }).catch((err) => showError(err.message));
  });
  if (hostButton) {
    hostButton.addEventListener("click", () => {
      hostTournament().catch((err) => showTournamentError(err.message));
    });
  }
  if (addPlayerButton) {
    addPlayerButton.addEventListener("click", () => {
      addPlayer().catch((err) => showTournamentError(err.message));
    });
  }
  if (startButton) {
    startButton.addEventListener("click", () => {
      startTournament().catch((err) => showTournamentError(err.message));
    });
  }
  if (nextButton) {
    nextButton.addEventListener("click", () => {
      nextRound().catch((err) => showTournamentError(err.message));
    });
  }

  return { poll, drop, pollTournament };
}

if (typeof document !== "undefined") mount(document);
