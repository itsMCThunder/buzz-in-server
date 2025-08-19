// server.js (ESM) — Buzz-In backend for Render

import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const app = express();
app.use(cors({ origin: "*" }));

// Health check
app.get("/health", (_req, res) => res.send("ok"));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  path: "/socket.io",
  transports: ["websocket", "polling"],
});

// ------------ In-memory room state ------------
const rooms = new Map(); // roomCode -> {roomCode, hostId, hostName, players[], buzzQueue[], locked, showScores}

function code4() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join("");
}
function teamTotals(room) {
  const t = { tipsy: 0, wobbly: 0 };
  for (const p of room.players) {
    if (p.team === "tipsy") t.tipsy += p.score || 0;
    if (p.team === "wobbly") t.wobbly += p.score || 0;
  }
  return t;
}
function emitState(roomCode) {
  const r = rooms.get(roomCode);
  if (!r) return;
  io.to(roomCode).emit("room_state", {
    roomCode: r.roomCode,
    hostId: r.hostId,
    players: r.players,
    buzzQueue: r.buzzQueue,
    locked: r.locked,
    showScores: r.showScores,
    teamScores: teamTotals(r),
  });
}

// ------------ Socket handlers ------------
io.on("connection", (socket) => {
  socket.data.roomCode = null;
  socket.data.name = null;

  socket.on("create_room", ({ hostName }, ack) => {
    try {
      let code = code4();
      while (rooms.has(code)) code = code4();
      const room = {
        roomCode: code,
        hostId: socket.id,
        hostName: hostName || "Host",
        players: [{ id: socket.id, name: hostName || "Host", score: 0, team: null }],
        buzzQueue: [],
        locked: false,
        showScores: false,
      };
      rooms.set(code, room);
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.name = hostName || "Host";
      emitState(code);
      ack && ack({ ok: true, roomCode: code });
    } catch {
      ack && ack({ ok: false, error: "Failed to create room" });
    }
  });

  socket.on("join_room", ({ roomCode, name }, ack) => {
    const code = (roomCode || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return ack && ack({ ok: false, error: "Room not found" });
    if (!room.players.find((p) => p.id === socket.id)) {
      room.players.push({ id: socket.id, name: name || "Player", score: 0, team: null });
    }
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.name = name || "Player";
    emitState(code);
    ack && ack({ ok: true });
  });

  socket.on("buzz", ({ roomCode }) => {
    const code = (roomCode || socket.data.roomCode || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room || room.locked) return;
    if (!room.players.find((p) => p.id === socket.id)) return;
    if (!room.buzzQueue.includes(socket.id)) {
      room.buzzQueue.push(socket.id);
      emitState(code);
    }
  });

  socket.on("clear_buzzers", ({ roomCode }) => {
    const code = (roomCode || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    room.buzzQueue = [];
    room.showScores = false;
    emitState(code);
  });

  socket.on("lock_buzzers", ({ roomCode, locked }) => {
    const code = (roomCode || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    room.locked = !!locked;
    emitState(code);
  });

  // Handle score adjustment from host
socket.on("adjust_score", ({ roomCode, playerId, delta }) => {
  const room = rooms[roomCode];
  if (!room) return;

  const player = room.players.find((p) => p.id === playerId);
  if (!player) return;

  // Update player score
  player.score = (player.score || 0) + delta;

  // Update team totals if assigned
  if (player.team) {
    if (!room.teamScores) {
      room.teamScores = { tipsy: 0, wobbly: 0 };
    }
    room.teamScores[player.team] =
      (room.teamScores[player.team] || 0) + delta;
  }

  // Send update to everyone in the room
  io.to(roomCode).emit("room_update", room);
});


  socket.on("next_question", ({ roomCode }) => {
    const code = (roomCode || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    room.showScores = false;
    room.buzzQueue = [];
    emitState(code);
  });

  socket.on("assign_team", ({ roomCode, playerId, team }, ack) => {
    const code = (roomCode || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return ack && ack({ ok: false, error: "Not allowed" });
    const p = room.players.find((x) => x.id === playerId);
    if (!p) return ack && ack({ ok: false, error: "Player not found" });
    p.team = team ?? null;
    emitState(code);
    ack && ack({ ok: true });
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    room.players = room.players.filter((p) => p.id !== socket.id);
    room.buzzQueue = room.buzzQueue.filter((id) => id !== socket.id);
    if (room.hostId === socket.id) {
      if (room.players.length === 0) rooms.delete(code);
      else room.hostId = room.players[0].id;
    }
    if (rooms.has(code)) emitState(code);
  });
});

// PORT from Render
const PORT = process.env.PORT || 5175;
server.listen(PORT, "0.0.0.0", () => {
  console.log("Buzz server listening on port", PORT);
});
