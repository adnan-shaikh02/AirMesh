import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer, type RawData } from "ws";

const PORT = Number(process.env.PORT ?? 8787);
const SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_PAYLOAD = 64 * 1024;
const rooms = new Map<string, Room>();
let nextConnectionId = 1;

type LogDetails = Record<string, string | number | boolean | undefined>;
function serverLog(
  level: "info" | "warn" | "error",
  event: string,
  details?: LogDetails,
) {
  const message = `[Drop:server] ${event}`;
  if (level === "info") {
    if (details) console.info(message, details);
    else console.info(message);
  } else if (level === "warn") {
    if (details) console.warn(message, details);
    else console.warn(message);
  } else if (details) console.error(message, details);
  else console.error(message);
}

type Client = { ws: WebSocket; role: "sender" | "receiver" };
type Room = {
  token: string;
  clients: Map<WebSocket, Client>;
  expiresAt: number;
  timer: NodeJS.Timeout;
};
type Message = {
  type: string;
  roomId?: string;
  token?: string;
  payload?: unknown;
};

const json = (ws: WebSocket, value: unknown) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
};
const sendError = (ws: WebSocket, code: string) => {
  serverLog("warn", "client.error", { code });
  json(ws, { type: "error", code });
};
const random = (bytes: number) => randomBytes(bytes).toString("base64url");

function closeRoom(roomId: string, reason: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  serverLog("info", "room.closed", { reason, peers: room.clients.size });
  clearTimeout(room.timer);
  rooms.delete(roomId);
  for (const client of room.clients.values()) {
    json(client.ws, { type: "room-closed", reason });
    if (client.ws.readyState === WebSocket.OPEN) client.ws.close(1000, reason);
  }
}

function parseMessage(raw: RawData): Message | null {
  try {
    const value: unknown = JSON.parse(raw.toString());
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const message = value as Record<string, unknown>;
    if (typeof message.type !== "string") return null;
    return message as Message;
  } catch {
    return null;
  }
}

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(
      JSON.stringify({
        ok: true,
        service: "drop-signaling",
        activeRooms: rooms.size,
      }),
    );
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
});

const wss = new WebSocketServer({
  server,
  path: "/signal",
  maxPayload: MAX_PAYLOAD,
  perMessageDeflate: false,
});

wss.on("connection", (ws) => {
  const connectionId = nextConnectionId++;
  let roomId: string | null = null;
  serverLog("info", "client.connected", { connectionId });
  ws.on("message", (raw) => {
    const message = parseMessage(raw);
    if (!message) {
      serverLog("warn", "message.invalid", { connectionId });
      return sendError(ws, "invalid-message");
    }

    if (message.type === "create") {
      if (roomId) return sendError(ws, "already-in-room");
      const id = random(9);
      const token = random(24);
      const timer = setTimeout(() => closeRoom(id, "expired"), SESSION_TTL_MS);
      timer.unref();
      const room: Room = {
        token,
        clients: new Map([[ws, { ws, role: "sender" }]]),
        expiresAt: Date.now() + SESSION_TTL_MS,
        timer,
      };
      rooms.set(id, room);
      roomId = id;
      serverLog("info", "room.created", {
        connectionId,
        expiresInSeconds: 600,
      });
      return json(ws, {
        type: "created",
        roomId: id,
        token,
        expiresAt: room.expiresAt,
      });
    }

    if (message.type === "join") {
      if (roomId) return sendError(ws, "already-in-room");
      if (
        typeof message.roomId !== "string" ||
        typeof message.token !== "string" ||
        message.roomId.length > 32 ||
        message.token.length > 64
      )
        return sendError(ws, "invalid-pairing");
      const room = rooms.get(message.roomId);
      if (!room || room.expiresAt <= Date.now())
        return sendError(ws, "room-expired");
      const supplied = Buffer.from(message.token);
      const expected = Buffer.from(room.token);
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      )
        return sendError(ws, "invalid-pairing");
      if (room.clients.size >= 2) return sendError(ws, "room-full");
      clearTimeout(room.timer);
      room.clients.set(ws, { ws, role: "receiver" });
      roomId = message.roomId;
      serverLog("info", "room.joined", {
        connectionId,
        participantCount: room.clients.size,
      });
      for (const client of room.clients.values())
        json(client.ws, { type: "peer-joined", role: client.role });
      return;
    }

    if (message.type === "signal") {
      if (!roomId) return sendError(ws, "not-in-room");
      const room = rooms.get(roomId);
      if (!room) return sendError(ws, "room-expired");
      const peer = [...room.clients.values()].find(
        (client) => client.ws !== ws,
      );
      if (!peer) return sendError(ws, "peer-not-connected");
      const payload = message.payload as
        | {
            candidate?: unknown;
            description?: { type?: unknown };
          }
        | undefined;
      const signalKind = payload?.candidate
        ? "ice-candidate"
        : typeof payload?.description?.type === "string"
          ? payload.description.type
          : "other";
      serverLog("info", "signal.forwarded", { connectionId, signalKind });
      return json(peer.ws, { type: "signal", payload: message.payload });
    }

    if (message.type === "leave") {
      if (!roomId) return;
      serverLog("info", "client.left-room", { connectionId });
      closeRoom(roomId, "peer-left");
      roomId = null;
      return;
    }

    sendError(ws, "unknown-message-type");
  });

  ws.on("close", () => {
    serverLog("info", "client.disconnected", {
      connectionId,
      hadRoom: Boolean(roomId),
    });
    if (!roomId) return;
    closeRoom(roomId, "peer-disconnected");
  });
  ws.on("error", (error) => {
    serverLog("error", "client.socket-error", {
      connectionId,
      message: error.message,
    });
  });
});

server.listen(PORT, "0.0.0.0", () =>
  serverLog("info", "server.listening", { port: PORT }),
);
server.on("error", (error) => {
  serverLog("error", "server.error", { message: error.message });
});

function shutdown() {
  for (const roomId of rooms.keys()) closeRoom(roomId, "server-shutdown");
  wss.close(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
