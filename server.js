// server.js — ES Module version

import express from "express";
import http from "http";
import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  path: "/socket.io",
});

const rooms = {}; // roomCode -> { hostId, players[], buzzQueue[], locked, teamQueues, teamScores }

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function emitRoom(roomCode) {
  const room = rooms[roomCode];
  if (room) io.to(roomCode).emit("room_state", room);
}

// --- Socket.io ---
io.on("connection", (socket) => {
  console.log("New connection", socket.id);

  socket.on("create_room", ({ hostName }, cb) => {
    const code = generateRoomCode();
    rooms[code] = {
      roomCode: code,
      hostId: socket.id,
      players: [{ id: socket.id, name: hostName, team: null, score: 0 }],
      buzzQueue: [],
      locked: true,
      teamQueues: { tipsy: [], wobbly: [] },
      currentHotSeats: { tipsy: null, wobbly: null },
      teamScores: { tipsy: 0, wobbly: 0 },
      countdownActive: false,
    };
    socket.join(code);
    cb({ ok: true, roomCode: code });
    emitRoom(code);
  });

  socket.on("join_room", ({ roomCode, name }, cb) => {
    const room = rooms[roomCode];
    if (!room) return cb({ ok: false, error: "Room not found" });
    room.players.push({ id: socket.id, name, team: null, score: 0 });
    socket.join(roomCode);
    cb({ ok: true });
    emitRoom(roomCode);
  });

  socket.on("assign_team", ({ roomCode, playerId, team }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find((p) => p.id === playerId);
    if (player) {
      player.team = team;
      if (!room.teamQueues[team].includes(playerId)) {
        room.teamQueues[team].push(playerId);
      }
      emitRoom(roomCode);
    }
  });

  socket.on("start_game", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const tipsyHot = room.teamQueues.tipsy[0] || null;
    const wobblyHot = room.teamQueues.wobbly[0] || null;
    room.currentHotSeats = { tipsy: tipsyHot, wobbly: wobblyHot };

    room.locked = true;
    room.buzzQueue = [];
    emitRoom(roomCode);
  });

  socket.on("next_round", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    if (room.teamQueues.tipsy.length > 0) {
      room.teamQueues.tipsy.push(room.teamQueues.tipsy.shift());
    }
    if (room.teamQueues.wobbly.length > 0) {
      room.teamQueues.wobbly.push(room.teamQueues.wobbly.shift());
    }

    room.currentHotSeats = {
      tipsy: room.teamQueues.tipsy[0] || null,
      wobbly: room.teamQueues.wobbly[0] || null,
    };

    room.locked = true;
    room.buzzQueue = [];
    room.countdownActive = false;
    emitRoom(roomCode);
  });

  socket.on("clear_buzzers", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;
    room.buzzQueue = [];
    emitRoom(roomCode);
  });

  socket.on("adjust_score", ({ roomCode, playerId, delta }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find((p) => p.id === playerId);
    if (player) {
      player.score += delta;
      if (player.team) {
        room.teamScores[player.team] += delta;
      }
    }
    emitRoom(roomCode);
  });

  socket.on("buzz", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    if (room.locked) return;
    if (room.buzzQueue.includes(socket.id)) return;

    room.buzzQueue.push(socket.id);

    if (
      socket.id === room.currentHotSeats.tipsy ||
      socket.id === room.currentHotSeats.wobbly
    ) {
      room.countdownActive = true;
      room.locked = true;
      emitRoom(roomCode);

      setTimeout(() => {
        room.locked = false;
        room.countdownActive = false;
        emitRoom(roomCode);
      }, 15000);
    }

    emitRoom(roomCode);
  });

  socket.on("disconnect", () => {
    for (const code in rooms) {
      const room = rooms[code];
      room.players = room.players.filter((p) => p.id !== socket.id);
      room.teamQueues.tipsy = room.teamQueues.tipsy.filter(
        (id) => id !== socket.id
      );
      room.teamQueues.wobbly = room.teamQueues.wobbly.filter(
        (id) => id !== socket.id
      );
      if (room.hostId === socket.id) {
        delete rooms[code];
      } else {
        emitRoom(code);
      }
    }
  });
});

app.use(express.static("dist"));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on", PORT));
