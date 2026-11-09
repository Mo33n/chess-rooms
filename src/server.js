import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import {
  addPlayer,
  createRoom,
  createTournament,
  getRoom,
  getTournament,
  joinRoom,
  listRooms,
  listTournaments,
  moveRoom,
  nextRound,
  recordResult,
  startTournament,
} from "./store.js";

const page = new URL("../public/index.html", import.meta.url);
const port = Number(process.env.PORT || 5180);

function send(res, status, body, type) {
  res.writeHead(status, { "content-type": type });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

const MAX_BODY = 64 * 1024;

function readBody(req, res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    function fail(error) {
      if (failed) return;
      failed = true;
      chunks.length = 0;
      reject(error);
    }
    req.on("data", (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        failed = true;
        chunks.length = 0;
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad request" }), () => req.destroy());
        reject(new Error("too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (failed) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        fail(new Error("json"));
      }
    });
    req.on("error", (error) => fail(error));
  });
}

createServer(async (req, res) => {
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  try {
    if (req.method === "GET" && path === "/") {
      send(res, 200, await readFile(page, "utf8"), "text/html; charset=utf-8");
      return;
    }
    if (req.method === "POST" && path === "/api/rooms") {
      const body = await readBody(req, res);
      const result = createRoom(body.name);
      send(res, result.status, result.body, "application/json");
      return;
    }
    if (req.method === "GET" && path === "/api/rooms") {
      send(res, 200, listRooms(), "application/json");
      return;
    }
    let match = path.match(/^\/api\/rooms\/([^/]+)$/);
    if (req.method === "GET" && match) {
      const result = getRoom(match[1]);
      send(res, result.status, result.body, "application/json");
      return;
    }
    match = path.match(/^\/api\/rooms\/([^/]+)\/join$/);
    if (req.method === "POST" && match) {
      const body = await readBody(req, res);
      const result = joinRoom(match[1], body.name, body.color);
      send(res, result.status, result.body, "application/json");
      return;
    }
    match = path.match(/^\/api\/rooms\/([^/]+)\/move$/);
    if (req.method === "POST" && match) {
      const body = await readBody(req, res);
      const result = moveRoom(match[1], body.token, body.uci);
      send(res, result.status, result.body, "application/json");
      return;
    }
    if (req.method === "POST" && path === "/api/tournaments") {
      const body = await readBody(req, res);
      const result = createTournament(body.name);
      send(res, result.status, result.body, "application/json");
      return;
    }
    if (req.method === "GET" && path === "/api/tournaments") {
      send(res, 200, listTournaments(), "application/json");
      return;
    }
    match = path.match(/^\/api\/tournaments\/([^/]+)$/);
    if (req.method === "GET" && match) {
      const result = getTournament(match[1]);
      send(res, result.status, result.body, "application/json");
      return;
    }
    match = path.match(/^\/api\/tournaments\/([^/]+)\/players$/);
    if (req.method === "POST" && match) {
      const body = await readBody(req, res);
      const result = addPlayer(match[1], body.name);
      send(res, result.status, result.body, "application/json");
      return;
    }
    match = path.match(/^\/api\/tournaments\/([^/]+)\/start$/);
    if (req.method === "POST" && match) {
      await readBody(req, res);
      const result = startTournament(match[1]);
      send(res, result.status, result.body, "application/json");
      return;
    }
    match = path.match(/^\/api\/tournaments\/([^/]+)\/results$/);
    if (req.method === "POST" && match) {
      const body = await readBody(req, res);
      const result = recordResult(match[1], body.round, body.white, body.black, body.result);
      send(res, result.status, result.body, "application/json");
      return;
    }
    match = path.match(/^\/api\/tournaments\/([^/]+)\/next$/);
    if (req.method === "POST" && match) {
      await readBody(req, res);
      const result = nextRound(match[1]);
      send(res, result.status, result.body, "application/json");
      return;
    }
    send(res, 404, { error: "not found" }, "application/json");
  } catch {
    if (!res.headersSent) send(res, 400, { error: "bad request" }, "application/json");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`chess rooms http://127.0.0.1:${port}/`);
});
