import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

// ------------------------
// SQLite Database
// ------------------------
let db;
(async () => {
  db = await open({
    filename: "./buzzin.sqlite",
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      roomCode TEXT PRIMARY KEY,
      hostId TEXT,
      createdAt INTEGER
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      roomCode TEXT,
      name TEXT,
      team TEXT,
      score INTEGER
    )
  `);
})();

// ------------------------
// Helper Functions
// ------------------------
function generateRoomCode(length = 5) {
  return Math.random().toString(36).substring(2, 2 + length).toUpperCase();
}

async function getRoomPlayers(roomCode) {
  return db.all(`SELECT * FROM players WHERE roomCode = ?`, [roomCode]);
}

async function emitRoom(roomCode) {
  const players = await getRoomPlayers(roomCode);
  io.to(roomCode).emit("room_update", { roomCode, players });
}

// ------------------------
// Socket Events
// ------------------------
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Create room
  socket.on("create_room", async ({ hostName }, cb) => {
    const roomCode = generateRoomCode();
    await db.run(
      `INSERT INTO rooms (roomCode, hostId, createdAt) VALUES (?, ?, ?)`,
      [roomCode, socket.id, Date.now()]
    );

    await db.run(
      `INSERT INTO players (id, roomCode, name, team, score) VALUES (?, ?, ?, ?, ?)`,
      [socket.id, roomCode, hostName, "Host", 0]
    );

    socket.join(roomCode);
    cb({ ok: true, roomCode });
    emitRoom(roomCode);
  });

  // Join room
  socket.on("join_room", async ({ roomCode, name }, cb) => {
    const room = await db.get(`SELECT * FROM rooms WHERE roomCode = ?`, [
      roomCode,
    ]);
    if (!room) return cb({ ok: false, error: "Room not found" });

    await db.run(
      `INSERT INTO players (id, roomCode, name, team, score) VALUES (?, ?, ?, ?, ?)`,
      [socket.id, roomCode, name, null, 0]
    );

    socket.join(roomCode);
    cb({ ok: true });
    emitRoom(roomCode);
  });

  // Award points
  socket.on("award_points", async ({ roomCode, playerId, points }) => {
    await db.run(`UPDATE players SET score = score + ? WHERE id = ?`, [
      points,
      playerId,
    ]);
    emitRoom(roomCode);
  });

  // Disconnect
  socket.on("disconnect", async () => {
    const player = await db.get(`SELECT * FROM players WHERE id = ?`, [
      socket.id,
    ]);
    if (player) {
      await db.run(`DELETE FROM players WHERE id = ?`, [socket.id]);
      emitRoom(player.roomCode);
    }
  });
});

// ------------------------
// Server Start
// ------------------------
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
