// Vercel serverless function entry point. Any file under /api becomes a
// function by convention; this one just hands off to the real Express app
// (see server/app.js) so production and local dev run identical route/
// middleware/error-handling code. vercel.json rewrites every /api/* request
// here, and Express's own routing (app.use('/api/plan', ...) etc.) takes it
// from there using the original request path.
module.exports = require('../server/app');
