import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

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

function element(registry) {
  const node = {
    textContent: "",
    value: "",
    type: "",
    tagName: "",
    dataset: {},
    children: [],
    listeners: {},
    focus() {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren() {
      this.children = [];
    },
  };
  let idValue = "";
  Object.defineProperty(node, "id", {
    enumerable: true,
    get() {
      return idValue;
    },
    set(value) {
      idValue = String(value);
      registry[idValue] = node;
    },
  });
  return node;
}

function loadPage(html, port, intervals) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const elements = {};
  const document = {
    getElementById(id) {
      if (!elements[id]) elements[id] = element(elements);
      return elements[id];
    },
    createElement(tag) {
      const node = element(elements);
      node.tagName = tag.toUpperCase();
      return node;
    },
  };
  const context = {
    document,
    fetch: (path, options) => fetch(`http://127.0.0.1:${port}${path}`, options),
    setInterval(...args) {
      intervals.push(args[1]);
      return 1;
    },
  };
  vm.runInNewContext(script, context);
  return { context, elements };
}

function ranksOf(page) {
  return page.elements.position.children.map((row) => row.children.map((square) => square.textContent).join(""));
}

function boardText(node) {
  let text = "";
  if (!node.children || node.children.length === 0) text += node.textContent || "";
  for (const child of node.children || []) text += boardText(child);
  return text;
}

async function openNamed(page, name) {
  await page.context.refreshRooms();
  await page.elements["room-list"].children.find((row) => row.textContent === name).listeners.click();
}

async function sitColor(page, color, name) {
  page.elements[color + "-name"].value = name;
  return page.elements["sit-" + color].listeners.submit({ preventDefault() {} });
}

async function submitMove(page, uci) {
  page.elements.uci.value = uci;
  return page.elements["move-form"].listeners.submit({ preventDefault() {} });
}

const drawMoves = ["e2e3", "a7a5", "d1h5", "a8a6", "h5a5", "h7h5", "a5c7", "a6h6", "h2h4", "f7f6", "c7d7", "e8f7", "d7b7", "d8d3", "b7b8", "d3h7", "b8c8", "f7g6", "c8e6"];

