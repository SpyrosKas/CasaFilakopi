import { createServer as createHttpServer } from "node:http";
import { createServer, connect } from "node:net";

// Stands between the production test server and local Supabase, so a test can
// cause a real outage without touching the database other work is using.
// GET /down drops every connection and refuses new ones; GET /up restores.

const LISTEN_PORT = 54399;
const CONTROL_PORT = 54398;
const SUPABASE_PORT = 54321;

let down = false;
const open = new Set();

const proxy = createServer((client) => {
  if (down) {
    client.destroy();
    return;
  }
  const upstream = connect(SUPABASE_PORT, "127.0.0.1");
  const pair = [client, upstream];
  pair.forEach((socket) => {
    open.add(socket);
    socket.on("error", () => pair.forEach((other) => other.destroy()));
    socket.on("close", () => {
      open.delete(socket);
      pair.forEach((other) => other.destroy());
    });
  });
  client.pipe(upstream);
  upstream.pipe(client);
});

const control = createHttpServer((request, response) => {
  down = request.url === "/down";
  if (down) open.forEach((socket) => socket.destroy());
  response.end(down ? "down" : "up");
});

proxy.listen(LISTEN_PORT, "127.0.0.1");
control.listen(CONTROL_PORT, "127.0.0.1");
