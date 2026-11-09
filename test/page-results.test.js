import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SCHOLAR = ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"];
const STALEMATE = ["e2e3", "a7a5", "d1h5", "a8a6", "h5a5", "h7h5", "a5c7", "a6h6", "h2h4", "f7f6", "c7d7", "e8f7", "d7b7", "d8d3", "b7b8", "d3h7", "b8c8", "f7g6", "c8e6"];

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

function loadPage(html, port) {
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
    setInterval() {
      return 1;
    },
  };
  vm.runInNewContext(script, context);
  return { context, elements };
}

function textOf(node) {
  let text = node.textContent || "";
  for (const child of node.children || []) text += " " + textOf(child);
  return text;
}

function buttons(node, found = []) {
  if (node.tagName === "BUTTON") found.push(node);
  for (const child of node.children || []) buttons(child, found);
  return found;
}

async function pageHtml(port) {
  const page = await fetch(`http://127.0.0.1:${port}/`);
  return page.text();
}

async function api(port, path, options) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, options);
  const body = await res.json();
  return { status: res.status, body };
}

async function sit(port, roomId, white, black) {
  const whiteSeat = await api(port, `/api/rooms/${roomId}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: white, color: "white" }),
  });
  const blackSeat = await api(port, `/api/rooms/${roomId}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: black, color: "black" }),
  });
  return { white: whiteSeat.body.token, black: blackSeat.body.token };
}

