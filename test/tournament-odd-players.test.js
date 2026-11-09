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
  for (const child of node.children || []) text += textOf(child);
  return text;
}

async function api(port, path, options) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, options);
  return { status: res.status, body: await res.json() };
}

async function addPlayers(port, id, names) {
  for (const name of names) {
    const added = await api(port, `/api/tournaments/${id}/players`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    assert.equal(added.status, 200);
  }
}

test("three players are refused, scores stay, and no pairing room opens", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const created = await api(server.port, "/api/tournaments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Odd" }),
  });
  await addPlayers(server.port, created.body.id, ["Ada", "Bea", "Cara"]);
  const before = await api(server.port, `/api/tournaments/${created.body.id}`);
  const started = await api(server.port, `/api/tournaments/${created.body.id}/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(started.status, 400);
  assert.deepEqual(started.body, { error: "bad request" });
  const after = await api(server.port, `/api/tournaments/${created.body.id}`);
  assert.deepEqual(after.body.rounds, []);
  assert.deepEqual(after.body.players, before.body.players);
  const rooms = await api(server.port, "/api/rooms");
  assert.equal(rooms.body.rooms.some((room) => room.name.includes("Odd")), false);
});

test("an odd start of three says the number of players is odd; one player stays bad request", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const html = await (await fetch(`http://127.0.0.1:${server.port}/`)).text();
  const page = loadPage(html, server.port);
  await page.context.createTournament("Odd");
  await page.context.addPlayer("Ada");
  await page.context.addPlayer("Bea");
  await page.context.addPlayer("Cara");
  const started = await page.context.startTournament();
  assert.equal(started.error, "bad request");
  const shown = textOf(page.elements.tournaments);
  assert.match(shown, /number of players is odd/);
  assert.doesNotMatch(shown, /bad request/);

  const one = loadPage(html, server.port);
  await one.context.createTournament("Short");
  await one.context.addPlayer("Ada");
  const refused = await one.context.startTournament();
  assert.equal(refused.error, "bad request");
  const oneText = textOf(one.elements.tournaments);
  assert.match(oneText, /bad request/);
  assert.doesNotMatch(oneText, /number of players is odd/);
});

test("four players finish round 1 and every name is seated once in round 2", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const created = await api(server.port, "/api/tournaments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Even" }),
  });
  const names = ["Ada", "Bea", "Cara", "Dia"];
  await addPlayers(server.port, created.body.id, names);
  const started = await api(server.port, `/api/tournaments/${created.body.id}/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(started.status, 200);
  for (const pairing of started.body.rounds[0].pairings) {
    const recorded = await api(server.port, `/api/tournaments/${created.body.id}/results`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ round: 1, white: pairing.white, black: pairing.black, result: "1-0" }),
    });
    assert.equal(recorded.status, 200);
  }
  const next = await api(server.port, `/api/tournaments/${created.body.id}/next`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(next.status, 200);
  assert.equal(next.body.rounds.length, 2);
  const seated = next.body.rounds[1].pairings.flatMap((pairing) => [pairing.white, pairing.black]);
  assert.deepEqual(seated.slice().sort(), names.slice().sort());
  assert.equal(new Set(seated).size, names.length);
});
