// server.js
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { MongoClient, ObjectId } = require('mongodb');
const { astToMongoQuery } = require('./rulesToMongo');
const fs = require('fs');
const path = require('path');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/audience';
const PORT = process.env.PORT || 4000;

async function start() {
  // Connect to MongoDB
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  console.log('Connected to MongoDB:', MONGO_URI);
  const db = client.db();
  const users = db.collection('users');
  const segments = db.collection('segments');
  const campaigns = db.collection('campaigns');

  const app = express();

  // CORS - allow your frontend host(s)
  const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
  // If you have more than one frontend domain (like audience-segments-1.onrender.com), add them here:
  const extraOrigins = (process.env.EXTRA_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const allowedOrigins = [FRONTEND_ORIGIN, ...extraOrigins].filter(Boolean);
  // for convenience during debugging you can also allow '*' but explicit list is safer:
  const corsOptions = {
    origin: function(origin, callback) {
      // allow requests with no origin (curl, mobile, same-origin)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || allowedOrigins.length === 0) return callback(null, true);
      return callback(new Error('CORS not allowed by server'), false);
    },
    credentials: true,
  };
  app.use(cors(corsOptions));

  // parse JSON bodies early
  app.use(bodyParser.json());
  app.use(cookieParser());

  // Session + passport (keep before any auth-required routes)
  app.use(session({
    secret: process.env.SESSION_SECRET || 'dev_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
  }));
  app.use(passport.initialize());
  app.use(passport.session());

  // Passport serialize/deserialize
  passport.serializeUser((user, done) => {
    try { done(null, user._id.toString()); } catch (e) { done(e); }
  });
  passport.deserializeUser(async (id, done) => {
    try {
      const u = await users.findOne({ _id: new ObjectId(id) });
      done(null, u || null);
    } catch (err) {
      done(err);
    }
  });

  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      const data = {
        googleId: profile.id,
        displayName: profile.displayName,
        email,
        photo: profile.photos?.[0]?.value,
        updatedAt: new Date()
      };
      const result = await users.findOneAndUpdate(
        { googleId: profile.id },
        { $set: data, $setOnInsert: { createdAt: new Date() } },
        { upsert: true, returnDocument: 'after' }
      );
      return done(null, result.value);
    } catch (err) {
      return done(err);
    }
  }));

  // basic auth routes
  app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
  app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => res.redirect('/profile')
  );
  app.get('/profile', (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/auth/google');
    const user = req.user;
    res.send(`<h1>Welcome ${user.displayName}</h1>
      <img src="${user.photo || ''}" width="80" />
      <pre>${JSON.stringify({
        _id: user._id,
        displayName: user.displayName,
        email: user.email,
        googleId: user.googleId
      }, null, 2)}</pre>
      <a href="/logout">Logout</a>`);
  });
  app.get('/logout', (req, res) => {
    req.logout(() => {});
    req.session.destroy(() => res.redirect('/'));
  });

  // Health
  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // Attach db collections/helpers for route modules
  app.locals.collections = { users, segments, campaigns };
  app.locals.ObjectId = ObjectId;
  app.locals.astToMongoQuery = astToMongoQuery;

  // Small helper that tries to mount a route file and logs what happened
  function tryMountRouteFlexible(relPathNoExt, mountPoint) {
    try {
      const candidates = [
        path.join(__dirname, relPathNoExt),
        path.join(__dirname, relPathNoExt + ".js"),
        path.join(__dirname, relPathNoExt + ".cjs"),
        path.join(__dirname, relPathNoExt + ".mjs"),
        path.join(__dirname, relPathNoExt, "index.js")
      ];
      const found = candidates.find(p => fs.existsSync(p));
      if (!found) {
        console.log(`Route file not found (skipping): ${relPathNoExt} (checked ${candidates.length} paths)`);
        return;
      }
      let mod = require(found);
      if (mod && typeof mod === 'object' && 'default' in mod) mod = mod.default;

      // If module is a factory function, try calling it with helpers
      if (typeof mod === 'function') {
        try {
          const maybeRouter = mod({ db, collections: { users, segments, campaigns }, ObjectId, astToMongoQuery });
          if (maybeRouter && (typeof maybeRouter === 'function' || typeof maybeRouter.use === 'function')) {
            app.use(mountPoint, maybeRouter);
            console.log(`Mounted route (factory) ${found} at ${mountPoint}`);
            return;
          }
        } catch (e) {
          // ignore factory error — next check will attempt to mount mod directly
        }
        // Try mounting the exported router directly
        app.use(mountPoint, mod);
        console.log(`Mounted route ${found} at ${mountPoint}`);
        return;
      }

      if (mod && typeof mod === 'object' && (typeof mod.use === 'function' || typeof mod.handle === 'function')) {
        app.use(mountPoint, mod);
        console.log(`Mounted route ${found} at ${mountPoint}`);
        return;
      }

      console.warn(`Found ${found} but it does not export an express Router or factory. Skipping.`);
    } catch (err) {
      console.warn(`Failed to mount ${relPathNoExt} at ${mountPoint}:`, (err && err.message) || err);
    }
  }

  // ---------- MOUNT API ROUTES BEFORE STATIC FALLBACK ----------
  tryMountRouteFlexible('./routes/users', '/api/users');
  tryMountRouteFlexible('./routes/segments', '/api/segments');
  tryMountRouteFlexible('./routes/campaigns', '/api/campaigns');

  // If you want more debug visibility on startup, print the routes that Express knows about:
  function listMountedRoutes() {
    const routes = [];
    app._router && app._router.stack && app._router.stack.forEach((m) => {
      if (m.route && m.route.path) {
        routes.push(m.route.path);
      } else if (m.name === 'router' && m.regexp) {
        routes.push(m.regexp.toString());
      }
    });
    console.log('Express mounted stacks (summary):', routes.slice(0, 50));
  }
  listMountedRoutes();

  // Serve static built react client (if available)
  const clientDist = path.join(__dirname, 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    // For any non-API route, serve index.html for SPA routing
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path.startsWith('/profile')) {
        return next();
      }
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  } else {
    const legacyPublic = path.join(__dirname, 'public');
    if (fs.existsSync(legacyPublic)) app.use(express.static(legacyPublic));
    app.get('/', (req, res) => res.send('Backend running. No built client found. Run `cd client && npm run build`.'));
  }

  // Start listening
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
