// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";

// Setup Express + Socket.io
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// --- SQLite Setup ---
const db = new Database("rooms.db");

// Create tables if not exist
db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    code TEXT PRIMARY KEY,
    hostId TEXT
  );
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT,
    team TEXT,
    score INTEGER,
    roomCode TEXT,
    FOREIGN KEY(roomCode) REFERENCES rooms(code)
  );
`);

// --- Helper Functions ---
function createRoom(hostId) {
  const code = nanoid(6).toUpperCase();
  db.prepare("INSERT INTO rooms (code, hostId) VALUES (?, ?)").run(code, hostId);
  return code;
}

function addPlayer(roomCode, id, name) {
  db.prepare(
    "INSERT INTO players (id, name, team, score, roomCode) VALUES (?, ?, ?, ?, ?)"
  ).run(id, name, null, 0, roomCode);
}

function getRoom(roomCode) {
  const room = db.prepare("SELECT * FROM rooms WHERE code = ?").get(roomCode);
  if (!room) return null;
  const players = db.prepare("SELECT * FROM players WHERE roomCode = ?").all(roomCode);
  return { ...room, players };
}

function removePlayer(id) {
  db.prepare("DELETE FROM players WHERE id = ?").run(id);
}

function updatePlayerScore(id, delta) {
  db.prepare("UPDATE players SET score = score + ? WHERE id = ?").run(delta, id);
}

function assignTeam(id, team) {
  db.prepare("UPDATE players SET team = ? WHERE id = ?").run(team, id);
}

function deleteRoom(roomCode) {
  db.prepare("DELETE FROM players WHERE roomCode = ?").run(roomCode);
  db.prepare("DELETE FROM rooms WHERE code = ?").run(roomCode);
}

// --- Emit Room State ---
function emitRoom(roomCode) {
  const room = getRoom(roomCode);
  if (room) io.to(roomCode).emit("room_update", room);
}

// --- Socket.io Events ---
io.on("connection", (socket) => {
  console.log("New connection:", socket.id);

  socket.on("create_room", ({ hostName }, cb) => {
    try {
      const roomCode = createRoom(socket.id);
      addPlayer(roomCode, socket.id, hostName);
      socket.join(roomCode);
      emitRoom(roomCode);
      cb({ ok: true, roomCode });
    } catch (err) {
      console.error(err);
      cb({ ok: false, error: "Failed to create room" });
    }
  });

  socket.on("join_room", ({ roomCode, name }, cb) => {
    const room = getRoom(roomCode);
    if (!room) return cb({ ok: false, error: "Room not found" });
    try {
      addPlayer(roomCode, socket.id, name);
      socket.join(roomCode);
      emitRoom(roomCode);
      cb({ ok: true });
    } catch (err) {
      cb({ ok: false, error: "Failed to join" });
    }
  });

  socket.on("assign_team", ({ playerId, team }) => {
    assignTeam(playerId, team);
    const player = db.prepare("SELECT roomCode FROM players WHERE id = ?").get(playerId);
    if (player) emitRoom(player.roomCode);
  });

  socket.on("adjust_score", ({ playerId, delta }) => {
    updatePlayerScore(playerId, delta);
    const player = db.prepare("SELECT roomCode FROM players WHERE id = ?").get(playerId);
    if (player) emitRoom(player.roomCode);
  });

  socket.on("disconnect", () => {
    const player = db.prepare("SELECT * FROM players WHERE id = ?").get(socket.id);
    if (player) {
      removePlayer(socket.id);
      emitRoom(player.roomCode);

      // If host leaves, destroy the room
      const room = getRoom(player.roomCode);
      if (room && room.hostId === socket.id) {
        deleteRoom(player.roomCode);
        io.to(player.roomCode).emit("room_closed");
      }
    }
  });
});

// Health Check Endpoint
app.get("/", (req, res) => {
  res.send("Buzz-In server running with SQLite 🚀");
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
