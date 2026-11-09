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

function tagsOf(node, tags) {
  if (node.tagName) tags.push(node.tagName);
  for (const child of node.children || []) tagsOf(child, tags);
  return tags;
}

async function pageHtml(port) {
  const page = await fetch(`http://127.0.0.1:${port}/`);
  return page.text();
}

test("the page keeps rooms, board, and tournaments", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const html = await pageHtml(server.port);
  for (const id of ["rooms", "board", "tournaments"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test("starting two players shows the round and lists pairing rooms as text", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const html = await pageHtml(server.port);
  const page = loadPage(html, server.port);
  const created = await page.context.createTournament("Club");
  assert.equal(created.name, "Club");
  await page.context.addPlayer("Ada");
  await page.context.addPlayer("Bea");
  const startedAgain = await page.elements["start-tournament"].listeners.submit({ preventDefault() {} });
  assert.equal(startedAgain.rounds[0].round, 1);
  const names = startedAgain.rounds[0].pairings.flatMap((pairing) => [pairing.white, pairing.black]);
  assert.deepEqual(names.sort(), ["Ada", "Bea"]);
  const shown = textOf(page.elements.tournaments);
  assert.match(shown, /Club/);
  assert.match(shown, /1/);
  assert.match(shown, /Ada/);
  assert.match(shown, /Bea/);

  const rooms = await fetch(`http://127.0.0.1:${server.port}/api/rooms`);
  const listed = await rooms.json();
  assert.equal(listed.rooms.length, startedAgain.rounds[0].pairings.length);
  await page.context.refreshRooms();
  const buttons = page.elements["room-list"].children;
  assert.equal(buttons.length, listed.rooms.length);
  for (const room of listed.rooms) {
    const button = buttons.find((row) => row.dataset.roomId === room.id);
    assert.equal(button.textContent, room.name);
    assert.equal(button.children.length, 0);
    assert.equal(button.tagName, "BUTTON");
  }
});

test("a wrong seat shows seat taken and the paired name can sit", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const html = await pageHtml(server.port);
  const page = loadPage(html, server.port);
  await page.context.createTournament("Club");
  await page.context.addPlayer("Ada");
  await page.context.addPlayer("Bea");
  const started = await page.context.startTournament();
  const pairing = started.rounds[0].pairings[0];
  const rooms = await (await fetch(`http://127.0.0.1:${server.port}/api/rooms`)).json();
  const room = rooms.rooms.find((entry) => entry.id === pairing.roomId);
  await page.context.refreshRooms();
  await page.elements["room-list"].children.find((row) => row.textContent === room.name).listeners.click();
  page.elements["white-name"].value = "Cara";
  const refused = await page.elements["sit-white"].listeners.submit({ preventDefault() {} });
  assert.equal(refused.error, "seat taken");
  assert.equal(page.elements["seat-error"].textContent, "seat taken");
  const still = await (await fetch(`http://127.0.0.1:${server.port}/api/rooms/${room.id}`)).json();
  assert.equal(still.white, pairing.white);
  page.elements["white-name"].value = pairing.white;
  const sat = await page.elements["sit-white"].listeners.submit({ preventDefault() {} });
  assert.equal(typeof sat.token, "string");
  assert.ok(sat.token.length > 0);
});

test("one player and a duplicate name show bad request", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const html = await pageHtml(server.port);
  const page = loadPage(html, server.port);
  const created = await page.context.createTournament("Short");
  await page.context.addPlayer("Ada");
  const started = await page.context.startTournament();
  assert.equal(started.error, "bad request");
  assert.match(textOf(page.elements.tournaments), /bad request/);
  const rooms = await (await fetch(`http://127.0.0.1:${server.port}/api/rooms`)).json();
  assert.equal(rooms.rooms.length, 0);

  const duplicate = await page.context.addPlayer("Ada");
  assert.equal(duplicate.error, "bad request");
  assert.match(textOf(page.elements.tournaments), /bad request/);
  const tournament = await (await fetch(`http://127.0.0.1:${server.port}/api/tournaments/${created.id}`)).json();
  assert.deepEqual(tournament.players.map((player) => player.name), ["Ada"]);
  const listed = textOf(page.elements["tournament-view"]).split("Ada").length - 1;
  assert.equal(listed, 1);
});

test("a markup name stays text", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const html = await pageHtml(server.port);
  const page = loadPage(html, server.port);
  const raw = "<img src=x onerror=alert(1)>";
  await page.context.createTournament(raw);
  await page.context.addPlayer(raw);
  const view = page.elements["tournament-view"];
  assert.equal(tagsOf(view, []).includes("IMG"), false);
  const texts = [];
  function collect(node) {
    if (node.textContent) texts.push(node.textContent);
    for (const child of node.children || []) collect(child);
  }
  collect(view);
  assert.equal(texts.filter((text) => text === raw).length, 2);
});

test("a casual room still sits and moves", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const html = await pageHtml(server.port);
  const page = loadPage(html, server.port);
  page.context.document.getElementById("room-name").value = "Casual";
  await page.elements["create-room"].listeners.submit({ preventDefault() {} });
  await page.context.refreshRooms();
  const button = page.elements["room-list"].children.find((row) => row.textContent === "Casual");
  assert.ok(button);
  await button.listeners.click();
  page.elements["black-name"].value = "Bea";
  await page.elements["sit-black"].listeners.submit({ preventDefault() {} });
  page.elements["white-name"].value = "Ada";
  await page.elements["sit-white"].listeners.submit({ preventDefault() {} });
  page.elements.uci.value = "e2e4";
  const moved = await page.elements["move-form"].listeners.submit({ preventDefault() {} });
  assert.equal(moved.status, 200);
  const rank = page.elements.position.children[4];
  assert.equal(rank.children[4].textContent, "P");
});
