import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

// In-memory room store
const rooms = {};

// Built-in room code generator (no uuid needed)
const generateRoomCode = () =>
  Math.random().toString(36).substring(2, 6).toUpperCase();

// Helper: emit full room state
function emitRoom(roomCode) {
  const room = rooms[roomCode];
  if (room) {
    io.to(roomCode).emit("room_update", room);
  }
}

// Handle socket connections
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // Create a new game room
  socket.on("create_room", ({ hostName }, cb) => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      hostId: socket.id,
      hostName,
      players: [],
      buzzed: null,
    };
    socket.join(roomCode);
    cb({ ok: true, roomCode });
    emitRoom(roomCode);
  });

  // Join existing room
  socket.on("join_room", ({ roomCode, name }, cb) => {
    const room = rooms[roomCode];
    if (!room) return cb({ ok: false, error: "Room not found" });

    room.players.push({ id: socket.id, name, team: null, score: 0 });
    socket.join(roomCode);
    cb({ ok: true });
    emitRoom(roomCode);
  });

  // Buzz in
  socket.on("buzz", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.buzzed) return;
    room.buzzed = socket.id;
    emitRoom(roomCode);
  });

  // Award points (only host)
  socket.on("award_points", ({ roomCode, playerId, points }) => {
    const room = rooms[roomCode];
    if (!room || socket.id !== room.hostId) return;

    const player = room.players.find((p) => p.id === playerId);
    if (player) {
      player.score += points;
      room.buzzed = null;
      emitRoom(roomCode);
    }
  });

  // Reset buzz
  socket.on("reset_buzz", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || socket.id !== room.hostId) return;

    room.buzzed = null;
    emitRoom(roomCode);
  });

  // Disconnect
  socket.on("disconnect", () => {
    for (const [roomCode, room] of Object.entries(rooms)) {
      if (room.hostId === socket.id) {
        delete rooms[roomCode];
        io.to(roomCode).emit("room_closed");
      } else {
        room.players = room.players.filter((p) => p.id !== socket.id);
        emitRoom(roomCode);
      }
    }
    console.log("Client disconnected:", socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
