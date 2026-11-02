// Preload for the bundled MCP server in tests (`node --import <this> server.mjs ...`):
// any attempt to reach the network writes NETWORK-ATTEMPT to stderr and exits 99.
import dgram from "node:dgram";
import dns from "node:dns";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import tls from "node:tls";

function trap(obj, key, label) {
  obj[key] = () => {
    process.stderr.write(`NETWORK-ATTEMPT ${label}\n`);
    process.exit(99);
  };
}

trap(net.Socket.prototype, "connect", "net.Socket.connect");
trap(net, "connect", "net.connect");
trap(net, "createConnection", "net.createConnection");
trap(tls, "connect", "tls.connect");
for (const k of ["lookup", "resolve", "resolve4", "resolve6", "resolveAny"])
  trap(dns, k, `dns.${k}`);
for (const k of ["lookup", "resolve", "resolve4", "resolve6"])
  trap(dns.promises, k, `dns.promises.${k}`);
for (const k of ["request", "get"]) {
  trap(http, k, `http.${k}`);
  trap(https, k, `https.${k}`);
}
trap(http2, "connect", "http2.connect");
trap(dgram, "createSocket", "dgram.createSocket");
trap(globalThis, "fetch", "fetch");
if ("WebSocket" in globalThis) trap(globalThis, "WebSocket", "WebSocket");
syncBuiltinESMExports();