async function playLine(port, roomId, white, black, moves) {
  let last = null;
  for (let i = 0; i < moves.length; i += 1) {
    const token = i % 2 === 0 ? white : black;
    last = await api(port, `/api/rooms/${roomId}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, uci: moves[i] }),
    });
    assert.equal(last.status, 200, moves[i]);
  }
  return last.body;
}

async function fourPlayer(page) {
  await page.context.createTournament("Club");
  for (const name of ["Ada", "Bea", "Cal", "Dee"]) await page.context.addPlayer(name);
  return page.context.startTournament();
}

function reportButton(page, white, black, result) {
  return buttons(page.elements["tournament-view"]).find((button) => {
    return button.dataset.white === white && button.dataset.black === black && button.dataset.result === result;
  });
}

test("an unchanged tournament poll keeps the result buttons", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const page = loadPage(await pageHtml(server.port), server.port);
  await fourPlayer(page);
  const view = page.elements["tournament-view"];
  const before = view.children;
  const button = reportButton(page, "Ada", "Bea", "1-0");
  await page.context.refreshTournament();
  assert.equal(view.children, before);
  assert.equal(reportButton(page, "Ada", "Bea", "1-0"), button);
  assert.equal(button.ariaLabel, "1 Ada Bea 1-0");
});

test("a polled checkmate shows 1-0 and one score", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const page = loadPage(await pageHtml(server.port), server.port);
  const started = await fourPlayer(page);
  const game = started.rounds[0].pairings[0];
  const other = started.rounds[0].pairings[1];
  const seats = await sit(server.port, game.roomId, game.white, game.black);
  const finished = await playLine(server.port, game.roomId, seats.white, seats.black, SCHOLAR);
  assert.equal(finished.status, "checkmate");
  await page.context.refreshTournament();
  const rows = page.elements["tournament-view"].children.filter((node) => node.tagName === "P").map((node) => textOf(node).replace(/\s+/g, " ").trim());
  assert.ok(rows.includes(game.white + " " + game.black + " 1-0"));
  assert.ok(rows.includes(game.white + " 1"));
  assert.ok(rows.includes(other.white + " " + other.black));
  assert.ok(rows.includes(other.white + " 0"));
  assert.ok(rows.includes(other.black + " 0"));
});

test("a polled stalemate shows a half on both scores", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const page = loadPage(await pageHtml(server.port), server.port);
  const started = await fourPlayer(page);
  const game = started.rounds[0].pairings[0];
  const seats = await sit(server.port, game.roomId, game.white, game.black);
  const finished = await playLine(server.port, game.roomId, seats.white, seats.black, STALEMATE);
  assert.equal(finished.status, "stalemate");
  await page.context.refreshTournament();
  const rows = page.elements["tournament-view"].children.filter((node) => node.tagName === "P").map((node) => textOf(node).replace(/\s+/g, " ").trim());
  assert.ok(rows.includes(game.white + " " + game.black + " 1/2-1/2"));
  assert.ok(rows.includes(game.white + " 0.5"));
  assert.ok(rows.includes(game.black + " 0.5"));
});

test("page controls report results and refuse a second report", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const page = loadPage(await pageHtml(server.port), server.port);
  const started = await fourPlayer(page);
  const first = started.rounds[0].pairings[0];
  const second = started.rounds[0].pairings[1];
  const win = reportButton(page, first.white, first.black, "1-0");
  await win.listeners.click();
  let rows = page.elements["tournament-view"].children.filter((node) => node.tagName === "P").map((node) => textOf(node).replace(/\s+/g, " ").trim());
  assert.ok(rows.includes(first.white + " " + first.black + " 1-0"));
  assert.ok(rows.includes(first.white + " 1"));
  const draw = reportButton(page, second.white, second.black, "1/2-1/2");
  await draw.listeners.click();
  rows = page.elements["tournament-view"].children.filter((node) => node.tagName === "P").map((node) => textOf(node).replace(/\s+/g, " ").trim());
  assert.ok(rows.includes(second.white + " " + second.black + " 1/2-1/2"));
  assert.ok(rows.includes(second.white + " 0.5"));
  assert.ok(rows.includes(second.black + " 0.5"));
  const again = reportButton(page, first.white, first.black, "0-1");
  await again.listeners.click();
  assert.match(textOf(page.elements.tournaments), /bad request/);
  rows = page.elements["tournament-view"].children.filter((node) => node.tagName === "P").map((node) => textOf(node).replace(/\s+/g, " ").trim());
  assert.ok(rows.includes(first.white + " " + first.black + " 1-0"));
  assert.ok(rows.includes(first.white + " 1"));
  assert.ok(rows.includes(first.black + " 0"));
});

test("next round waits for every result and then lists both rounds", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const html = await pageHtml(server.port);
  for (const id of ["rooms", "board", "tournaments"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  const page = loadPage(html, server.port);
  const started = await fourPlayer(page);
  await page.elements["next-round"].listeners.submit({ preventDefault() {} });
  assert.match(textOf(page.elements.tournaments), /bad request/);
  assert.equal(page.elements["tournament-view"].children.filter((node) => node.textContent === "1").length, 1);
  assert.equal(page.elements["tournament-view"].children.filter((node) => node.textContent === "2").length, 0);
  for (const pairing of started.rounds[0].pairings) {
    const button = reportButton(page, pairing.white, pairing.black, "1-0");
    await button.listeners.click();
  }
  await page.elements["next-round"].listeners.submit({ preventDefault() {} });
  const view = page.elements["tournament-view"];
  assert.equal(view.children.filter((node) => node.textContent === "1").length, 1);
  assert.equal(view.children.filter((node) => node.textContent === "2").length, 1);
  const headings = view.children.filter((node) => node.textContent === "2");
  const after = view.children.slice(view.children.indexOf(headings[0]) + 1);
  const pairingRows = after.filter((node) => node.tagName === "P");
  const names = pairingRows.flatMap((row) => row.textContent.split(" ").slice(0, 2));
  assert.deepEqual(names.sort(), ["Ada", "Bea", "Cal", "Dee"]);
  const listed = textOf(page.elements["room-list"]);
  for (const row of pairingRows) {
    const [white, black] = row.textContent.split(" ");
    assert.match(listed, new RegExp("Club " + white + " vs " + black));
  }
});
