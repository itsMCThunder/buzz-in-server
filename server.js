import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// In-memory room storage
const rooms = {};

// Helper: broadcast room state
function emitRoom(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  io.to(roomCode).emit("room_update", {
    roomCode,
    players: room.players,
    hostId: room.hostId
  });
}

// Generate 4-letter room code
function generateRoomCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  } while (rooms[code]);
  return code;
}

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Host creates a room
  socket.on("create_room", ({ hostName }, cb) => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      hostId: socket.id,
      players: [{ id: socket.id, name: hostName, team: null, score: 0 }]
    };
    socket.join(roomCode);
    cb({ ok: true, roomCode });
    emitRoom(roomCode);
  });

  // Player joins a room
  socket.on("join_room", ({ roomCode, name }, cb) => {
    const room = rooms[roomCode];
    if (!room) return cb({ ok: false, error: "Room not found" });

    room.players.push({ id: socket.id, name, team: null, score: 0 });
    socket.join(roomCode);
    cb({ ok: true });
    emitRoom(roomCode);
  });

  // Disconnect handling
  socket.on("disconnect", () => {
    for (const [roomCode, room] of Object.entries(rooms)) {
      const index = room.players.findIndex((p) => p.id === socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        if (room.hostId === socket.id) {
          // End room if host leaves
          delete rooms[roomCode];
          io.to(roomCode).emit("room_closed");
        } else {
          emitRoom(roomCode);
        }
        break;
      }
    }
  });
});

// Root health check
app.get("/", (req, res) => {
  res.send("Buzz-In server is running!");
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
