// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

// --- Express + Socket.IO setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// --- SQLite database setup ---
let db;
(async () => {
  db = await open({
    filename: "./buzzin.db",
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY,
      hostName TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT,
      roomCode TEXT,
      name TEXT,
      team TEXT,
      score INTEGER DEFAULT 0,
      PRIMARY KEY (id, roomCode)
    )
  `);
})();

// --- Utility helpers ---
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function getPlayerById(room, playerId) {
  if (!room || !room.players) return null;
  return room.players.find((p) => p.id === playerId) || null;
}

async function getRoomWithPlayers(roomCode) {
  const room = await db.get(`SELECT * FROM rooms WHERE code = ?`, [roomCode]);
  if (!room) return null;
  const players = await db.all(`SELECT * FROM players WHERE roomCode = ?`, [
    roomCode,
  ]);
  room.players = players;
  return room;
}

async function emitRoom(roomCode) {
  const room = await getRoomWithPlayers(roomCode);
  if (room) {
    io.to(roomCode).emit("room_update", room);
  }
}

// --- Socket.IO events ---
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // Host creates a room
  socket.on("create_room", async ({ hostName }, cb) => {
    const roomCode = generateRoomCode();
    await db.run(`INSERT INTO rooms (code, hostName) VALUES (?, ?)`, [
      roomCode,
      hostName,
    ]);
    await db.run(
      `INSERT INTO players (id, roomCode, name, team, score) VALUES (?, ?, ?, ?, ?)`,
      [socket.id, roomCode, hostName, "host", 0]
    );
    socket.join(roomCode);
    cb({ ok: true, roomCode });
    emitRoom(roomCode);
  });

  // Player joins room
  socket.on("join_room", async ({ roomCode, name }, cb) => {
    const room = await db.get(`SELECT * FROM rooms WHERE code = ?`, [roomCode]);
    if (!room) return cb({ ok: false, error: "Room not found" });

    await db.run(
      `INSERT INTO players (id, roomCode, name, team, score) VALUES (?, ?, ?, ?, ?)`,
      [socket.id, roomCode, name, null, 0]
    );
    socket.join(roomCode);
    cb({ ok: true });
    emitRoom(roomCode);
  });

  // Assign player to a team
  socket.on("assign_team", async ({ roomCode, playerId, team }) => {
    await db.run(
      `UPDATE players SET team = ? WHERE id = ? AND roomCode = ?`,
      [team, playerId, roomCode]
    );
    emitRoom(roomCode);
  });

  // Update player score
  socket.on("update_score", async ({ roomCode, playerId, delta }) => {
    const player = await db.get(
      `SELECT * FROM players WHERE id = ? AND roomCode = ?`,
      [playerId, roomCode]
    );
    if (!player) return;

    const newScore = player.score + delta;
    await db.run(
      `UPDATE players SET score = ? WHERE id = ? AND roomCode = ?`,
      [newScore, playerId, roomCode]
    );
    emitRoom(roomCode);
  });

  // Disconnect
  socket.on("disconnect", async () => {
    console.log("Client disconnected:", socket.id);
    await db.run(`DELETE FROM players WHERE id = ?`, [socket.id]);
    // Clean up empty rooms
    const emptyRooms = await db.all(`
      SELECT code FROM rooms
      WHERE code NOT IN (SELECT DISTINCT roomCode FROM players)
    `);
    for (const r of emptyRooms) {
      await db.run(`DELETE FROM rooms WHERE code = ?`, [r.code]);
    }
  });
});

// --- Server health route ---
app.get("/", (req, res) => {
  res.send("Buzz-In server running");
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
