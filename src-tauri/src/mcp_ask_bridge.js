// Dumb stdio<->TCP relay. Claude Code spawns this as an MCP server (stdio
// transport); it just forwards raw bytes to/from the Rust-side listener,
// which implements the actual MCP JSON-RPC handling. Kept as a separate file
// (embedded into the Rust binary via include_str!) instead of a `node -e`
// one-liner so it's easy to read/edit on its own.
const net = require("net");

const port = parseInt(process.argv[process.argv.length - 1], 10);
const sock = net.createConnection({ port, host: "127.0.0.1" }, () => {
  process.stdin.pipe(sock);
  sock.pipe(process.stdout);
});
sock.on("error", () => process.exit(1));
sock.on("close", () => process.exit(0));
