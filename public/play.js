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
  const nameInput = doc.querySelector("input[type='text']");
  const openButton = doc.querySelector("[data-action='open']");
  const whiteButton = doc.querySelector("[data-action='sit-white']");
  const blackButton = doc.querySelector("[data-action='sit-black']");

  const known = new Map();
  const tokens = new Map();
  let chosen = null;
  let armed = null;
  let pollTimer = null;
  let error = "";

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

  function showError(message) {
    error = message || "";
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
    if (!room) return;

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
    for (const cell of squaresFromFen(room.fen)) {
      const square = doc.createElement("button");
      square.type = "button";
      square.dataset.square = cell.square;
      square.textContent = cell.piece;
      square.addEventListener("click", () => onSquare(cell.square));
      grid.append(square);
    }
    const note = doc.createElement("p");
    note.textContent = error;
    boardEl.append(status, winner, seats, moves, fen, grid, note);
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

  async function sit(color) {
    if (!chosen) return;
    const response = await request(`/api/rooms/${chosen}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: nameInput.value, color }),
    });
    const body = await readBody(response);
    if (!response.ok) {
      showError(body.error || "");
      return;
    }
    const seats = held(chosen);
    seats[color] = body.token;
    tokens.set(chosen, seats);
    error = "";
    remember(body.room);
    paint();
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
    error = "";
    remember(body);
    paint();
  }

  openButton.addEventListener("click", () => {
    openRoom().catch((err) => showError(err.message));
  });
  whiteButton.addEventListener("click", () => {
    sit("white").catch((err) => showError(err.message));
  });
  blackButton.addEventListener("click", () => {
    sit("black").catch((err) => showError(err.message));
  });

  return { poll, drop };
}

if (typeof document !== "undefined") mount(document);
