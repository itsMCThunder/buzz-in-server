// server.js
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

const rooms = {};

function rotateHotSeat(team) {
  if (team.players.length === 0) return null;
  if (!team.hotSeat) return team.players[0].id;
  const currentIndex = team.players.findIndex(p => p.id === team.hotSeat);
  const nextIndex = (currentIndex + 1) % team.players.length;
  return team.players[nextIndex].id;
}

io.on("connection", (socket) => {
  socket.on("create_room", ({ hostName, mode }, callback) => {
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
    rooms[code] = {
      hostId: socket.id,
      mode: mode || "freeplay",
      players: [{ id: socket.id, name: hostName, score: 0, team: null }],
      teams: {
        A: { name: null, score: 0, players: [], hotSeat: null },
        B: { name: null, score: 0, players: [], hotSeat: null },
      },
      buzzed: null,
      queue: [],
      buzzersLocked: false,
      timers: { buzz: null, unlock: null },
      gameStarted: false,
    };
    socket.join(code);
    callback({ ok: true, roomCode: code });
    io.to(code).emit("room_update", rooms[code]);
  });

  socket.on("set_teams", ({ roomCode, teamA, teamB }) => {
    const room = rooms[roomCode];
    if (room && room.hostId === socket.id) {
      room.teams.A.name = teamA;
      room.teams.B.name = teamB;
      io.to(roomCode).emit("room_update", room);
    }
  });

  socket.on("assign_team", ({ roomCode, playerId, teamKey }) => {
    const room = rooms[roomCode];
    if (room && room.hostId === socket.id) {
      const player = room.players.find(p => p.id === playerId);
      if (player) {
        player.team = teamKey;
        if (!room.teams[teamKey].players.find(p => p.id === playerId)) {
          room.teams[teamKey].players.push(player);
        }
      }
      io.to(roomCode).emit("room_update", room);
    }
  });

  socket.on("join_room", ({ roomCode, name }, callback) => {
    const room = rooms[roomCode];
    if (!room) return callback({ ok: false, error: "Room not found" });
    const newPlayer = { id: socket.id, name, score: 0, team: null };
    room.players.push(newPlayer);
    socket.join(roomCode);
    callback({ ok: true, roomCode });
    io.to(roomCode).emit("room_update", room);
  });

  socket.on("start_game", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;
    room.gameStarted = true;
    if (room.mode === "teams") {
      if (room.teams.A.players.length > 0)
        room.teams.A.hotSeat = room.teams.A.players[0].id;
      if (room.teams.B.players.length > 0)
        room.teams.B.hotSeat = room.teams.B.players[0].id;
    }
    io.to(roomCode).emit("room_update", room);
    if (room.timers.unlock) clearTimeout(room.timers.unlock);
    room.timers.unlock = setTimeout(() => {
      io.to(roomCode).emit("unlock_all");
      room.buzzersLocked = false;
    }, 20000);
  });

  socket.on("buzz", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.buzzersLocked) return;
    if (!room.buzzed) {
      room.buzzed = socket.id;
      io.to(roomCode).emit("room_update", room);
      if (room.timers.buzz) clearTimeout(room.timers.buzz);
      room.timers.buzz = setTimeout(() => {
        io.to(roomCode).emit("unlock_all");
        room.buzzersLocked = false;
      }, 15000);
    } else {
      if (!room.queue.includes(socket.id)) {
        room.queue.push(socket.id);
        io.to(roomCode).emit("queue_update", room.queue);
      }
    }
  });

  socket.on("award_points", ({ roomCode, playerId, points }) => {
    const room = rooms[roomCode];
    if (room && room.hostId === socket.id) {
      const player = room.players.find(p => p.id === playerId);
      if (player) {
        player.score += points;
        if (player.team) room.teams[player.team].score += points;
      }
      io.to(roomCode).emit("show_score_popup", {
        teamScores: { A: room.teams.A.score, B: room.teams.B.score }
      });
    }
  });

  socket.on("start_next_round", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;
    room.buzzed = null;
    room.queue = [];
    if (room.mode === "teams") {
      if (room.teams.A.hotSeat)
        room.teams.A.hotSeat = rotateHotSeat(room.teams.A);
      if (room.teams.B.hotSeat)
        room.teams.B.hotSeat = rotateHotSeat(room.teams.B);
    }
    io.to(roomCode).emit("room_update", room);
    io.to(roomCode).emit("close_score_popup");
  });

  socket.on("lock_buzzers", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (room && room.hostId === socket.id) {
      room.buzzersLocked = true;
      io.to(roomCode).emit("lock_all");
    }
  });

  socket.on("unlock_buzzers", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (room && room.hostId === socket.id) {
      room.buzzersLocked = false;
      io.to(roomCode).emit("unlock_all");
    }
  });

  socket.on("disconnect", () => {
    for (const [code, room] of Object.entries(rooms)) {
      room.players = room.players.filter(p => p.id !== socket.id);
      room.teams.A.players = room.teams.A.players.filter(p => p.id !== socket.id);
      room.teams.B.players = room.teams.B.players.filter(p => p.id !== socket.id);
      if (room.hostId === socket.id) {
        io.to(code).emit("room_closed");
        delete rooms[code];
      } else {
        io.to(code).emit("room_update", room);
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Server running on ${PORT}`));
