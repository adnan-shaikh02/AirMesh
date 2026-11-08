import type { IncomingMessage, ServerResponse } from "node:http";

export function handleHealthRoute(
  req: IncomingMessage,
  res: ServerResponse,
  activeRooms: number,
): boolean {
  if (req.url !== "/health") return false;
  res.writeHead(200, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify({ ok: true, service: "drop-signaling", activeRooms }));
  return true;
}
