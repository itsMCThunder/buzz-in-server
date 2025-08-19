import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { nanoid } from "nanoid";

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*", // for now allow all
    methods: ["GET", "POST"],
  },
});

const rooms = {}; // { roomCode: { hostId, players: [] } }

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Create a new room
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

  // Join an existing room
  socket.on("join_room", ({ roomCode, name }, cb) => {
    const room = rooms[roomCode];
    if (!room) return cb({ ok: false, error: "Room not found" });

    room.players.push({ id: socket.id, name, team: null, score: 0 });
    socket.join(roomCode);
    cb({ ok: true, roomCode });
    emitRoom(roomCode);
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
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
