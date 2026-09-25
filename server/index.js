const app = require('./app');

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`✅  Trip Planner server → http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️   GEMINI_API_KEY is not set — Gemini calls will fail, Overpass fallback will be used');
  }
});
