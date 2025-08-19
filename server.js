import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { nanoid } from "nanoid";

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const rooms = {}; // { roomCode: { hostId, players: [] } }

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Create a room
  socket.on("create_room", ({ hostName }, cb) => {
    const roomCode = nanoid(4).toUpperCase();
    rooms[roomCode] = {
      hostId: socket.id,
      players: [{ id: socket.id, name: hostName, team: null, score: 0 }],
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
    cb({ ok: true, roomCode });
    emitRoom(roomCode);
  });

  // Assign player to a team
  socket.on("assign_team", ({ roomCode, playerId, team }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find((p) => p.id === playerId);
    if (player) player.team = team;
    emitRoom(roomCode);
  });

  // Update a player’s score
  socket.on("update_score", ({ roomCode, playerId, delta }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find((p) => p.id === playerId);
    if (player) player.score += delta;
    emitRoom(roomCode);
  });

  // Disconnect handling
  socket.on("disconnect", () => {
    for (const [code, room] of Object.entries(rooms)) {
      room.players = room.players.filter((p) => p.id !== socket.id);
      if (room.players.length === 0) delete rooms[code];
      else emitRoom(code);
    }
  });
});

function emitRoom(roomCode) {
  const room = rooms[roomCode];
  if (room) {
    io.to(roomCode).emit("room_update", {
      players: room.players,
      hostId: room.hostId,
    });
  }
}

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
