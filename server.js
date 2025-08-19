import React, { useState, useEffect } from "react";
import io from "socket.io-client";

const socket = io(import.meta.env.VITE_SERVER_URL || "http://localhost:3001");

export default function App() {
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState(null);
  const [error, setError] = useState("");
  const [isHost, setIsHost] = useState(false);

  useEffect(() => {
    socket.on("room_update", (roomData) => {
      setRoom(roomData);
    });

    socket.on("room_closed", () => {
      alert("The host closed the room.");
      setRoom(null);
      setRoomCode("");
    });

    return () => {
      socket.off("room_update");
      socket.off("room_closed");
    };
  }, []);

  // Host a game
  const handleHostGame = () => {
    if (!name.trim()) return setError("Enter a name to host");
    socket.emit("create_room", { hostName: name }, (res) => {
      if (res.ok) {
        setRoomCode(res.roomCode);
        setError("");
        setIsHost(true);
      } else {
        setError(res.error || "Failed to create room");
      }
    });
  };

  // Join game
  const handleJoinGame = () => {
    if (!name.trim() || !roomCode.trim())
      return setError("Enter a name and room code");
    socket.emit("join_room", { roomCode, name }, (res) => {
      if (res.ok) {
        setError("");
        setIsHost(false);
      } else {
        setError(res.error || "Failed to join room");
      }
    });
  };

  // Buzz
  const handleBuzz = () => {
    if (roomCode) {
      socket.emit("buzz", { roomCode });
    }
  };

  // Award points (only host)
  const handleAwardPoints = (playerId, points) => {
    socket.emit("award_points", { roomCode, playerId, points });
  };

  // Reset buzz (only host)
  const handleResetBuzz = () => {
    socket.emit("reset_buzz", { roomCode });
  };

  return (
    <div className="p-6 font-sans bg-gray-100 min-h-screen flex flex-col items-center">
      {!room ? (
        <div className="w-full max-w-md space-y-4">
          <h1 className="text-3xl font-bold text-center text-indigo-600">
            Buzzer Game
          </h1>
          <input
            className="w-full p-2 border rounded"
            placeholder="Enter your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="w-full p-2 border rounded"
            placeholder="Enter room code (to join)"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
          />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex space-x-4">
            <button
              className="flex-1 bg-green-500 hover:bg-green-600 text-white py-2 rounded shadow"
              onClick={handleHostGame}
            >
              Host Game
            </button>
            <button
              className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-2 rounded shadow"
              onClick={handleJoinGame}
            >
              Join Game
            </button>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-2xl">
          <h2 className="text-2xl font-bold text-center text-indigo-700 mb-2">
            Room Code: {roomCode}
          </h2>
          <p className="text-center text-gray-600 mb-4">
            {isHost ? `You are hosting as ${name}` : `You joined as ${name}`}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            {room.players.map((player) => (
              <div
                key={player.id}
                className={`p-4 border rounded shadow-sm ${
                  room.buzzed === player.id
                    ? "bg-yellow-100 border-yellow-400"
                    : "bg-white"
                }`}
              >
                <p className="font-semibold">{player.name}</p>
                <p className="text-sm text-gray-500">
                  Score: {player.score ?? 0}
                </p>
                {isHost && (
                  <div className="flex space-x-2 mt-2">
                    <button
                      className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded text-sm"
                      onClick={() => handleAwardPoints(player.id, +1)}
                    >
                      +1
                    </button>
                    <button
                      className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-sm"
                      onClick={() => handleAwardPoints(player.id, -1)}
                    >
                      -1
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {isHost ? (
            <div className="flex space-x-4 justify-center">
              <button
                className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded shadow"
                onClick={handleResetBuzz}
              >
                Reset Buzz
              </button>
            </div>
          ) : (
            <div className="flex justify-center">
              <button
                className={`px-6 py-3 rounded text-white text-lg font-bold shadow ${
                  room.buzzed
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-orange-500 hover:bg-orange-600"
                }`}
                onClick={handleBuzz}
                disabled={!!room.buzzed}
              >
                BUZZ!
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
