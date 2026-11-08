import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { browserLog } from "./logger";
import labels from "../config/labels.json";

const interpolate = (
  template: string,
  values: Record<string, string | number>,
) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
const serverErrorLabels: Record<string, string> = labels.errors.serverErrors;
const serverErrorMessage = (code: string) =>
  serverErrorLabels[code] ?? labels.errors.unknownServerError;

type Phase = "idle" | "waiting" | "connecting" | "connected" | "error";
type Incoming = {
  id: string;
  name: string;
  size: number;
  type: string;
  batchFiles?: { name: string; size: number }[];
};
type Transfer = {
  name: string;
  size: number;
  received: number;
  direction: "send" | "receive";
  status: "waiting" | "transferring" | "complete" | "rejected" | "error";
  speed?: number;
};
type Wire = { type: string; [key: string]: unknown };

const chunkSize = 64 * 1024;
const fallbackLimit = 100 * 1024 * 1024;

function localDeviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (
    /iPad/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  )
    return "iPad";
  if (/Android/i.test(ua))
    return /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Linux/i.test(ua)) return "Linux PC";
  return "Device";
}

function transferId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function signalUrl() {
  const configured = import.meta.env.VITE_SIGNALING_URL as string | undefined;
  if (configured) return configured;
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.hostname}:8787/signal`;
}

export function useDrop() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [roomLink, setRoomLink] = useState("");
  const [qr, setQr] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [peerName, setPeerName] = useState("");
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [error, setError] = useState("");
  const socket = useRef<WebSocket | null>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const receiverParts = useRef<ArrayBuffer[]>([]);
  const receiverBytes = useRef(0);
  const receiverWriter = useRef<FileSystemWritableFileStream | null>(null);
  const activeTransfer = useRef<Incoming | null>(null);
  const approvedBatches = useRef(new Set<string>());
  const sendQueue = useRef<File[][]>([]);
  const drainingQueue = useRef(false);
  const mounted = useRef(true);

  const updateTransfer = useCallback(
    (name: string, update: Partial<Transfer>) => {
      setTransfers((old) => {
        const index = old.findIndex(
          (item) =>
            item.name === name &&
            item.status !== "complete" &&
            item.status !== "rejected",
        );
        if (index < 0)
          return [
            ...old,
            {
              name,
              size: 0,
              received: 0,
              direction: "send",
              status: "waiting",
              ...update,
            },
          ];
        return old.map((item, i) =>
          i === index ? { ...item, ...update } : item,
        );
      });
    },
    [],
  );

  const cleanup = useCallback(() => {
    channel.current?.close();
    channel.current = null;
    peer.current?.close();
    peer.current = null;
    socket.current?.close();
    socket.current = null;
  }, []);

  const sendSignal = useCallback((payload: unknown) => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      const signal = payload as {
        candidate?: unknown;
        description?: { type?: string };
      };
      if (signal.description?.type)
        browserLog.info("signaling.description.sent", {
          descriptionType: signal.description.type,
        });
      else if (signal.candidate)
        browserLog.info("signaling.ice-candidate.sent");
      socket.current.send(JSON.stringify({ type: "signal", payload }));
    } else {
      browserLog.warn("signaling.message.skipped", {
        reason: "socket-not-open",
      });
    }
  }, []);

  const sendFile = useCallback(
    async (file: File, batchId: string) => {
      const dc = channel.current;
      if (!dc || dc.readyState !== "open") return;
      const id = transferId();
      browserLog.info("transfer.offer.sent", { sizeBytes: file.size });
      dc.send(
        JSON.stringify({
          type: "file-offer",
          id,
          batchId,
          name: file.name,
          size: file.size,
          mime: file.type || "application/octet-stream",
        }),
      );
      updateTransfer(file.name, {
        size: file.size,
        received: 0,
        direction: "send",
        status: "waiting",
      });
      const accepted = await new Promise<boolean>((resolve) => {
        const timeout = window.setTimeout(() => {
          browserLog.warn("transfer.offer.timed-out", { sizeBytes: file.size });
          dc.removeEventListener("message", listener);
          updateTransfer(file.name, { status: "error" });
          resolve(false);
        }, 120_000);
        const listener = (event: MessageEvent) => {
          if (typeof event.data !== "string") return;
          let message: Wire;
          try {
            message = JSON.parse(event.data) as Wire;
          } catch {
            return;
          }
          if (message.id !== id) return;
          if (message.type === "file-accepted" && message.batchId === batchId) {
            browserLog.info("transfer.offer.accepted", {
              sizeBytes: file.size,
            });
            window.clearTimeout(timeout);
            dc.removeEventListener("message", listener);
            resolve(true);
          }
          if (message.type === "file-rejected") {
            browserLog.warn("transfer.offer.rejected", {
              sizeBytes: file.size,
            });
            window.clearTimeout(timeout);
            dc.removeEventListener("message", listener);
            updateTransfer(file.name, { status: "rejected" });
            resolve(false);
          }
        };
        dc.addEventListener("message", listener);
      });
      if (!accepted) return;
      if (dc.readyState !== "open") return;
      const started = performance.now();
      let sent = 0;
      updateTransfer(file.name, { status: "transferring" });
      for (let offset = 0; offset < file.size; offset += chunkSize) {
        if (dc.readyState !== "open")
          throw new Error(labels.errors.connectionInterruptedShort);
        if (dc.bufferedAmount > 1024 * 1024) {
          browserLog.info("transfer.backpressure.wait", {
            bufferedBytes: dc.bufferedAmount,
          });
          await new Promise<void>((resolve) => {
            dc.bufferedAmountLowThreshold = 256 * 1024;
            const resume = () => {
              dc.removeEventListener("bufferedamountlow", resume);
              dc.removeEventListener("close", resume);
              resolve();
            };
            dc.addEventListener("bufferedamountlow", resume, { once: true });
            dc.addEventListener("close", resume, { once: true });
          });
        }
        dc.send(await file.slice(offset, offset + chunkSize).arrayBuffer());
        sent += Math.min(chunkSize, file.size - offset);
        const seconds = Math.max((performance.now() - started) / 1000, 0.1);
        updateTransfer(file.name, { received: sent, speed: sent / seconds });
        if (sent === file.size || sent % (1024 * 1024) < chunkSize)
          browserLog.info("transfer.send.progress", {
            sentBytes: sent,
            totalBytes: file.size,
          });
      }
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          dc.removeEventListener("message", listener);
          reject(new Error(labels.errors.receiverDidNotConfirm));
        }, 120_000);
        const listener = (event: MessageEvent) => {
          if (typeof event.data !== "string") return;
          try {
            const message = JSON.parse(event.data) as Wire;
            if (message.type === "file-received" && message.id === id) {
              window.clearTimeout(timeout);
              dc.removeEventListener("message", listener);
              resolve();
            }
            if (message.type === "file-failed" && message.id === id) {
              window.clearTimeout(timeout);
              dc.removeEventListener("message", listener);
              reject(
                new Error(
                  typeof message.reason === "string"
                    ? message.reason
                    : labels.errors.receiverCouldNotSave,
                ),
              );
            }
          } catch {
            /* Ignore unrelated channel messages. */
          }
        };
        dc.addEventListener("message", listener);
        dc.send(JSON.stringify({ type: "file-complete", id }));
      });
      updateTransfer(file.name, { status: "complete", received: file.size });
      browserLog.info("transfer.send.complete", { sizeBytes: file.size });
    },
    [updateTransfer],
  );

  const sendBatch = useCallback(
    async (files: File[]) => {
      const dc = channel.current;
      if (!dc || dc.readyState !== "open") return;
      const batchId = transferId();
      dc.send(
        JSON.stringify({
          type: "batch-offer",
          id: batchId,
          files: files.map(({ name, size }) => ({ name, size })),
        }),
      );
      const accepted = await new Promise<boolean>((resolve) => {
        const timeout = window.setTimeout(() => {
          dc.removeEventListener("message", listener);
          resolve(false);
        }, 120_000);
        const listener = (event: MessageEvent) => {
          if (typeof event.data !== "string") return;
          try {
            const message = JSON.parse(event.data) as Wire;
            if (
              message.id !== batchId ||
              !["batch-accepted", "batch-rejected"].includes(message.type)
            )
              return;
            window.clearTimeout(timeout);
            dc.removeEventListener("message", listener);
            resolve(message.type === "batch-accepted");
          } catch {
            /* Ignore unrelated messages. */
          }
        };
        dc.addEventListener("message", listener);
      });
      if (!accepted) {
        files.forEach((file) =>
          updateTransfer(file.name, { status: "rejected" }),
        );
        return;
      }
      for (const file of files) await sendFile(file, batchId);
    },
    [sendFile, updateTransfer],
  );

  const drainQueue = useCallback(async () => {
    if (drainingQueue.current) return;
    drainingQueue.current = true;
    try {
      while (
        sendQueue.current.length &&
        channel.current?.readyState === "open"
      ) {
        const files = sendQueue.current.shift()!;
        browserLog.info("transfer.queue.next", {
          remainingFiles: sendQueue.current.length,
          fileCount: files.length,
        });
        try {
          await sendBatch(files);
        } catch (reason) {
          browserLog.error("transfer.send.failed", {
            message: reason instanceof Error ? reason.message : "unknown-error",
          });
          files.forEach((file) =>
            updateTransfer(file.name, { status: "error" }),
          );
        }
      }
    } finally {
      drainingQueue.current = false;
      if (sendQueue.current.length && channel.current?.readyState === "open")
        void drainQueue();
    }
  }, [sendBatch, updateTransfer]);

  const attachChannel = useCallback(
    (dc: RTCDataChannel) => {
      channel.current = dc;
      browserLog.info("datachannel.created", { label: dc.label });
      dc.binaryType = "arraybuffer";
      dc.onopen = () => {
        browserLog.info("datachannel.open", { label: dc.label });
        if (mounted.current) setPhase("connected");
        dc.send(
          JSON.stringify({ type: "device-info", name: localDeviceLabel() }),
        );
        void drainQueue();
      };
      dc.onclose = () => {
        browserLog.warn("datachannel.closed", {
          label: dc.label,
          bufferedBytes: dc.bufferedAmount,
        });
        if (mounted.current) {
          setPeerName("");
          setPhase((current) => (current === "error" ? current : "idle"));
        }
      };
      let receiveQueue = Promise.resolve();
      dc.onmessage = (event) => {
        receiveQueue = receiveQueue
          .then(async () => {
            if (typeof event.data !== "string") {
              const part = event.data as ArrayBuffer;
              const current = activeTransfer.current;
              if (
                !current ||
                receiverBytes.current + part.byteLength > current.size
              ) {
                browserLog.error("transfer.receive.invalid-chunk", {
                  chunkBytes: part.byteLength,
                  receivedBytes: receiverBytes.current,
                  expectedBytes: current?.size,
                });
                setError(labels.errors.invalidChunk);
                dc.close();
                return;
              }
              if (receiverWriter.current)
                await receiverWriter.current.write(new Uint8Array(part));
              else receiverParts.current.push(part);
              receiverBytes.current += part.byteLength;
              if (
                receiverBytes.current === part.byteLength ||
                receiverBytes.current % (1024 * 1024) < part.byteLength
              )
                browserLog.info("transfer.receive.progress", {
                  receivedBytes: receiverBytes.current,
                  expectedBytes: current.size,
                });
              if (activeTransfer.current)
                updateTransfer(activeTransfer.current.name, {
                  received: receiverBytes.current,
                  status: "transferring",
                });
              return;
            }
            let message: Wire;
            try {
              message = JSON.parse(event.data) as Wire;
            } catch {
              return;
            }
            if (
              message.type === "batch-offer" &&
              typeof message.id === "string" &&
              Array.isArray(message.files)
            ) {
              const batchFiles = message.files.filter(
                (f): f is { name: string; size: number } =>
                  !!f &&
                  typeof f.name === "string" &&
                  Number.isSafeInteger(f.size) &&
                  Number(f.size) >= 0,
              );
              if (
                !batchFiles.length ||
                batchFiles.length !== message.files.length ||
                batchFiles.length > 100
              )
                return;
              setIncoming({
                id: message.id,
                name:
                  batchFiles.length === 1
                    ? batchFiles[0].name
                    : `${batchFiles.length} files`,
                size: batchFiles.reduce((sum, file) => sum + file.size, 0),
                type: "",
                batchFiles,
              });
            } else if (
              message.type === "device-info" &&
              typeof message.name === "string"
            ) {
              setPeerName(message.name.slice(0, 40));
              browserLog.info("peer.device-info.received", {
                deviceType: message.name.slice(0, 40),
              });
            } else if (
              message.type === "file-offer" &&
              typeof message.id === "string" &&
              typeof message.name === "string" &&
              Number.isSafeInteger(message.size) &&
              Number(message.size) >= 0 &&
              Number(message.size) <= 50 * 1024 ** 3
            ) {
              const offer = {
                id: message.id,
                name: message.name.replace(/[\\/\0]/g, "_").slice(0, 240),
                size: Number(message.size),
                type:
                  typeof message.mime === "string"
                    ? message.mime.slice(0, 120)
                    : "application/octet-stream",
              };
              activeTransfer.current = offer;
              browserLog.info("transfer.offer.received", {
                sizeBytes: offer.size,
                mimeType: offer.type,
              });
              receiverParts.current = [];
              receiverBytes.current = 0;
              if (
                typeof message.batchId === "string" &&
                approvedBatches.current.has(message.batchId)
              ) {
                if (
                  offer.size > fallbackLimit &&
                  !("showSaveFilePicker" in window)
                ) {
                  dc.send(
                    JSON.stringify({ type: "file-rejected", id: offer.id }),
                  );
                  activeTransfer.current = null;
                  return;
                }
                dc.send(
                  JSON.stringify({
                    type: "file-accepted",
                    id: offer.id,
                    batchId: message.batchId,
                  }),
                );
                updateTransfer(offer.name, { status: "transferring" });
              } else setIncoming(offer);
              updateTransfer(offer.name, {
                size: offer.size,
                direction: "receive",
                received: 0,
                status: "waiting",
              });
            } else if (
              message.type === "file-complete" &&
              activeTransfer.current?.id === message.id
            ) {
              const offer = activeTransfer.current;
              if (!offer) return;
              if (receiverBytes.current !== offer.size) {
                const reason = interpolate(labels.errors.incompleteTransfer, {
                  received: receiverBytes.current,
                  size: offer.size,
                });
                setError(reason);
                browserLog.error("transfer.receive.incomplete", {
                  receivedBytes: receiverBytes.current,
                  expectedBytes: offer.size,
                });
                updateTransfer(offer.name, { status: "error" });
                dc.send(
                  JSON.stringify({ type: "file-failed", id: offer.id, reason }),
                );
                activeTransfer.current = null;
                return;
              }
              if (receiverWriter.current) {
                await receiverWriter.current.close();
                receiverWriter.current = null;
              } else {
                const blob = new Blob(receiverParts.current, {
                  type: offer.type,
                });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = offer.name;
                link.click();
                window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
              }
              updateTransfer(offer.name, {
                status: "complete",
                received: offer.size,
              });
              browserLog.info("transfer.receive.complete", {
                sizeBytes: offer.size,
              });
              dc.send(JSON.stringify({ type: "file-received", id: offer.id }));
              activeTransfer.current = null;
            }
          })
          .catch((reason: unknown) => {
            const message =
              reason instanceof Error
                ? reason.message
                : labels.errors.incomingWriteFailed;
            setError(message);
            browserLog.error("transfer.receive.failed", { message });
            if (activeTransfer.current) {
              updateTransfer(activeTransfer.current.name, { status: "error" });
              dc.send(
                JSON.stringify({
                  type: "file-failed",
                  id: activeTransfer.current.id,
                  reason: message,
                }),
              );
            }
            dc.close();
          });
      };
    },
    [drainQueue, updateTransfer],
  );

  const setupPeer = useCallback(
    (role: "sender" | "receiver") => {
      browserLog.info("webrtc.peer-created", { role });
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      peer.current = pc;
      pc.onicecandidate = (event) => {
        if (event.candidate)
          sendSignal({ candidate: event.candidate.toJSON() });
      };
      pc.onconnectionstatechange = () => {
        browserLog.info("webrtc.connection-state", {
          role,
          state: pc.connectionState,
          iceState: pc.iceConnectionState,
        });
        if (pc.connectionState === "connected" && mounted.current)
          setPhase("connected");
        if (
          ["failed", "disconnected"].includes(pc.connectionState) &&
          mounted.current
        ) {
          setPhase("error");
          setError(labels.errors.connectionInterrupted);
        }
      };
      if (role === "sender")
        attachChannel(pc.createDataChannel("drop-files", { ordered: true }));
      else pc.ondatachannel = (event) => attachChannel(event.channel);
      return pc;
    },
    [attachChannel, sendSignal],
  );

  const connectSocket = useCallback(
    (onMessage: (message: Wire) => void) => {
      cleanup();
      setError("");
      setPhase("connecting");
      browserLog.info("signaling.connecting", {
        transport: location.protocol === "https:" ? "wss" : "ws",
        endpointSource: import.meta.env.VITE_SIGNALING_URL
          ? "configured"
          : "page-host",
      });
      const ws = new WebSocket(signalUrl());
      socket.current = ws;
      ws.onmessage = (event) => {
        let message: Wire;
        try {
          message = JSON.parse(event.data) as Wire;
        } catch {
          return;
        }
        browserLog.info("signaling.message.received", {
          type: message.type,
        });
        onMessage(message);
      };
      ws.onerror = () => {
        if (!mounted.current) return;
        const endpoint = signalUrl();
        const hint =
          location.protocol === "https:"
            ? labels.errors.tlsHint
            : labels.errors.lanHint;
        setPhase("error");
        setError(
          interpolate(labels.errors.signalingUnreachable, { endpoint, hint }),
        );
        browserLog.error("signaling.connection.failed", {
          endpoint,
          pageProtocol: location.protocol,
        });
      };
      ws.onclose = (event) => {
        browserLog.warn("signaling.connection.closed", {
          code: event.code,
          reason: event.reason || "none",
        });
        if (mounted.current)
          setPhase((current) => (current === "error" ? "error" : "idle"));
      };
      return ws;
    },
    [cleanup],
  );

  const createRoom = useCallback(() => {
    browserLog.info("pairing.room.create-requested");
    setRoomLink("");
    setQr("");
    setPairCode("");
    const ws = connectSocket((message) => {
      if (
        message.type === "created" &&
        typeof message.roomId === "string" &&
        typeof message.token === "string"
      ) {
        browserLog.info("pairing.room.created", {
          expiresAt: message.expiresAt as number | undefined,
        });
        const url = new URL(location.href);
        url.search = new URLSearchParams({
          room: message.roomId,
          token: message.token,
        }).toString();
        const link = url.toString();
        setRoomLink(link);
        setPairCode(`${message.roomId}.${message.token}`);
        void QRCode.toDataURL(link, {
          margin: 1,
          width: 220,
          color: { dark: "#24252b", light: "#ffffff" },
        }).then(setQr);
        setPhase("waiting");
      } else if (message.type === "peer-joined") {
        browserLog.info("pairing.peer-joined", { role: "sender" });
        const pc = setupPeer("sender");
        void pc
          .createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() =>
            sendSignal({ description: pc.localDescription?.toJSON() }),
          );
      } else if (message.type === "signal") {
        const payload = message.payload as
          | {
              candidate?: RTCIceCandidateInit;
              description?: RTCSessionDescriptionInit;
            }
          | undefined;
        if (payload?.candidate)
          void peer.current?.addIceCandidate(payload.candidate);
        if (payload?.candidate)
          browserLog.info("signaling.ice-candidate.received");
        if (payload?.description?.type === "answer") {
          browserLog.info("signaling.description.received", {
            descriptionType: "answer",
          });
          void peer.current?.setRemoteDescription(payload.description);
        }
      } else if (
        message.type === "peer-left" ||
        message.type === "room-closed"
      ) {
        browserLog.warn("pairing.peer-disconnected", {
          reason: message.type === "room-closed" ? "room-closed" : "peer-left",
        });
        setPhase("idle");
        setError(
          message.type === "room-closed"
            ? labels.errors.roomExpired
            : labels.errors.otherDeviceDisconnected,
        );
      } else if (message.type === "error" && typeof message.code === "string") {
        browserLog.error("pairing.server-error", { code: message.code });
        setPhase("error");
        setError(serverErrorMessage(message.code));
      }
    });
    ws.onopen = () => {
      browserLog.info("signaling.connected");
      ws.send(JSON.stringify({ type: "create" }));
    };
  }, [connectSocket, sendSignal, setupPeer]);

  const joinRoom = useCallback(
    (input: string) => {
      let roomId = "";
      let token = "";
      try {
        const url = new URL(
          input.startsWith("http")
            ? input
            : `${location.origin}/?pair=${encodeURIComponent(input)}`,
        );
        roomId = url.searchParams.get("room") ?? "";
        token = url.searchParams.get("token") ?? "";
        if (input.includes(".") && !roomId)
          [roomId, token] = input.split(".", 2);
      } catch {
        [roomId, token] = input.split(".", 2);
      }
      if (!roomId || !token) {
        browserLog.warn("pairing.join.invalid-code");
        setError(labels.errors.invalidPairingCode);
        setPhase("error");
        return;
      }
      browserLog.info("pairing.join.requested");
      const ws = connectSocket((message) => {
        if (message.type === "peer-joined") {
          browserLog.info("pairing.peer-joined", { role: "receiver" });
          setPhase("connecting");
          setupPeer("receiver");
        } else if (message.type === "signal") {
          const payload = message.payload as
            | {
                candidate?: RTCIceCandidateInit;
                description?: RTCSessionDescriptionInit;
              }
            | undefined;
          if (!payload) return;
          if (payload.description?.type === "offer") {
            browserLog.info("signaling.description.received", {
              descriptionType: "offer",
            });
            const pc = peer.current ?? setupPeer("receiver");
            void pc
              .setRemoteDescription(payload.description)
              .then(() => pc.createAnswer())
              .then((answer) => pc.setLocalDescription(answer))
              .then(() =>
                sendSignal({ description: pc.localDescription?.toJSON() }),
              );
          } else if (payload.candidate) {
            browserLog.info("signaling.ice-candidate.received");
            void peer.current?.addIceCandidate(payload.candidate);
          }
        } else if (
          message.type === "error" &&
          typeof message.code === "string"
        ) {
          browserLog.error("pairing.server-error", { code: message.code });
          setPhase("error");
          setError(serverErrorMessage(message.code));
        } else if (
          message.type === "peer-left" ||
          message.type === "room-closed"
        ) {
          browserLog.warn("pairing.peer-disconnected", {
            reason:
              message.type === "room-closed" ? "room-closed" : "peer-left",
          });
          setPhase("idle");
          setError(labels.errors.otherDeviceDisconnected);
        }
      });
      ws.onopen = () => {
        browserLog.info("signaling.connected");
        ws.send(JSON.stringify({ type: "join", roomId, token }));
      };
    },
    [connectSocket, sendSignal, setupPeer],
  );

  const sendFiles = useCallback(
    (files: File[]) => {
      browserLog.info("transfer.queue.added", {
        fileCount: files.length,
        totalBytes: files.reduce((total, file) => total + file.size, 0),
      });
      sendQueue.current.push(files);
      void drainQueue();
    },
    [drainQueue],
  );

  const respondToIncoming = useCallback(
    async (accept: boolean) => {
      const offer = incoming;
      const dc = channel.current;
      if (!offer || !dc) return;
      setIncoming(null);
      if (offer.batchFiles) {
        dc.send(
          JSON.stringify({
            type: accept ? "batch-accepted" : "batch-rejected",
            id: offer.id,
          }),
        );
        if (accept) approvedBatches.current.add(offer.id);
        return;
      }
      if (!accept) {
        browserLog.info("transfer.offer.declined", { sizeBytes: offer.size });
        dc.send(JSON.stringify({ type: "file-rejected", id: offer.id }));
        updateTransfer(offer.name, { status: "rejected" });
        activeTransfer.current = null;
        return;
      }
      if (offer.size > fallbackLimit && !("showSaveFilePicker" in window)) {
        browserLog.warn("transfer.offer.rejected", {
          reason: "browser-memory-limit",
          sizeBytes: offer.size,
        });
        setError(labels.errors.oversizeFallback);
        dc.send(JSON.stringify({ type: "file-rejected", id: offer.id }));
        updateTransfer(offer.name, { status: "rejected" });
        activeTransfer.current = null;
        return;
      }
      try {
        const savePicker = (
          window as Window & {
            showSaveFilePicker?: (options: {
              suggestedName: string;
            }) => Promise<FileSystemFileHandle>;
          }
        ).showSaveFilePicker;
        if (savePicker) {
          const handle = await savePicker({ suggestedName: offer.name });
          receiverWriter.current = await handle.createWritable();
        }
        dc.send(JSON.stringify({ type: "file-accepted", id: offer.id }));
        browserLog.info("transfer.offer.accepted", { sizeBytes: offer.size });
        updateTransfer(offer.name, { status: "transferring" });
      } catch {
        browserLog.warn("transfer.offer.save-cancelled", {
          sizeBytes: offer.size,
        });
        browserLog.warn("transfer.offer.save-cancelled", {
          sizeBytes: offer.size,
        });
        dc.send(JSON.stringify({ type: "file-rejected", id: offer.id }));
        updateTransfer(offer.name, { status: "rejected" });
        activeTransfer.current = null;
      }
    },
    [incoming, updateTransfer],
  );

  useEffect(() => {
    mounted.current = true;
    const url = new URL(location.href);
    const room = url.searchParams.get("room");
    const token = url.searchParams.get("token");
    const autoJoin =
      room && token
        ? window.setTimeout(
            () =>
              joinRoom(
                `${location.origin}/?room=${encodeURIComponent(room)}&token=${encodeURIComponent(token)}`,
              ),
            0,
          )
        : undefined;
    return () => {
      if (autoJoin) window.clearTimeout(autoJoin);
      mounted.current = false;
      cleanup();
    };
  }, [cleanup, joinRoom]);

  return {
    phase,
    roomLink,
    qr,
    pairCode,
    peerName,
    incoming,
    transfers,
    error,
    createRoom,
    joinRoom,
    sendFiles,
    respondToIncoming,
  };
}
