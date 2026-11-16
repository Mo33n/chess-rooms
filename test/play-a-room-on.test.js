import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { POLL_MS, mount, squaresFromFen } from "../public/play.js";

const START_PLACEMENT = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
const MATE = [
  ["e2", "e4"],
  ["e7", "e5"],
  ["d1", "h5"],
  ["b8", "c6"],
  ["f1", "c4"],
  ["g8", "f6"],
  ["h5", "f7"],
];

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

function el() {
  return {
    textContent: "",
    value: "",
    dataset: {},
    children: [],
    listeners: { click: [] },
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
    },
    addEventListener(type, fn) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(fn);
    },
    click() {
      for (const fn of this.listeners.click || []) fn();
    },
  };
}

function page() {
  const nodes = { rooms: el(), board: el(), tournaments: el() };
  const input = el();
  const buttons = {
    open: el(),
    "sit-white": el(),
    "sit-black": el(),
  };
  const doc = {
    input,
    buttons,
    getElementById(id) {
      return nodes[id] || null;
    },
    querySelector(selector) {
      if (selector === "input[type='text']") return input;
      const action = selector.match(/data-action='([^']+)'/)?.[1];
      return buttons[action] || null;
    },
    createElement() {
      return el();
    },
  };
  return doc;
}

function boardText(doc) {
  const parts = [];
  function walk(node) {
    if (node.textContent) parts.push(node.textContent);
    if (node.dataset?.square) parts.push(node.dataset.square);
    for (const child of node.children || []) walk(child);
  }
  walk(doc.getElementById("board"));
  return parts.join(" ");
}

function roomButtons(doc) {
  return doc.getElementById("rooms").children;
}

function clickSquare(doc, square) {
  const found = [];
  function walk(node) {
    if (node.dataset?.square === square) found.push(node);
    for (const child of node.children || []) walk(child);
  }
  walk(doc.getElementById("board"));
  assert.equal(found.length > 0, true, square);
  found[0].click();
}

async function until(read) {
  const deadline = Date.now() + 2000;
  let last = "";
  while (Date.now() < deadline) {
    last = read() || "";
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`timed out: ${last}`);
}

function trackedFetch(inner = fetch) {
  const calls = [];
  return {
    calls,
    async fetch(url, init) {
      const req = init?.body ? JSON.parse(init.body) : null;
      const response = await inner(url, init);
      const text = await response.clone().text();
      calls.push({ url: String(url), method: init?.method || "GET", req, status: response.status, text });
      return response;
    },
  };
}

