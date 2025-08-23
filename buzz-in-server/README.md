# Buzz In — Server

Node.js + Express + Socket.IO server for the Buzz In game.

## Quick Start (Local)
1) Install Node.js 18+
2) In this folder, run:
   ```bash
   npm install
   npm start
   ```
3) You should see: "Server running on <PORT>" in the terminal.

## Deploy to Render
- **Build Command:** `npm install`
- **Start Command:** `node server.js`
- **Environment:** Node 18+
- Render automatically sets the `PORT` env var. No need to change the code.

## CORS
- Default allows all origins for simplicity on free tiers. You can set `CORS_ORIGIN` to a CSV of allowed origins later.
