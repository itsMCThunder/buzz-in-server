import Database from "better-sqlite3";

const db = new Database("buzzin.db");

// --- Initialize schema ---
db.exec(`
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  hostId TEXT,
  createdAt INTEGER
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT,
  roomCode TEXT,
  team TEXT,
  score INTEGER,
  FOREIGN KEY(roomCode) REFERENCES rooms(code)
);
`);

// --- Rooms ---
export function createRoom(code, hostId) {
  db.prepare("INSERT INTO rooms (code, hostId, createdAt) VALUES (?, ?, ?)").run(code, hostId, Date.now());
}

export function getRoom(code) {
  return db.prepare("SELECT * FROM rooms WHERE code = ?").get(code);
}

export function deleteRoom(code) {
  db.prepare("DELETE FROM rooms WHERE code = ?").run(code);
  db.prepare("DELETE FROM players WHERE roomCode = ?").run(code);
}

// --- Players ---
export function addPlayer(id, name, roomCode) {
  db.prepare("INSERT INTO players (id, name, roomCode, team, score) VALUES (?, ?, ?, ?, ?)").run(id, name, roomCode, null, 0);
}

export function getPlayers(roomCode) {
  return db.prepare("SELECT * FROM players WHERE roomCode = ?").all(roomCode);
}

export function updatePlayerScore(id, score) {
  db.prepare("UPDATE players SET score = ? WHERE id = ?").run(score, id);
}

export function updatePlayerTeam(id, team) {
  db.prepare("UPDATE players SET team = ? WHERE id = ?").run(team, id);
}

export function removePlayer(id) {
  db.prepare("DELETE FROM players WHERE id = ?").run(id);
}
