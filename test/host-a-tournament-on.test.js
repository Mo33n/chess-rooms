import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { POLL_MS, mount } from "../public/play.js";

const START_PLACEMENT = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
const MATE = ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"];
const FOOL = ["f2f3", "e7e5", "g2g4", "d8h4"];

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
  const node = {
    textContent: "",
    value: "",
    dataset: {},
    style: {},
    attrs: {},
    children: [],
    listeners: { click: [] },
    htmlWrites: 0,
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    addEventListener(type, fn) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(fn);
    },
    click() {
      for (const fn of this.listeners.click || []) fn();
    },
  };
  Object.defineProperty(node, "innerHTML", {
    set() {
      node.htmlWrites += 1;
    },
    get() {
      return "";
    },
  });
  return node;
}

function page() {
  const nodes = {
    rooms: el(),
    board: el(),
    tournaments: el(),
    "tournament-name": el(),
    "player-name": el(),
  };
  const input = el();
  const buttons = {
    open: el(),
    "sit-white": el(),
    "sit-black": el(),
    host: el(),
    "add-player": el(),
    "start-tournament": el(),
    "next-round": el(),
  };
  const doc = {
    input,
    buttons,
    nodes,
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

function walk(node, visit) {
  visit(node);
  for (const child of node.children || []) walk(child, visit);
}

function columnText(doc) {
  const parts = [];
  walk(doc.getElementById("tournaments"), (node) => {
    if (node.textContent) parts.push(node.textContent);
  });
  return parts.join(" ");
}

function boardText(doc) {
  const parts = [];
  walk(doc.getElementById("board"), (node) => {
    if (node.textContent) parts.push(node.textContent);
    if (node.dataset?.square) parts.push(node.dataset.square);
  });
  return parts.join(" ");
}

function results(doc) {
  const found = [];
  walk(doc.getElementById("tournaments"), (node) => {
    if (node.dataset?.role === "result") found.push(node.textContent);
  });
  return found;
}

function buttonsNamed(doc, name) {
  const found = [];
  walk(doc.getElementById("tournaments"), (node) => {
    if (node.textContent === name && node.click) found.push(node);
  });
  return found;
}

function clickSquare(doc, square) {
  const found = [];
  walk(doc.getElementById("board"), (node) => {
    if (node.dataset?.square === square) found.push(node);
  });
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
  return mount(doc, {
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
}

async function hostWith(doc, tournamentName, names) {
  doc.nodes["tournament-name"].value = tournamentName;
  doc.buttons.host.click();
  await until(() => columnText(doc).includes(tournamentName) && "hosted");
  for (const name of names) {
    doc.nodes["player-name"].value = name;
    doc.buttons["add-player"].click();
    await until(() => columnText(doc).includes(name) && name);
  }
  doc.buttons["start-tournament"].click();
  await until(() => results(doc).length > 0 && "started");
}

async function playUci(doc, uci) {
  clickSquare(doc, uci.slice(0, 2));
  clickSquare(doc, uci.slice(2));
  await until(() => boardText(doc).includes(uci) && uci);
}

test("a hosted field lists both names and an empty pairing result", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const doc = page();
  const timers = [];
  session(doc, `http://127.0.0.1:${server.port}`, timers);
  await hostWith(doc, "Club Open", ["Ada", "Bea"]);
  const text = columnText(doc);
  assert.match(text, /Ada/);
  assert.match(text, /Bea/);
  assert.equal(results(doc).length, 1);
  assert.equal(results(doc)[0], "");
});

test("opening a pairing sits both names, paints the start, and polls the room", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const track = trackedFetch();
  const doc = page();
  const timers = [];
  session(doc, `http://127.0.0.1:${server.port}`, timers, track.fetch);
  await hostWith(doc, "Club Open", ["Ada", "Bea"]);
  buttonsNamed(doc, "Open")[0].click();
  await until(() => boardText(doc).includes(START_PLACEMENT) && boardText(doc).includes("Ada") && "open");
  const text = boardText(doc);
  assert.match(text, /Bea/);
  const joins = track.calls.filter((call) => call.url.endsWith("/join"));
  assert.equal(joins[0].req.name, "Ada");
  assert.equal(joins[0].req.color, "white");
  assert.equal(joins[1].req.name, "Bea");
  assert.equal(joins[1].req.color, "black");
  const poll = timers.filter(Boolean).at(-1);
  assert.equal(poll.ms, 1500);
  const before = track.calls.filter((call) => call.method === "GET" && /\/api\/rooms\//.test(call.url)).length;
  await poll.fn();
  const after = track.calls.filter((call) => call.method === "GET" && /\/api\/rooms\//.test(call.url)).length;
  assert.equal(after > before, true);
});

test("scholar's mate shows 1-0 and fool's mate shows 0-1 without a results request", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const whiteMate = trackedFetch();
  const doc = page();
  const timers = [];
  session(doc, `http://127.0.0.1:${server.port}`, timers, whiteMate.fetch);
  await hostWith(doc, "Mate", ["Ada", "Bea"]);
  buttonsNamed(doc, "Open")[0].click();
  await until(() => boardText(doc).includes(START_PLACEMENT) && "board");
  for (const uci of MATE) await playUci(doc, uci);
  await until(() => columnText(doc).includes("1-0") && "white-mate");
  assert.equal(whiteMate.calls.some((call) => call.url.endsWith("/results")), false);

  const blackMate = trackedFetch();
  const other = page();
  const otherTimers = [];
  session(other, `http://127.0.0.1:${server.port}`, otherTimers, blackMate.fetch);
  await hostWith(other, "Fool", ["Cal", "Dee"]);
  buttonsNamed(other, "Open")[0].click();
  await until(() => boardText(other).includes(START_PLACEMENT) && "fool-board");
  for (const uci of FOOL) await playUci(other, uci);
  await until(() => columnText(other).includes("0-1") && "black-mate");
  assert.equal(blackMate.calls.some((call) => call.url.endsWith("/results")), false);
});

test("a draw records 1/2-1/2 and finishes the room", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const track = trackedFetch();
  const doc = page();
  const timers = [];
  session(doc, `http://127.0.0.1:${server.port}`, timers, track.fetch);
  await hostWith(doc, "Draws", ["Ada", "Bea"]);
  buttonsNamed(doc, "Open")[0].click();
  await until(() => boardText(doc).includes("playing") && "playing");
  buttonsNamed(doc, "Draw")[0].click();
  await until(() => results(doc)[0] === "1/2-1/2" && "drawn");
  await until(() => boardText(doc).includes("finished") && "finished");
  const posted = track.calls.find((call) => call.url.endsWith("/results"));
  assert.equal(posted.req.result, "1/2-1/2");
  assert.equal(posted.req.round, 1);
  assert.equal(posted.req.white, "Ada");
  assert.equal(posted.req.black, "Bea");
});

test("next round shows an error until every pairing has a result", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const doc = page();
  const timers = [];
  session(doc, `http://127.0.0.1:${server.port}`, timers);
  await hostWith(doc, "Swiss", ["Ada", "Bea", "Cal", "Dee"]);
  assert.equal(results(doc).length, 2);
  doc.buttons["next-round"].click();
  await until(() => columnText(doc).includes("Finish every game in this round first.") && "blocked");
  assert.equal(results(doc).length, 2);
  buttonsNamed(doc, "Draw")[0].click();
  await until(() => results(doc).some((result) => result === "1/2-1/2") && "one-draw");
  doc.buttons["next-round"].click();
  await until(() => columnText(doc).includes("Finish every game in this round first.") && "still-blocked");
  assert.equal(results(doc).length, 2);
  const pending = buttonsNamed(doc, "Draw");
  pending[pending.length - 1].click();
  await until(() => results(doc).every((result) => result === "1/2-1/2") && "both");
  doc.buttons["next-round"].click();
  await until(() => results(doc).length === 4 && "round-two");
  const opens = buttonsNamed(doc, "Open");
  opens[opens.length - 1].click();
  await until(() => boardText(doc).includes(START_PLACEMENT) && "round-room");
});

test("player names and server errors stay literal text", async () => {
  const doc = page();
  const timers = [];
  const htmlWrites = [];
  session(doc, "", timers, async (url, init) => {
    if (String(url) === "/api/tournaments" && init?.method === "POST") {
      return Response.json({ id: "t-html", name: "Markup", players: [], rounds: [] });
    }
    if (String(url).endsWith("/players")) {
      return Response.json({
        id: "t-html",
        name: "Markup",
        players: [{ name: "<b>Ada</b>", score: 0 }],
        rounds: [],
      });
    }
    if (String(url).endsWith("/start")) {
      return Response.json({ error: "<b>bad</b>" }, { status: 400 });
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  });
  const created = [];
  const baseCreate = doc.createElement.bind(doc);
  doc.createElement = () => {
    const node = baseCreate();
    created.push(node);
    return node;
  };
  doc.nodes["tournament-name"].value = "Markup";
  doc.buttons.host.click();
  await until(() => columnText(doc).includes("Markup") && "hosted");
  doc.nodes["player-name"].value = "<b>Ada</b>";
  doc.buttons["add-player"].click();
  await until(() => columnText(doc).includes("<b>Ada</b>") && "name");
  doc.buttons["start-tournament"].click();
  await until(() => columnText(doc).includes("<b>bad</b>") && "error");
  const text = columnText(doc);
  assert.equal(text.includes("<b>Ada</b>"), true);
  assert.equal(text.includes("<b>bad</b>"), true);
  walk(doc.getElementById("tournaments"), (node) => htmlWrites.push(node.htmlWrites || 0));
  assert.equal(htmlWrites.every((count) => count === 0), true);
  assert.equal(created.every((node) => node.htmlWrites === 0), true);
});

test("a restarted server has no previous tournament", async (t) => {
  const first = await startServer();
  const created = await fetch(`http://127.0.0.1:${first.port}/api/tournaments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Gone" }),
  });
  const tournament = await created.json();
  await first.stop();
  const second = await startServer();
  t.after(() => second.stop());
  const pageRes = await fetch(`http://127.0.0.1:${second.port}/`);
  const html = await pageRes.text();
  assert.match(html, /id="rooms"/);
  assert.match(html, /id="board"/);
  assert.match(html, /id="tournaments"/);
  const doc = page();
  const timers = [];
  session(doc, `http://127.0.0.1:${second.port}`, timers);
  assert.equal(doc.getElementById("tournaments").children.length, 0);
  const missing = await fetch(`http://127.0.0.1:${second.port}/api/tournaments/${tournament.id}`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "not found" });
});

test("a tournament 404 leaves the column", async () => {
  const doc = page();
  const timers = [];
  let missing = false;
  const handle = session(doc, "", timers, async (url, init) => {
    if (String(url) === "/api/tournaments" && init?.method === "POST") {
      return Response.json({ id: "t-gone", name: "Gone", players: [], rounds: [] });
    }
    if (missing) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    return Response.json({ id: "t-gone", name: "Gone", players: [], rounds: [] });
  });
  doc.nodes["tournament-name"].value = "Gone";
  doc.buttons.host.click();
  await until(() => columnText(doc).includes("Gone") && "listed");
  missing = true;
  await handle.pollTournament();
  assert.equal(columnText(doc), "");
  assert.equal(doc.getElementById("tournaments").children.length, 0);
});
