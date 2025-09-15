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

  // ------------------------------
  // CORS: allow frontend origins
  // ------------------------------
  // FRONTEND_ORIGIN env (single origin string) and EXTRA_ORIGINS env (comma separated) supported
  const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
  const extraOrigins = (process.env.EXTRA_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // include common dev origins too
  const allowedOrigins = [
    FRONTEND_ORIGIN,
    'http://localhost:4000',
    'http://localhost:3000', // react dev default (if used)
    'https://audience-segments.onrender.com',
    'https://audience-segments-1.onrender.com',
    ...extraOrigins
  ];

  // Safe CORS origin callback: do not throw errors from this function
  function corsOriginCallback(origin, cb) {
    // allow server-side calls / curl (no origin header)
    if (!origin) return cb(null, true);

    if (allowedOrigins.includes(origin)) {
      return cb(null, true);
    }

    // Blocked origin: do NOT throw — return false so no CORS headers are added.
    console.warn('Blocked CORS request from origin:', origin);
    return cb(null, false);
  }

  app.use(cors({
    origin: corsOriginCallback,
    credentials: true,
    methods: ['GET','POST','PUT','DELETE','OPTIONS','PATCH']
  }));

  // Explicitly handle OPTIONS (preflight) by invoking the same CORS logic.
  // We avoid registering a problematic path string with app.options(...)
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
      return cors({
        origin: corsOriginCallback,
        credentials: true,
        methods: ['GET','POST','PUT','DELETE','OPTIONS','PATCH']
      })(req, res, next);
    }
    next();
  });

  // Optional: add a simple middleware to return a 403 JSON if some other middleware throws a CORS-related error
  app.use((err, req, res, next) => {
    if (err && err.message && err.message.toLowerCase().includes('cors')) {
      return res.status(403).json({ error: 'CORS not allowed', origin: req.headers.origin || null });
    }
    next(err);
  });

  // ------------------------------
  // Middlewares
  // ------------------------------
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

  // Attach collections/helpers to app.locals for routers to use
  app.locals.collections = { users, segments, campaigns };
  app.locals.ObjectId = ObjectId;
  app.locals.astToMongoQuery = astToMongoQuery;

  // Health
  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // Explicitly mount routers (must be before static/SPA fallback)
  app.use('/api/users', usersRouter);
  app.use('/api/segments', segmentsRouter);
  app.use('/api/campaigns', campaignsRouter);

  // JSON 404 for unknown API routes
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found', path: req.path }));

  // Serve static built React client (if present) and SPA fallback
  const clientDist = path.join(__dirname, 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    // serve static files
    app.use(express.static(clientDist));

    // SPA fallback middleware (DO NOT use app.get('*') or app.get('/*'))
    // This middleware runs for any request that reaches here:
    // - If it's an API/auth/profile path, pass to next (which returns JSON 404 above).
    // - Otherwise return index.html so React Router handles the route.
    app.use((req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path.startsWith('/profile')) {
        return next();
      }
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  } else {
    // No built client -> simple message
    const legacyPublic = path.join(__dirname, 'public');
    if (fs.existsSync(legacyPublic)) app.use(express.static(legacyPublic));
    app.get('/', (req, res) => res.send('Backend running. No built client found. Run `cd client && npm run build`.'));
  }

  // (Optional) small diagnostic: print top-level mounted route count and list in dev
  if (process.env.NODE_ENV !== 'production') {
    try {
      const routes = [];
      (app._router && app._router.stack || []).forEach((m) => {
        if (m.route && m.route.path) routes.push(m.route.path);
        else if (m.name === 'router' && m.regexp) routes.push(m.regexp.toString());
      });
      console.log('Express mounted stacks (sample):', routes.slice(0, 50));
      console.log('Allowed CORS origins:', allowedOrigins);
    } catch (e) { /* ignore */ }
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
