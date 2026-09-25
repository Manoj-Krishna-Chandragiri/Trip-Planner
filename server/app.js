require('dotenv').config();
const express = require('express');
const cors = require('cors');

const planRouter = require('./routes/plan');
const refineRouter = require('./routes/refine');

// The Express app itself, with no app.listen() call -- this is what lets
// the exact same app run two ways:
//   - locally via `node index.js`, which imports this and calls .listen()
//   - on Vercel via api/index.js, which imports this and hands it straight
//     to the platform's Node request handler (no listen() needed there,
//     Vercel's runtime invokes the app as a request handler per-request)
const app = express();

// ── Middleware ─────────────────────────────────────────────────────
// cors() lets the Vite dev server (port 5173) call this server locally.
// On Vercel the client and API share an origin, so CORS is a no-op there.
app.use(cors());
app.use(express.json());

// ── Routes ─────────────────────────────────────────────────────────
app.use('/api/plan', planRouter);
app.use('/api/refine', refineRouter);

// ── Health check ───────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Global error handler ───────────────────────────────────────────
// Express recognises 4-arg middleware as error handlers.
// Any unhandled throw lands here instead of crashing the process.
app.use((err, req, res, _next) => {
  console.error('[uncaught]', err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

module.exports = app;