function session(doc, base, timers, fetchImpl = fetch) {
  const handle = mount(doc, {
    base,
    fetch: fetchImpl,
    setInterval(fn, ms) {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearInterval(id) {
      if (id) timers[id - 1] = null;
    },
  });
  return handle;
}

async function openAndSit(doc, roomName, seatName, color) {
  doc.input.value = roomName;
  doc.buttons.open.click();
  await until(() => roomButtons(doc).some((button) => button.textContent === roomName) && "listed");
  const button = roomButtons(doc).find((item) => item.textContent === roomName);
  button.click();
  doc.input.value = seatName;
  doc.buttons[color === "white" ? "sit-white" : "sit-black"].click();
  await until(() => boardText(doc).includes(seatName) && "seated");
}

test("poll delay is 1500 and a non-position fen is still painted", () => {
  assert.equal(POLL_MS, 1500);
  const odd = "qqqqqqqq/8/8/8/8/8/8/4k1K";
  const squares = squaresFromFen(`${odd} w - - 0 1`);
  assert.equal(squares[0].piece, "q");
  assert.equal(squares.filter((cell) => cell.piece === "q").length, 8);
  assert.equal(squares.at(-1).square, "h1");
  assert.equal(squares.at(-2).piece, "K");
  assert.equal(squares.at(-4).piece, "k");

  const doc = page();
  const timers = [];
  session(doc, "", timers, async (url, init) => {
    if (String(url) === "/api/rooms" && init?.method === "POST") {
      return Response.json({
        id: "room-odd",
        name: "Odd",
        moves: [],
        status: "playing",
        winner: null,
        fen: `${odd} w - - 0 1`,
      });
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  });
  doc.input.value = "Odd";
  doc.buttons.open.click();
  return until(() => boardText(doc).includes(odd) && boardText(doc));
});

test("the page is the room board and tournaments stays empty", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const pageRes = await fetch(`http://127.0.0.1:${server.port}/`);
  const html = await pageRes.text();
  assert.equal(pageRes.headers.get("content-type")?.includes("text/html"), true);
  for (const id of ["rooms", "board", "tournaments"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /<input[^>]*type="text"/);
  assert.match(html, /<button/);
  assert.match(html, /<div id="tournaments"><\/div>/);
  const script = await fetch(`http://127.0.0.1:${server.port}/play.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type") || "", /javascript/);
  assert.match(await script.text(), /export const POLL_MS = 1500/);
});

test("two rooms stay apart on the board", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const base = `http://127.0.0.1:${server.port}`;
  const doc = page();
  const timers = [];
  session(doc, base, timers);
  assert.equal(timers.every((timer) => timer == null || timer.ms === POLL_MS), true);
  await openAndSit(doc, "Club", "Ada", "white");
  doc.input.value = "Bea";
  doc.buttons["sit-black"].click();
  await until(() => boardText(doc).includes("Bea") && "black-sat");
  clickSquare(doc, "e2");
  clickSquare(doc, "e4");
  await until(() => boardText(doc).includes("e2e4") && boardText(doc));

  doc.input.value = "Lounge";
  doc.buttons.open.click();
  await until(() => roomButtons(doc).some((button) => button.textContent === "Lounge") && boardText(doc).includes(START_PLACEMENT) && "lounge");
  const lounge = boardText(doc);
  assert.equal(lounge.includes("e2e4"), false);
  assert.match(lounge, new RegExp(START_PLACEMENT));

  roomButtons(doc).find((button) => button.textContent === "Club").click();
  const club = boardText(doc);
  assert.match(club, /e2e4/);
  assert.match(club, /4P3/);
  assert.equal(timers.every((timer) => timer == null || timer.ms === 1500), true);
});

test("two sessions play, poll, and show seat and move errors", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const base = `http://127.0.0.1:${server.port}`;
  let shared = null;
  const whiteTrack = trackedFetch(async (url, init) => {
    const response = await fetch(url, init);
    if (String(url).endsWith("/api/rooms") && init?.method === "POST") shared = await response.clone().json();
    return response;
  });
  const blackTrack = trackedFetch(async (url, init) => {
    if (String(url).endsWith("/api/rooms") && init?.method === "POST") {
      return Response.json(shared);
    }
    return fetch(url, init);
  });
  const whiteDoc = page();
  const blackDoc = page();
  const whiteTimers = [];
  const blackTimers = [];
  session(whiteDoc, base, whiteTimers, whiteTrack.fetch);
  session(blackDoc, base, blackTimers, blackTrack.fetch);

  await openAndSit(whiteDoc, "Club", "Ada", "white");
  blackDoc.input.value = "Club";
  blackDoc.buttons.open.click();
  await until(() => roomButtons(blackDoc).some((button) => button.textContent === "Club") && "black-room");
  blackDoc.input.value = "Bea";
  blackDoc.buttons["sit-black"].click();
  await until(() => boardText(blackDoc).includes("Bea") && "black-sat");

  clickSquare(whiteDoc, "e2");
  clickSquare(whiteDoc, "e4");
  await until(() => boardText(whiteDoc).includes("e2e4") && "white-move");
  const posted = whiteTrack.calls.find((call) => call.url.endsWith("/move") && call.req?.uci === "e2e4");
  const joined = whiteTrack.calls.find((call) => call.url.endsWith("/join") && call.req?.color === "white");
  assert.equal(posted.req.token, JSON.parse(joined.text).token);

  const before = boardText(blackDoc);
  assert.equal(before.includes("e2e4"), false);
  const poll = blackTimers.filter(Boolean).at(-1);
  assert.equal(poll.ms, 1500);
  await poll.fn();
  const seen = boardText(blackDoc);
  assert.match(seen, /e2e4/);
  assert.match(seen, /4P3/);

  for (let index = 1; index < MATE.length; index++) {
    const doc = index % 2 === 0 ? whiteDoc : blackDoc;
    const [from, to] = MATE[index];
    clickSquare(doc, from);
    clickSquare(doc, to);
    await until(() => boardText(doc).includes(from + to) && "ply");
  }
  const finished = boardText(whiteDoc);
  assert.match(finished, /checkmate/);
  assert.match(finished, /white/);

  const other = page();
  const otherTimers = [];
  session(other, base, otherTimers);
  await openAndSit(other, "Spare", "Ada", "white");
  clickSquare(other, "a1");
  clickSquare(other, "a2");
  await until(() => boardText(other).includes("That move is not legal.") && "illegal");

  other.input.value = "Cal";
  other.buttons["sit-white"].click();
  await until(() => boardText(other).includes("That seat is already taken.") && "taken");

  const gone = page();
  const goneTimers = [];
  let missing = false;
  const handle = session(gone, "", goneTimers, async (url, init) => {
    if (String(url) === "/api/rooms" && init?.method === "POST") {
      return Response.json({
        id: "room-gone",
        name: "Gone",
        moves: [],
        status: "playing",
        winner: null,
        fen: `${START_PLACEMENT} w KQkq - 0 1`,
      });
    }
    if (missing) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    return Response.json({
      id: "room-gone",
      name: "Gone",
      moves: [],
      status: "playing",
      winner: null,
      fen: `${START_PLACEMENT} w KQkq - 0 1`,
    });
  });
  gone.input.value = "Gone";
  gone.buttons.open.click();
  await until(() => roomButtons(gone).some((button) => button.textContent === "Gone") && "gone");
  missing = true;
  await handle.poll();
  assert.equal(roomButtons(gone).length, 0);
  assert.equal(boardText(gone), "");
  assert.equal(gone.getElementById("tournaments").children.length, 0);
});
