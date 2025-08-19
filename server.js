import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { nanoid } from "nanoid";
import {
  createRoom,
  getRoom,
  deleteRoom,
  addPlayer,
  getPlayers,
  updatePlayerScore,
  updatePlayerTeam,
  removePlayer
} from "./db.js";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const PORT = process.env.PORT || 3001;

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // --- Create Room ---
  socket.on("create_room", ({ hostName }, cb) => {
    const code = nanoid(6).toUpperCase();
    createRoom(code, socket.id);
    addPlayer(socket.id, hostName, code); // host as player too
    socket.join(code);
    cb({ ok: true, roomCode: code });
    emitRoom(code);
  });

  // --- Join Room ---
  socket.on("join_room", ({ roomCode, name }, cb) => {
    const room = getRoom(roomCode);
    if (!room) return cb({ ok: false, error: "Room not found" });
    addPlayer(socket.id, name, roomCode);
    socket.join(roomCode);
    cb({ ok: true });
    emitRoom(roomCode);
  });

  // --- Update Score ---
  socket.on("update_score", ({ playerId, score }) => {
    updatePlayerScore(playerId, score);
    const roomPlayers = getPlayersByPlayerId(playerId);
    if (roomPlayers?.roomCode) emitRoom(roomPlayers.roomCode);
  });

  // --- Assign Team ---
  socket.on("assign_team", ({ playerId, team }) => {
    updatePlayerTeam(playerId, team);
    const roomPlayers = getPlayersByPlayerId(playerId);
    if (roomPlayers?.roomCode) emitRoom(roomPlayers.roomCode);
  });

  // --- Disconnect ---
  socket.on("disconnect", () => {
    removePlayer(socket.id);
    io.sockets.sockets.forEach((s) => {
      if (s.rooms) {
        s.rooms.forEach((roomCode) => emitRoom(roomCode));
      }
    });
    console.log("Client disconnected:", socket.id);
  });
});

// --- Helper: Emit Full Room State ---
function emitRoom(roomCode) {
  const players = getPlayers(roomCode);
  io.to(roomCode).emit("room_update", { players });
}

httpServer.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
