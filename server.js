import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

app.use(express.static(path.join(__dirname, "../client/dist")));
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist/index.html"));
});

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const rooms = new Map();

function getRoom(roomCode) {
  const code = roomCode?.toUpperCase();
  if (!rooms.has(code)) return null;
  return rooms.get(code);
}

function emitRoomState(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return;
  const teamScores = { tipsy: 0, wobbly: 0 };
  for (const [,p] of room.players) {
    if (p.team === "tipsy") teamScores.tipsy += p.score || 0;
    if (p.team === "wobbly") teamScores.wobbly += p.score || 0;
  }
  const payload = {
    roomCode: room.code,
    hostId: room.hostId,
    players: [...room.players.entries()].map(([id, p]) => ({ id, name: p.name, score: p.score, team: p.team || null })),
    teamScores,
    buzzQueue: room.buzzQueue,
    locked: room.locked,
    showScores: room.showScores,
  };
  io.to(room.code).emit("room_state", payload);
}

io.on("connection", (socket) => {
  socket.on("create_room", ({ hostName }, cb) => {
    const code = generateCode();
    const room = {
      code,
      hostId: socket.id,
      players: new Map(),
      buzzQueue: [],
      locked: false,
      showScores: false,
    };
    rooms.set(code, room);
    socket.join(code);
    room.players.set(socket.id, { name: hostName || "Host", score: 0, team: null, isHost: true });
    cb?.({ ok: true, code });
    emitRoomState(code);
  });

  socket.on("join_room", ({ roomCode, name }, cb) => {
    const room = getRoom(roomCode);
    if (!room) return cb?.({ ok: false, error: "Room not found" });
    if (room.players.has(socket.id)) return cb?.({ ok: true, code: room.code });
    room.players.set(socket.id, { name: name?.trim() || "Player", score: 0, team: null });
    socket.join(room.code);
    cb?.({ ok: true, code: room.code });
    emitRoomState(room.code);
  });

  socket.on("buzz", ({ roomCode }) => {
    const room = getRoom(roomCode);
    if (!room || room.locked) return;
    if (!room.players.has(socket.id)) return;
    if (!room.buzzQueue.includes(socket.id)) {
      room.buzzQueue.push(socket.id);
      room.locked = true;
      emitRoomState(room.code);
    }
  });

  function requireHost(room, socketId) {
    return room && room.hostId === socketId;
  }

  socket.on("lock_buzzers", ({ roomCode, locked }) => {
    const room = getRoom(roomCode);
    if (!requireHost(room, socket.id)) return;
    room.locked = !!locked;
    emitRoomState(room.code);
  });

  socket.on("assign_team", ({ roomCode, playerId, team }, cb) => {
    const room = getRoom(roomCode);
    if (!room) { cb && cb({ ok:false, error:"Room not found" }); return; }
    if (room.hostId !== socket.id) { cb && cb({ ok:false, error:"Only host can assign" }); return; }
    if (!room.players.has(playerId)) { cb && cb({ ok:false, error:"Player not in room" }); return; }
    const t = (team === "tipsy" || team === "wobbly") ? team : null;
    const p = room.players.get(playerId);
    p.team = t;
    console.log("assign_team", { room: room.code, playerId, to: t });
    cb && cb({ ok:true, team: t });
    emitRoomState(room.code);
  });

  socket.on("clear_buzzers", ({ roomCode }) => {
    const room = getRoom(roomCode);
    if (!requireHost(room, socket.id)) return;
    room.buzzQueue = [];
    room.locked = false;
    emitRoomState(room.code);
  });

  socket.on("award", ({ roomCode, playerId, delta = 50 }) => {
    const room = getRoom(roomCode);
    if (!requireHost(room, socket.id)) return;
    const p = room.players.get(playerId);
    if (p) p.score += delta;
    room.showScores = true;
    room.buzzQueue = [];
    room.locked = false;
    emitRoomState(room.code);
  });

  socket.on("penalty", ({ roomCode, playerId, delta = -50 }) => {
    const room = getRoom(roomCode);
    if (!requireHost(room, socket.id)) return;
    const p = room.players.get(playerId);
    if (p) p.score += delta;
    if (room.buzzQueue[0] === playerId) room.buzzQueue.shift();
    emitRoomState(room.code);
  });

  socket.on("next_question", ({ roomCode }) => {
    const room = getRoom(roomCode);
    if (!requireHost(room, socket.id)) return;
    room.showScores = false;
    room.buzzQueue = [];
    room.locked = false;
    emitRoomState(room.code);
  });

  socket.on("disconnecting", () => {
    for (const roomCode of socket.rooms) {
      const room = rooms.get(roomCode);
      if (!room) continue;
      room.players.delete(socket.id);
      room.buzzQueue = room.buzzQueue.filter((id) => id !== socket.id);
      if (room.hostId === socket.id) {
        const next = [...room.players.keys()][0];
        room.hostId = next || null;
      }
      if (room.players.size === 0) {
        rooms.delete(roomCode);
      } else {
        emitRoomState(roomCode);
      }
    }
  });
});

const PORT = process.env.PORT || 5175;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Buzz server listening on port ${PORT}`);
});
