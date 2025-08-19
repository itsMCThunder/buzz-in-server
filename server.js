import express from "express";
import http from "http";
import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = {};

// Helper to send room updates
function emitRoom(roomCode) {
  const room = rooms[roomCode];
  if (room) {
    io.to(roomCode).emit("room_update", room);
  }
}

io.on("connection", (socket) => {
  console.log("New connection:", socket.id);

  socket.on("create_room", ({ hostName }, cb) => {
    const roomCode = uuidv4().slice(0, 5).toUpperCase();
    rooms[roomCode] = {
      hostId: socket.id,
      players: [{ id: socket.id, name: hostName, team: null, score: 0 }],
    };
    socket.join(roomCode);
    cb({ ok: true, roomCode });
    emitRoom(roomCode);
  });

  socket.on("join_room", ({ roomCode, name }, cb) => {
    const room = rooms[roomCode];
    if (!room) return cb({ ok: false, error: "Room not found" });
    room.players.push({ id: socket.id, name, team: null, score: 0 });
    socket.join(roomCode);
    cb({ ok: true });
    emitRoom(roomCode);
  });

  socket.on("award_points", ({ roomCode, playerId, delta }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (socket.id !== room.hostId) return; // only host can award

    const player = room.players.find((p) => p.id === playerId);
    if (player) {
      player.score += delta;
      emitRoom(roomCode);
    }
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
    for (const [roomCode, room] of Object.entries(rooms)) {
      room.players = room.players.filter((p) => p.id !== socket.id);
      emitRoom(roomCode);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
