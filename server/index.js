const app = require('./app');

// Local-dev entry point only. On Vercel, api/index.js imports app.js
// directly and the platform handles listening -- this file (and its
// app.listen call) never runs there.
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`✅  Trip Planner server → http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️   GEMINI_API_KEY is not set — Gemini calls will fail, Overpass fallback will be used');
  }
});
