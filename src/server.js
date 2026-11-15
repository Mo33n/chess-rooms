import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const page = new URL("../public/index.html", import.meta.url);
const port = Number(process.env.PORT || 5180);

createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(await readFile(page));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
}).listen(port, "127.0.0.1", () => {
  console.log(`chess rooms http://127.0.0.1:${port}/`);
});