test("the open board draws position, status, and a polled move", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const { port } = server;
  const page = await fetch(`http://127.0.0.1:${port}/`);
  const html = await page.text();
  for (const id of ["rooms", "board", "tournaments"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  const poll = html.match(/const POLL_MS = (\d+)/);
  assert.ok(poll);
  assert.ok(Number(poll[1]) > 0 && Number(poll[1]) < 2000);

  const intervals = [];
  const whitePage = loadPage(html, port, intervals);
  const blackPage = loadPage(html, port, intervals);
  const watcher = loadPage(html, port, intervals);
  assert.ok(intervals.length >= 1);
  assert.ok(intervals.every((ms) => ms < 2000));

  whitePage.context.document.getElementById("room-name").value = "Live";
  await whitePage.context.createRoom("Live");
  await openNamed(whitePage, "Live");
  await openNamed(blackPage, "Live");
  await openNamed(watcher, "Live");
  await sitColor(whitePage, "white", "Ada");
  await sitColor(blackPage, "black", "Bea");

  const moved = await submitMove(whitePage, "e2e4");
  assert.equal(moved.status, 200);
  assert.equal(moved.body.position[4][4], "P");
  const drawn = ranksOf(whitePage);
  assert.equal(drawn[0], moved.body.position[0]);
  assert.equal(drawn[7], moved.body.position[7]);
  assert.equal(drawn[4][4], "P");
  assert.deepEqual(drawn, moved.body.position);

  assert.equal(ranksOf(watcher)[4][4], ".");
  const polled = await watcher.context.refreshOpen();
  assert.deepEqual(ranksOf(watcher), polled.position);
  assert.equal(ranksOf(watcher)[4][4], "P");

  await submitMove(blackPage, "e7e5");
  await submitMove(whitePage, "d1h5");
  await submitMove(blackPage, "b8c6");
  const prefix = await submitMove(whitePage, "f1c4");
  assert.equal(prefix.body.status, "playing");
  assert.equal(prefix.body.check, false);
  assert.doesNotMatch(boardText(whitePage.elements.board), /\bcheck\b/);

  const checkRoom = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "Check" }) });
  const checkWhite = loadPage(html, port, intervals);
  const checkBlack = loadPage(html, port, intervals);
  await openNamed(checkWhite, "Check");
  await openNamed(checkBlack, "Check");
  await sitColor(checkWhite, "white", "Ada");
  await sitColor(checkBlack, "black", "Bea");
  await submitMove(checkWhite, "e2e4");
  await submitMove(checkBlack, "f7f5");
  const inCheck = await submitMove(checkWhite, "d1h5");
  assert.equal(inCheck.body.status, "playing");
  assert.equal(inCheck.body.check, true);
  assert.match(boardText(checkWhite.elements.board), /\bcheck\b/);
  assert.equal(checkRoom.status, 200);

  await submitMove(blackPage, "g8f6");
  const mate = await submitMove(whitePage, "h5f7");
  assert.equal(mate.body.status, "checkmate");
  assert.equal(mate.body.winner, "white");
  const mateText = boardText(whitePage.elements.board);
  assert.match(mateText, /checkmate/);
  assert.match(mateText, /\bwhite\b/);
  assert.doesNotMatch(mateText, /\bcheck\b/);

  const drawRoom = await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "Draw" }) });
  const whiteToken = (await api(port, `/api/rooms/${drawRoom.body.id}/join`, {
    method: "POST", body: JSON.stringify({ name: "Ada", color: "white" }),
  })).body.token;
  const blackToken = (await api(port, `/api/rooms/${drawRoom.body.id}/join`, {
    method: "POST", body: JSON.stringify({ name: "Bea", color: "black" }),
  })).body.token;
  let finished = null;
  for (let i = 0; i < drawMoves.length; i++) {
    finished = await api(port, `/api/rooms/${drawRoom.body.id}/move`, {
      method: "POST", body: JSON.stringify({ token: i % 2 === 0 ? whiteToken : blackToken, uci: drawMoves[i] }),
    });
    assert.equal(finished.status, 200, drawMoves[i]);
  }
  assert.equal(finished.body.status, "stalemate");
  assert.equal(finished.body.winner, null);
  const drawPage = loadPage(html, port, intervals);
  await openNamed(drawPage, "Draw");
  const drawText = boardText(drawPage.elements.board);
  assert.match(drawText, /stalemate/);
  assert.doesNotMatch(drawText, /winner: white/);
  assert.doesNotMatch(drawText, /winner: black/);

  const castleWhite = loadPage(html, port, intervals);
  const castleBlack = loadPage(html, port, intervals);
  await castleWhite.context.createRoom("Castle");
  await openNamed(castleWhite, "Castle");
  await openNamed(castleBlack, "Castle");
  await sitColor(castleWhite, "white", "Ada");
  await sitColor(castleBlack, "black", "Bea");
  const castleLine = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5", "e1g1"];
  let castleLast = null;
  for (let i = 0; i < castleLine.length; i++) {
    castleLast = await submitMove(i % 2 === 0 ? castleWhite : castleBlack, castleLine[i]);
  }
  assert.deepEqual(ranksOf(castleWhite), castleLast.body.position);
  assert.equal(ranksOf(castleWhite)[7][6], "K");
  assert.equal(ranksOf(castleWhite)[7][5], "R");

  const epWhite = loadPage(html, port, intervals);
  const epBlack = loadPage(html, port, intervals);
  await epWhite.context.createRoom("Pass");
  await openNamed(epWhite, "Pass");
  await openNamed(epBlack, "Pass");
  await sitColor(epWhite, "white", "Ada");
  await sitColor(epBlack, "black", "Bea");
  const epLine = ["e2e4", "a7a6", "e4e5", "d7d5", "e5d6"];
  let epLast = null;
  for (let i = 0; i < epLine.length; i++) {
    epLast = await submitMove(i % 2 === 0 ? epWhite : epBlack, epLine[i]);
  }
  assert.deepEqual(ranksOf(epWhite), epLast.body.position);
  assert.equal(ranksOf(epWhite)[2][3], "P");
  assert.equal(ranksOf(epWhite)[3][3], ".");

  const promoWhite = loadPage(html, port, intervals);
  const promoBlack = loadPage(html, port, intervals);
  await promoWhite.context.createRoom("Promo");
  await openNamed(promoWhite, "Promo");
  await openNamed(promoBlack, "Promo");
  await sitColor(promoWhite, "white", "Ada");
  await sitColor(promoBlack, "black", "Bea");
  const promoLine = ["h2h4", "a7a5", "h4h5", "a5a4", "h5h6", "a4a3", "h6g7", "a3b2", "g7h8q"];
  let promoLast = null;
  for (let i = 0; i < promoLine.length; i++) {
    promoLast = await submitMove(i % 2 === 0 ? promoWhite : promoBlack, promoLine[i]);
  }
  assert.deepEqual(ranksOf(promoWhite), promoLast.body.position);
  assert.equal(ranksOf(promoWhite)[0][7], "Q");

  const mateRanks = ranksOf(whitePage);
  const afterMate = await submitMove(whitePage, "a2a3");
  assert.equal(afterMate.status, 400);
  assert.notEqual(whitePage.elements["seat-error"].textContent, "");
  assert.deepEqual(ranksOf(whitePage), mateRanks);

  const startWhite = loadPage(html, port, intervals);
  const startBlack = loadPage(html, port, intervals);
  await startWhite.context.createRoom("Start");
  await openNamed(startWhite, "Start");
  await openNamed(startBlack, "Start");
  await sitColor(startWhite, "white", "Ada");
  await sitColor(startBlack, "black", "Bea");
  const startRanks = ranksOf(startWhite);
  const illegal = await submitMove(startWhite, "e2e5");
  assert.equal(illegal.status, 400);
  assert.notEqual(startWhite.elements["seat-error"].textContent, "");
  assert.deepEqual(ranksOf(startWhite), startRanks);

  const roomB = loadPage(html, port, intervals);
  await roomB.context.createRoom("Other");
  await openNamed(roomB, "Other");
  await sitColor(roomB, "white", "Ada");
  await sitColor(roomB, "black", "Bea");
  const other = await roomB.context.refreshOpen();
  assert.equal(other.position[4][4], ".");
  assert.deepEqual(ranksOf(roomB), other.position);
  assert.notEqual(ranksOf(roomB)[4][4], "P");

  const hostile = "<img src=x onerror=alert(1)>";
  await api(port, "/api/rooms", { method: "POST", body: JSON.stringify({ name: hostile }) });
  const hostilePage = loadPage(html, port, intervals);
  await openNamed(hostilePage, hostile);
  await sitColor(hostilePage, "white", hostile);
  assert.equal(hostilePage.elements["open-room-name"].textContent, hostile);
  assert.equal(hostilePage.elements["seat-white"].textContent, "White: " + hostile);
  assert.equal(hostilePage.elements["open-room-name"].children.length, 0);
  assert.equal(hostilePage.elements["seat-white"].children.length, 0);
  assert.equal(hostilePage.elements["open-room-name"].tagName, "P");
});
