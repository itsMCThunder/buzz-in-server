// server.js (ESM) — Buzz-In backend with Hot Seat mechanic

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
const rooms = new Map(); // roomCode -> {roomCode, hostId, players[], buzzQueue[], locked, showScores, hotSeatQueue, currentHotSeats, countdownActive}

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
    currentHotSeats: r.currentHotSeats || {},
    countdownActive: r.countdownActive || false,
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
        hotSeatQueue: { tipsy: [], wobbly: [] },
        currentHotSeats: {},
        countdownActive: false,
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

  // Assign teams
  socket.on("assign_team", ({ roomCode, playerId, team }, ack) => {
    const room = rooms.get((roomCode || "").toUpperCase().trim());
    if (!room || room.hostId !== socket.id) return ack && ack({ ok: false, error: "Not allowed" });
    const p = room.players.find((x) => x.id === playerId);
    if (!p) return ack && ack({ ok: false, error: "Player not found" });
    p.team = team ?? null;
    emitState(roomCode);
    ack && ack({ ok: true });
  });

  // Start game -> initialize hot seat queues
  socket.on("start_game", ({ roomCode }) => {
    const room = rooms.get((roomCode || "").toUpperCase().trim());
    if (!room || room.hostId !== socket.id) return;

    room.hotSeatQueue = { tipsy: [], wobbly: [] };
    for (const p of room.players) {
      if (p.team === "tipsy") room.hotSeatQueue.tipsy.push(p.id);
      if (p.team === "wobbly") room.hotSeatQueue.wobbly.push(p.id);
    }

    room.currentHotSeats = {
      tipsy: room.hotSeatQueue.tipsy.shift() || null,
      wobbly: room.hotSeatQueue.wobbly.shift() || null,
    };
    room.locked = false;
    room.countdownActive = false;

    emitState(roomCode);
  });

  // Buzz logic (hot seat + countdown)
  socket.on("buzz", ({ roomCode }) => {
    const code = (roomCode || socket.data.roomCode || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room || room.locked) return;
    if (!room.players.find((p) => p.id === socket.id)) return;

    const { tipsy, wobbly } = room.currentHotSeats || {};
    const isHotSeat = socket.id === tipsy || socket.id === wobbly;

    if (isHotSeat && !room.countdownActive) {
      // Hot seat buzz -> lock everyone, start countdown
      room.buzzQueue.push(socket.id);
      room.locked = true;
      room.countdownActive = true;
      emitState(code);

      setTimeout(() => {
        room.locked = false; // unlock after 15s
        room.countdownActive = false;
        emitState(code);
      }, 15000);
    } else if (!room.countdownActive && !room.buzzQueue.includes(socket.id)) {
      // Allow buzz after countdown
      room.buzzQueue.push(socket.id);
      emitState(code);
    }
  });

  // Next round -> rotate next hot seat players
  socket.on("next_round", ({ roomCode }) => {
    const room = rooms.get((roomCode || "").toUpperCase().trim());
    if (!room || room.hostId !== socket.id) return;

    room.buzzQueue = [];
    room.showScores = false;

    room.currentHotSeats = {
      tipsy: room.hotSeatQueue.tipsy.shift() || null,
      wobbly: room.hotSeatQueue.wobbly.shift() || null,
    };
    room.locked = false;
    room.countdownActive = false;

    emitState(roomCode);
  });

  // Clear buzzers
  socket.on("clear_buzzers", ({ roomCode }) => {
    const room = rooms.get((roomCode || "").toUpperCase().trim());
    if (!room || room.hostId !== socket.id) return;
    room.buzzQueue = [];
    room.showScores = false;
    emitState(roomCode);
  });

  // Score adjustment
  socket.on("adjust_score", ({ roomCode, playerId, delta }) => {
    const room = rooms.get((roomCode || "").toUpperCase().trim());
    if (!room) return;
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return;

    player.score = (player.score || 0) + delta;
    emitState(roomCode);
  });

  // Disconnect
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
