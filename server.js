import express from "express";
import http from "http";
import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  pingInterval: 25000,   // keep sockets alive
  pingTimeout: 180000,   // allow 3 minutes idle before disconnect
});

const PORT = process.env.PORT || 3001;

// In-memory rooms (could later use SQLite if persistence is needed)
let rooms = {};

// Utility: broadcast room state
const emitRoom = (roomCode) => {
  const room = rooms[roomCode];
  if (room) {
    io.to(roomCode).emit("room_update", room);
  }
};

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // Create a room
  socket.on("create_room", ({ hostName }, cb) => {
    const roomCode = uuidv4().slice(0, 4).toUpperCase();
    rooms[roomCode] = {
      code: roomCode,
      hostId: socket.id,
      players: [{ id: socket.id, name: hostName, team: null, score: 0 }],
      hotseatQueue: [],
    };
    socket.join(roomCode);
    cb({ ok: true, roomCode });
    emitRoom(roomCode);
  });

  // Join room
  socket.on("join_room", ({ roomCode, name }, cb) => {
    const room = rooms[roomCode];
    if (!room) return cb({ ok: false, error: "Room not found" });

    room.players.push({ id: socket.id, name, team: null, score: 0 });
    socket.join(roomCode);
    cb({ ok: true });
    emitRoom(roomCode);
  });

  // Assign team (host only)
  socket.on("assign_team", ({ roomCode, playerId, team }) => {
    const room = rooms[roomCode];
    if (!room || socket.id !== room.hostId) return;
    const player = room.players.find((p) => p.id === playerId);
    if (player) player.team = team;
    emitRoom(roomCode);
  });

  // Award points (host only)
  socket.on("award_points", ({ roomCode, playerId, delta }) => {
    const room = rooms[roomCode];
    if (!room || socket.id !== room.hostId) return;
    const player = room.players.find((p) => p.id === playerId);
    if (player) player.score += delta;
    emitRoom(roomCode);
  });

  // Buzz in
  socket.on("buzz", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;
    io.to(roomCode).emit("player_buzzed", { playerId: socket.id });
  });

  // Disconnect
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    for (const code in rooms) {
      const room = rooms[code];
      room.players = room.players.filter((p) => p.id !== socket.id);

      // if host left, delete the room
      if (room.hostId === socket.id) {
        delete rooms[code];
      } else {
        emitRoom(code);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
