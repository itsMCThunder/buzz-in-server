// main.jsx — Buzz-In Frontend with Hot Seat support

import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import io from "socket.io-client";

const socket = io("/", { path: "/socket.io" });

function App() {
  const [step, setStep] = useState("menu"); // menu | lobby | game
  const [roomCode, setRoomCode] = useState("");
  const [name, setName] = useState("");
  const [room, setRoom] = useState(null);
  const [isHost, setIsHost] = useState(false);

  // listen for state updates
  useEffect(() => {
    socket.on("room_state", (data) => {
      setRoom(data);
    });
    return () => socket.off("room_state");
  }, []);

  function createRoom() {
    if (!name) return;
    socket.emit("create_room", { hostName: name }, (res) => {
      if (res.ok) {
        setRoomCode(res.roomCode);
        setIsHost(true);
        setStep("lobby");
      } else alert(res.error);
    });
  }

  function joinRoom() {
    if (!roomCode || !name) return;
    socket.emit("join_room", { roomCode, name }, (res) => {
      if (res.ok) {
        setIsHost(false);
        setStep("lobby");
      } else alert(res.error);
    });
  }

  // host actions
  function startGame() {
    socket.emit("start_game", { roomCode });
  }

  function nextRound() {
    socket.emit("next_round", { roomCode });
  }

  function clearBuzzers() {
    socket.emit("clear_buzzers", { roomCode });
  }

  function adjustScore(playerId, delta) {
    socket.emit("adjust_score", { roomCode, playerId, delta });
  }

  function buzz() {
    socket.emit("buzz", { roomCode });
  }

  // -------------------- UI --------------------
  if (step === "menu") {
    return (
      <div>
        <h1>Buzz-In</h1>
        <input placeholder="Your Name" value={name} onChange={(e) => setName(e.target.value)} />
        <div>
          <button onClick={createRoom}>Host Game</button>
        </div>
        <div>
          <input placeholder="Room Code" value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} />
          <button onClick={joinRoom}>Join Game</button>
        </div>
      </div>
    );
  }

  if (!room) return <div>Loading room...</div>;

  return (
    <div>
      <h1>Room {room.roomCode}</h1>
      <h2>Team Scores</h2>
      <p>Tipsy: {room.teamScores?.tipsy ?? 0} | Wobbly: {room.teamScores?.wobbly ?? 0}</p>

      {room.countdownActive && <h3>Countdown Active! 15s in progress...</h3>}

      <h2>Players</h2>
      <ul>
        {room.players.map((p) => {
          const isHotSeat =
            p.id === room.currentHotSeats?.tipsy || p.id === room.currentHotSeats?.wobbly;
          return (
            <li key={p.id}>
              {p.name} ({p.team || "Unassigned"}) - {p.score} pts{" "}
              {isHotSeat && <strong>🔥 Hot Seat</strong>}
              {isHost && (
                <>
                  <button onClick={() => adjustScore(p.id, 50)}>+50</button>
                  <button onClick={() => adjustScore(p.id, 0)}>0</button>
                  <button onClick={() => adjustScore(p.id, -50)}>-50</button>
                </>
              )}
            </li>
          );
        })}
      </ul>

      {isHost ? (
        <div>
          <button onClick={startGame}>Start Game</button>
          <button onClick={nextRound}>Next Round</button>
          <button onClick={clearBuzzers}>Clear Buzzers</button>
        </div>
      ) : (
        <div>
          <button
            onClick={buzz}
            disabled={room.locked}
            style={{
              padding: "20px",
              fontSize: "24px",
              backgroundColor: room.locked ? "gray" : "orange",
            }}
          >
            BUZZ!
          </button>
        </div>
      )}

      <h2>Buzz Queue</h2>
      <ol>
        {room.buzzQueue.map((id) => {
          const p = room.players.find((x) => x.id === id);
          return <li key={id}>{p ? p.name : id}</li>;
        })}
      </ol>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
