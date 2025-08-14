// server.js — Buzz-In backend (Express + Socket.IO, backend-only)

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors({ origin: "*"})); // relax for now; tighten to your domain later

// Health check for Render
app.get("/health", (_, res) => res.send("ok"));

// --- Socket.IO setup ---
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*"},
  path: "/socket.io",
  transports: ["websocket", "polling"],
});

// ----------------- In-memory state -----------------
/**
 * rooms: Map<roomCode, {
 *   roomCode: string,
 *   hostId: string,
 *   hostName: string,
 *   players: Array<{ id, name, score, team|null }>,
 *   buzzQueue: string[], // array of player socket ids in order
 *   locked: boolean,
 *   showScores: boolean
 * }>
 */
const rooms = new Map();

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function computeTeamScores(room) {
  const scores = { tipsy: 0, wobbly: 0 };
  for (const p of room.players) {
    if (p.team === "tipsy") scores.tipsy += p.score || 0;
    if (p.team === "wobbly") scores.wobbly += p.score || 0;
  }
  return scores;
}

function emitRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const payload = {
    roomCode: room.roomCode,
    hostId: room.hostId,
    players: room.players,
    buzzQueue: room.buzzQueue,
    locked: room.locked,
    showScores: room.showScores,
    teamScores: computeTeamScores(room),
  };
  io.to(roomCode).emit("room_state", payload);
}

// ----------------- Socket handlers -----------------
io.on("connection", (socket) => {
  // keep some per-socket metadata
  socket.data.roomCode = null;
  socket.data.name = null;

  // Create room (host)
  socket.on("create_room", ({ hostName }, ack) => {
    try {
      // generate unique 4-char code
      let code = makeCode();
      while (rooms.has(code)) code = makeCode();

      const room = {
        roomCode: code,
        hostId: socket.id,
        hostName: hostName || "Host",
        players: [{ id: socket.id, name: hostName || "Host", score: 0, team: null }],
        buzzQueue: [],
        locked: false,
        showScores: false,
      };
      rooms.set(code, room);

      socket.join(code);
      socket.data.roomCode = code;
      socket.data.name = hostName || "Host";

      emitRoom(code);
      ack && ack({ ok: true, roomCode: code });
    } catch (e) {
      ack && ack({ ok: false, error: "Failed to create room" });
    }
  });

  // Join room (player)
  socket.on("join_room", ({ roomCode, name }, ack) => {
    const code = (roomCode || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return ack && ack({ ok: false, error: "Room not found" });

    // already in?
    if (!room.players.find((p) => p.id === socket.id)) {
      room.players.push({ id: socket.id, name: name || "Player", score: 0, team: null });
    }
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.name = name || "Player";

    emitRoom(code);
    ack && ack({ ok: true });
  });

  // Buzz
  socket.on("buzz", ({ roomCode }) => {
    const code = (roomCode || socket.data.roomCode || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room || room.locked) return;
    if (!room.players.find((p) => p.id === socket.id)) return;

    // add to queue if not already there
    if (!room.buzzQueue.includes(socket.id)) {
      room.buzzQueue.push(socket.id);
      emitRoom(code);
    }
  });

  // Clear buzzers (host)
  socket.on("clear_buzzers", ({ roomCode }) => {
    const code = (roomCode || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    room.buzzQueue = [];
    room.showScores = false;
    emitRoom(code);
  });

  // Lock/unlock buzzers (host)
  socket.on("lock_buzzers", ({ roomCode, locked }) => {
    const code = (roomCode || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    room.locked = !!locked;
    emitRoom(code);
  });

  // Award +50 (host) — shows scoreboard
  socket.on("award", ({ roomCode, playerId, delta = 50 }) => {
    const code = (roomCode || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;

    const p = room.players.find((x) => x.id === playerId);
    if (p) p.score = (p.score || 0) + (Number(delta) || 0);

    // remove from head of queue if matches
    if (room.buzzQueue[0] === playerId) room.buzzQueue.shift();

    // show scoreboard after a correct answer
    room.showScores = true;
    emitRoom(code);
  });

  // Penalty -50 (host) — goes to next person, no scoreboard
  socket.on("penalty", ({ roomCode, playerId, delta = -50 }) => {
    const code = (roomCode || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;

    const p = room.players.find((x) => x.id === playerId);
    if (p) p.score = (p.score || 0) + (Number(delta) || 0);

    if (room.buzzQueue[0] === playerId) room.buzzQueue.shift();

    // keep showScores as-is (host will click Next to hide)
    emitRoom(code);
  });

  // Next question (host) — hides scoreboard & clears queue
  socket.on("next_question", ({ roomCode }) => {
    const code = (roomCode || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    room.showScores = false;
    room.buzzQueue = [];
    emitRoom(code);
  });

  // Assign team (host)
  socket.on("assign_team", ({ roomCode, playerId, team }, ack) => {
    const code = (roomCode || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return ack && ack({ ok: false, error: "Not allowed" });

    const p = room.players.find((x) => x.id === playerId);
    if (!p) return ack && ack({ ok: false, error: "Player not found" });

    p.team = team ?? null; // "tipsy" | "wobbly" | null
    emitRoom(code);
    ack && ack({ ok: true });
  });

  // Clean up on disconnect
  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    // remove from players and queue
    room.players = room.players.filter((p) => p.id !== socket.id);
    room.buzzQueue = room.buzzQueue.filter((id) => id !== socket.id);

    // if host left, end room (or promote first player)
    if (room.hostId === socket.id) {
      if (room.players.length === 0) {
        rooms.delete(code);
      } else {
        // promote first remaining player as host
        room.hostId = room.players[0].id;
      }
    }

    if (rooms.has(code)) emitRoom(code);
  });
});

// --- Start server (Render provides PORT) ---
const PORT = process.env.PORT || 5175;
server.listen(PORT, "0.0.0.0", () => {
  console.log("Buzz server listening on port", PORT);
});
