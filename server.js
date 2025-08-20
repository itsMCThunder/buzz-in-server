// server.js
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

const rooms = {};

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Create room (host)
  socket.on("create_room", ({ hostName }, callback) => {
    const roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    rooms[roomCode] = {
      hostId: socket.id,
      players: [{ id: socket.id, name: hostName, score: 0 }],
      buzzed: null,
    };
    socket.join(roomCode);
    callback({ ok: true, roomCode });
    io.to(roomCode).emit("room_update", rooms[roomCode]);
  });

  // Join room (player)
  socket.on("join_room", ({ roomCode, name }, callback) => {
    if (!rooms[roomCode]) return callback({ ok: false, error: "Room not found" });
    rooms[roomCode].players.push({ id: socket.id, name, score: 0 });
    socket.join(roomCode);
    callback({ ok: true });
    io.to(roomCode).emit("room_update", rooms[roomCode]);
  });

  // Player buzz
  socket.on("buzz", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (room && !room.buzzed) {
      room.buzzed = socket.id;
      io.to(roomCode).emit("room_update", room);
    }
  });

  // Award points (host only)
  socket.on("award_points", ({ roomCode, playerId, points }) => {
    const room = rooms[roomCode];
    if (room && room.hostId === socket.id) {
      const player = room.players.find((p) => p.id === playerId);
      if (player) player.score += points;
      io.to(roomCode).emit("room_update", room);
    }
  });

  // Reset buzz (host only)
  socket.on("reset_buzz", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (room && room.hostId === socket.id) {
      room.buzzed = null;
      io.to(roomCode).emit("room_update", room);
    }
  });

  // Disconnect handling
  socket.on("disconnect", () => {
    for (const [code, room] of Object.entries(rooms)) {
      room.players = room.players.filter((p) => p.id !== socket.id);

      if (room.hostId === socket.id) {
        io.to(code).emit("room_closed");
        delete rooms[code];
      } else {
        io.to(code).emit("room_update", room);
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
