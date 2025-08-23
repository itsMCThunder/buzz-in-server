import express from "express";
import compression from "compression";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
app.disable("x-powered-by");
app.use(compression());
app.use(express.json());

// health + simple debug
app.get("/health", (req, res) => res.json({ ok: true }));

// In-memory game state
const rooms = new Map(); // code -> { hostId, players: Map<sid,{id,name,score,team}>, buzzed: sid|null }
const snapshot = (code) => {
  const r = rooms.get(code);
  if (!r) return null;
  return { code, hostId: r.hostId, players: Array.from(r.players.values()), buzzed: r.buzzed };
};

const httpServer = createServer(app);

// Important: allow cross-origin for Cloudflare + static site
const io = new Server(httpServer, {
  path: "/socket.io",
  cors: {
    origin: true,             // reflect requester origin
    methods: ["GET", "POST"]
  }
});

io.on("connection", (socket) => {
  // create room
  socket.on("create_room", (p = {}) => {
    const code = String(p.roomCode || "").trim().toUpperCase();
    if (!code) return socket.emit("error_message", "Missing room code");
    if (!rooms.has(code)) rooms.set(code, { hostId: socket.id, players: new Map(), buzzed: null });
    else rooms.get(code).hostId = socket.id;
    socket.join(code);
    socket.emit("room_update", snapshot(code));
  });

  // join room
  socket.on("join_room", (p = {}) => {
    const code = String(p.roomCode || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return socket.emit("error_message", "Room not found");
    const player = { id: socket.id, name: String(p.playerName || "Player"), score: 0, team: null };
    room.players.set(socket.id, player);
    socket.join(code);
    io.to(code).emit("room_update", snapshot(code));
  });

  // buzz
  socket.on("buzz", (p = {}) => {
    const code = String(p.roomCode || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room || room.buzzed || !room.players.has(socket.id)) return;
    room.buzzed = socket.id;
    io.to(code).emit("room_update", snapshot(code));
  });

  // reset buzz (host)
  socket.on("reset_buzz", (p = {}) => {
    const code = String(p.roomCode || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    room.buzzed = null;
    io.to(code).emit("room_update", snapshot(code));
  });

  // assign team (single)
  socket.on("assign_team", (p = {}) => {
    const code = String(p.roomCode || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    const pl = room.players.get(String(p.playerId || ""));
    if (pl) {
      pl.team = p.team ?? null;
      io.to(code).emit("room_update", snapshot(code));
    }
  });

  // set teams (bulk)
  socket.on("set_teams", (p = {}) => {
    const code = String(p.roomCode || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    for (const [sid, team] of Object.entries(p.assignments || {})) {
      const pl = room.players.get(sid);
      if (pl) pl.team = team ?? null;
    }
    io.to(code).emit("room_update", snapshot(code));
  });

  // award points (host)
  socket.on("award_points", (p = {}) => {
    const code = String(p.roomCode || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    const pl = room.players.get(String(p.playerId || ""));
    if (pl) {
      pl.score = Math.max(0, (pl.score || 0) + Number(p.points || 0));
      io.to(code).emit("room_update", snapshot(code));
    }
  });

  socket.on("disconnect", () => {
    for (const [code, room] of rooms.entries()) {
      if (room.players.delete(socket.id)) {
        if (room.buzzed === socket.id) room.buzzed = null;
        io.to(code).emit("room_update", snapshot(code));
      }
      if (room.hostId === socket.id) {
        io.to(code).emit("error_message", "Host disconnected");
        rooms.delete(code);
      }
    }
  });
});

// Fallback 404
app.use((req, res) => res.status(404).json({ ok: false, error: "Not found" }));

const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => {
  console.log(`Buzz-in server listening on ${PORT}`);
});
