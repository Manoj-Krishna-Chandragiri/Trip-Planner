require('dotenv').config();
const express = require('express');
const cors = require('cors');

const planRouter = require('./routes/plan');
const refineRouter = require('./routes/refine');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/plan', planRouter);
app.use('/api/refine', refineRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((err, req, res, _next) => {
  console.error('[uncaught]', err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

module.exports = app;
