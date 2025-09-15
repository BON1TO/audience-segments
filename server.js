// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const passport = require('passport');
const { MongoClient, ObjectId } = require('mongodb');
const { astToMongoQuery } = require('./rulesToMongo');
const fs = require('fs');
const path = require('path');

// Routers
const usersRouter = require('./routes/users');
const segmentsRouter = require('./routes/segments');
const campaignsRouter = require('./routes/campaigns');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/audience';
const PORT = process.env.PORT || 4000;

async function start() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  console.log('Connected to MongoDB:', MONGO_URI);

  const db = client.db();
  const users = db.collection('users');
  const segments = db.collection('segments');
  const campaigns = db.collection('campaigns');

  const app = express();

  // CORS
  const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
  const extraOrigins = (process.env.EXTRA_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const allowedOrigins = [FRONTEND_ORIGIN, 'https://audience-segments.onrender.com', 'https://audience-segments-1.onrender.com', ...extraOrigins];

  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('CORS not allowed'), false);
    },
    credentials: true,
  }));

  app.use(bodyParser.json());
  app.use(cookieParser());

  app.use(session({
    secret: process.env.SESSION_SECRET || 'dev_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
  }));
  app.use(passport.initialize());
  app.use(passport.session());

  // Attach collections to app.locals
  app.locals.collections = { users, segments, campaigns };
  app.locals.ObjectId = ObjectId;
  app.locals.astToMongoQuery = astToMongoQuery;

  // Health check
  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // ✅ Explicitly mount routers
  app.use('/api/users', usersRouter);
  app.use('/api/segments', segmentsRouter);
  app.use('/api/campaigns', campaignsRouter);

  // Unknown API → JSON 404
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found', path: req.path }));

  // Serve SPA
  const clientDist = path.join(__dirname, 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API route not found' });
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  } else {
    app.get('/', (req, res) => res.send('Backend running. No built client found.'));
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
