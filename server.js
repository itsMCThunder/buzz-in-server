import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const app = express();
const PORT = process.env.PORT || 10000;

// Basic CORS (relaxed for simplicity)
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map(s => s.trim())
  : ["*"];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  }
}));

app.get("/", (req, res) => {
  res.send("Buzz In server is running");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

const server = http.createServer(app);
const io = new Server(server, {
  path: "/socket.io",
  cors: {
    origin: allowedOrigins.includes("*") ? "*" : allowedOrigins,
    methods: ["GET", "POST"]
  }
});

// -------------------- GAME STATE --------------------
const rooms = new Map();
const ROOM_IDLE_MS = 30 * 60 * 1000; // 30 minutes
const BUZZ_LOCK_MS = 20 * 1000;      // 20 seconds after round starts
const HOST_DECISION_MS = 15 * 1000;  // 15 sec per buzz decision

function now() { return Date.now(); }

function makeRoomCode() {
  // 4-digit numeric, avoid duplicates among active rooms
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms.has(code));
  return code;
}

function defaultRoom(hostId, hostName) {
  return {
    code: makeRoomCode(),
    hostId,
    hostName,
    createdAt: now(),
    lastActivity: now(),
    state: "lobby", // 'lobby' | 'inRound' | 'summary'
    teams: {
      A: { name: "Team A", players: [], hotIndex: 0, score: 0 },
      B: { name: "Team B", players: [], hotIndex: 0, score: 0 }
    },
    players: new Map(), // id -> { id, name, team: 'A'|'B'|null, socketId, connected: true }
    queue: [], // player ids
    hotSeats: { A: null, B: null }, // player ids
    buzzLockedUntil: 0,
    currentBuzzDeadline: 0,
    currentBuzzPlayer: null,
    timers: { unlock: null, decision: null }
  };
}

function touch(room) { room.lastActivity = now(); }

function cleanupRooms() {
  const t = now();
  for (const [code, room] of rooms) {
    if (t - room.lastActivity > ROOM_IDLE_MS) {
      io.to(code).emit("room:ended", { reason: "idle-timeout" });
      rooms.delete(code);
    }
  }
}
setInterval(cleanupRooms, 60 * 1000);

// Utility getters
function getRoomByCode(code) { return rooms.get(code); }
function getPlayer(room, playerId) { return room.players.get(playerId) || null; }
function playerIsHotSeat(room, playerId) {
  return room.hotSeats.A === playerId || room.hotSeats.B === playerId;
}

// Broadcast the full room state (safe for clients)
function publicRoomState(room) {
  const players = Array.from(room.players.values()).map(p => ({
    id: p.id, name: p.name, team: p.team, connected: p.connected
  }));
  return {
    code: room.code,
    hostId: room.hostId,
    hostName: room.hostName,
    state: room.state,
    teams: {
      A: { name: room.teams.A.name, players: room.teams.A.players, score: room.teams.A.score, hotIndex: room.teams.A.hotIndex },
      B: { name: room.teams.B.name, players: room.teams.B.players, score: room.teams.B.score, hotIndex: room.teams.B.hotIndex }
    },
    players,
    queue: room.queue,
    hotSeats: room.hotSeats,
    buzzLockedUntil: room.buzzLockedUntil,
    currentBuzzDeadline: room.currentBuzzDeadline,
    currentBuzzPlayer: room.currentBuzzPlayer
  };
}

function broadcastRoom(room) { io.to(room.code).emit("room:update", publicRoomState(room)); }

function pickNextHotSeat(room, teamKey) {
  const team = room.teams[teamKey];
  if (!team.players.length) return null;
  // rotate until we find a connected player on that team
  let tries = team.players.length;
  while (tries--) {
    const idx = team.hotIndex % team.players.length;
    const candidateId = team.players[idx];
    team.hotIndex = (team.hotIndex + 1) % team.players.length;
    const candidate = getPlayer(room, candidateId);
    if (candidate && candidate.connected && candidate.team === teamKey) {
      return candidateId;
    }
  }
  return null;
}

function clearTimers(room) {
  if (room.timers.unlock) {
    clearTimeout(room.timers.unlock);
    room.timers.unlock = null;
  }
  if (room.timers.decision) {
    clearTimeout(room.timers.decision);
    room.timers.decision = null;
  }
}

function startDecisionTimer(room) {
  clearTimeout(room.timers.decision);
  if (!room.queue.length) {
    room.currentBuzzPlayer = null;
    room.currentBuzzDeadline = 0;
    return;
  }
  room.currentBuzzPlayer = room.queue[0];
  room.currentBuzzDeadline = now() + HOST_DECISION_MS;
  room.timers.decision = setTimeout(() => {
    // Auto-skip if host doesn't act in time
    const front = room.queue[0];
    if (front === room.currentBuzzPlayer) {
      room.queue.shift();
      room.currentBuzzPlayer = null;
      room.currentBuzzDeadline = 0;
      touch(room);
      startDecisionTimer(room); // move to next if any
      broadcastRoom(room);
    }
  }, HOST_DECISION_MS);
}

function startRound(room) {
  clearTimers(room);
  // set hot seats
  const a = pickNextHotSeat(room, "A");
  const b = pickNextHotSeat(room, "B");
  room.hotSeats = { A: a, B: b };
  room.queue = [];
  room.currentBuzzPlayer = null;
  room.currentBuzzDeadline = 0;
  room.buzzLockedUntil = now() + BUZZ_LOCK_MS;
  room.state = "inRound";
  touch(room);

  // Unlock timer for full buzzing
  room.timers.unlock = setTimeout(() => {
    room.timers.unlock = null;
    broadcastRoom(room);
  }, BUZZ_LOCK_MS);

  broadcastRoom(room);
}

function endRoundToSummary(room) {
  clearTimers(room);
  room.state = "summary";
  room.queue = [];
  room.currentBuzzPlayer = null;
  room.currentBuzzDeadline = 0;
  touch(room);
  broadcastRoom(room);
}

function ensureHotSeatsLive(room) {
  // if a hot-seat player disconnected, pick a new one
  for (const k of ["A", "B"]) {
    const pid = room.hotSeats[k];
    if (!pid) {
      room.hotSeats[k] = pickNextHotSeat(room, k);
    } else {
      const p = getPlayer(room, pid);
      if (!p || !p.connected || p.team !== k) {
        room.hotSeats[k] = pickNextHotSeat(room, k);
      }
    }
  }
}

io.on("connection", (socket) => {
  socket.on("disconnect", () => {
    // Find if player or host of a room
    for (const [code, room] of rooms) {
      if (room.hostId === socket.id) {
        io.to(code).emit("room:ended", { reason: "host-left" });
        rooms.delete(code);
        break;
      }
      for (const player of room.players.values()) {
        if (player.socketId === socket.id) {
          player.connected = false;
          // remove from queue if present
          room.queue = room.queue.filter(id => id !== player.id);
          // if current buzz player disconnected, treat like skip
          if (room.currentBuzzPlayer === player.id) {
            room.queue.shift(); // remove front
            room.currentBuzzPlayer = null;
            clearTimeout(room.timers.decision);
            startDecisionTimer(room); // advance
          }
          ensureHotSeatsLive(room);
          touch(room);
          broadcastRoom(room);
          break;
        }
      }
    }
  });

  // ----------------- HOST EVENTS -----------------
  socket.on("host:createRoom", ({ hostName }) => {
    const room = defaultRoom(socket.id, hostName || "Host");
    rooms.set(room.code, room);
    socket.join(room.code);
    touch(room);
    socket.emit("host:roomCreated", { code: room.code });
    broadcastRoom(room);
  });

  socket.on("host:setTeamNames", ({ code, teamAName, teamBName }) => {
    const room = getRoomByCode(code); if (!room) return;
    if (room.hostId !== socket.id) return;
    if (typeof teamAName === "string") room.teams.A.name = teamAName.trim() || "Team A";
    if (typeof teamBName === "string") room.teams.B.name = teamBName.trim() || "Team B";
    touch(room);
    broadcastRoom(room);
  });

  socket.on("host:assignPlayerToTeam", ({ code, playerId, team }) => {
    const room = getRoomByCode(code); if (!room) return;
    if (room.hostId !== socket.id) return;
    if (!["A","B",null].includes(team)) return;

    const player = getPlayer(room, playerId); if (!player) return;
    // remove from previous team list if needed
    for (const k of ["A","B"]) {
      const list = room.teams[k].players;
      const idx = list.indexOf(player.id);
      if (idx !== -1) list.splice(idx,1);
    }
    player.team = team;
    if (team === "A" || team === "B") {
      room.teams[team].players.push(player.id);
    }
    ensureHotSeatsLive(room);
    touch(room);
    broadcastRoom(room);
  });

  socket.on("host:startGame", ({ code }) => {
    const room = getRoomByCode(code); if (!room) return;
    if (room.hostId !== socket.id) return;
    if (!room.teams.A.players.length || !room.teams.B.players.length) {
      socket.emit("error:message", { message: "Need at least one player on each team." });
      return;
    }
    startRound(room);
  });

  socket.on("host:awardPoint", ({ code }) => {
    const room = getRoomByCode(code); if (!room) return;
    if (room.hostId !== socket.id) return;
    const pid = room.currentBuzzPlayer;
    if (!pid || room.queue[0] !== pid) return;

    const player = getPlayer(room, pid);
    if (!player || !player.team) return;
    room.teams[player.team].score += 1;

    endRoundToSummary(room);
  });

  socket.on("host:markWrongOrSkip", ({ code }) => {
    const room = getRoomByCode(code); if (!room) return;
    if (room.hostId !== socket.id) return;

    if (room.queue.length) {
      const front = room.queue[0];
      room.queue.shift();
      room.currentBuzzPlayer = null;
      room.currentBuzzDeadline = 0;
      clearTimeout(room.timers.decision);
      startDecisionTimer(room);
      touch(room);
      broadcastRoom(room);
    }
  });

  socket.on("host:nextRound", ({ code }) => {
    const room = getRoomByCode(code); if (!room) return;
    if (room.hostId !== socket.id) return;
    startRound(room);
  });

  // NEW: Skip round during inRound (same behavior as nextRound)
  socket.on("host:skipRound", ({ code }) => {
    const room = getRoomByCode(code); if (!room) return;
    if (room.hostId !== socket.id) return;
    startRound(room);
  });

  // NEW: Kick player from room entirely
  socket.on("host:kickPlayer", ({ code, playerId }) => {
    const room = getRoomByCode(code); if (!room) return;
    if (room.hostId !== socket.id) return;
    const player = getPlayer(room, playerId); if (!player) return;

    // Remove from team rosters
    for (const k of ["A","B"]) {
      const list = room.teams[k].players;
      const idx = list.indexOf(playerId);
      if (idx !== -1) list.splice(idx,1);
    }

    // Remove from queue
    room.queue = room.queue.filter(id => id !== playerId);

    // If they were the current buzz player, advance the decision timer
    if (room.currentBuzzPlayer === playerId) {
      room.currentBuzzPlayer = null;
      room.currentBuzzDeadline = 0;
      clearTimeout(room.timers.decision);
      startDecisionTimer(room);
    }

    // If they were in a hot seat, refill it
    if (room.hotSeats.A === playerId || room.hotSeats.B === playerId) {
      ensureHotSeatsLive(room);
    }

    // Notify the player and remove from room
    try {
      if (player.socketId) {
        io.to(player.socketId).emit("player:kicked", { code: room.code });
        const s = io.sockets.sockets.get(player.socketId);
        if (s) {
          s.leave(room.code);
          // s.disconnect(true); // optional: hard disconnect
        }
      }
    } catch (e) { /* ignore */ }

    room.players.delete(playerId);
    touch(room);
    broadcastRoom(room);
  });

  socket.on("host:clearScores", ({ code }) => {
    const room = getRoomByCode(code); if (!room) return;
    if (room.hostId !== socket.id) return;
    room.teams.A.score = 0;
    room.teams.B.score = 0;
    touch(room);
    broadcastRoom(room);
  });

  // ----------------- PLAYER EVENTS -----------------
  socket.on("player:joinRoom", ({ code, playerId, playerName }) => {
    const room = getRoomByCode(code); if (!room) {
      socket.emit("error:message", { message: "Room not found." });
      return;
    }
    socket.join(code);

    const name = (playerName || "Player").toString().trim().slice(0, 24);
    const id = playerId || socket.id;
    const existing = room.players.get(id);
    if (existing) {
      existing.connected = true;
      existing.socketId = socket.id;
      existing.name = name;
    } else {
      const newPlayer = { id, name, team: null, socketId: socket.id, connected: true };
      room.players.set(id, newPlayer);
    }

    touch(room);
    broadcastRoom(room);
  });

  socket.on("player:buzz", ({ code, playerId }) => {
    const room = getRoomByCode(code); if (!room) return;
    const p = getPlayer(room, playerId); if (!p || !p.connected) return;
    if (room.state !== "inRound") return;

    const lockedPhase = now() < room.buzzLockedUntil;
    const isHot = playerIsHotSeat(room, p.id);

    if (lockedPhase && !isHot) {
      return;
    }

    if (room.queue.includes(p.id)) return;

    room.queue.push(p.id);
    touch(room);

    if (room.queue.length === 1) {
      startDecisionTimer(room);
    }

    broadcastRoom(room);
  });

  socket.on("ping:activity", ({ code }) => {
    const room = getRoomByCode(code); if (!room) return;
    touch(room);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
