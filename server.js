import express from "express";
import http from "http";
import { Server } from "socket.io";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- SQLite Setup ---
let db;
const initDb = async () => {
  db = await open({
    filename: "./database.sqlite",
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY,
      hostName TEXT,
      createdAt INTEGER
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      roomCode TEXT,
      name TEXT,
      team TEXT,
      score INTEGER,
      FOREIGN KEY (roomCode) REFERENCES rooms(code)
    )
  `);
};
initDb();

// --- Socket.io ---
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("create_room", async ({ hostName }, cb) => {
    try {
      const code = Math.random().toString(36).substring(2, 6).toUpperCase();
      await db.run(
        "INSERT INTO rooms (code, hostName, createdAt) VALUES (?, ?, ?)",
        [code, hostName, Date.now()]
      );
      cb({ ok: true, roomCode: code });
    } catch (err) {
      console.error(err);
      cb({ ok: false, error: "Failed to create room" });
    }
  });

  socket.on("join_room", async ({ roomCode, name }, cb) => {
    try {
      const room = await db.get("SELECT * FROM rooms WHERE code = ?", [roomCode]);
      if (!room) return cb({ ok: false, error: "Room not found" });

      await db.run(
        "INSERT OR REPLACE INTO players (id, roomCode, name, team, score) VALUES (?, ?, ?, ?, ?)",
        [socket.id, roomCode, name, null, 0]
      );

      socket.join(roomCode);
      cb({ ok: true });

      const players = await db.all("SELECT * FROM players WHERE roomCode = ?", [roomCode]);
      io.to(roomCode).emit("room_update", { players });
    } catch (err) {
      console.error(err);
      cb({ ok: false, error: "Failed to join room" });
    }
  });

  socket.on("disconnect", async () => {
    await db.run("DELETE FROM players WHERE id = ?", [socket.id]);
  });
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
