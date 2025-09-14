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

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/audience';
const PORT = process.env.PORT || 4000;

async function start(){
  // Connect to MongoDB
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  console.log('Connected to MongoDB:', MONGO_URI);
  const db = client.db();
  const users = db.collection('users');
  const segments = db.collection('segments');
  const campaigns = db.collection('campaigns');

  const app = express();
  const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

  app.use(cors({
    origin: FRONTEND_ORIGIN,  // your React dev server
    credentials: true         // allow cookies / Authorization headers
  }));

  app.use(bodyParser.json());
  const fs = require('fs');
  const path = require('path');

  // Serve static files for the built React client (if present)
  const clientDist = path.join(__dirname, 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    // serve the built client
    app.use(express.static(clientDist));

    // ensure API routes are still defined above this block.
    // For any non-API route, return index.html so React Router works.
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path.startsWith('/profile')) {
        return next(); // let API/auth routes handle it
      }
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  } else {
    // No built client found: still serve legacy 'public' if it exists
    const legacyPublic = path.join(__dirname, 'public');
    if (fs.existsSync(legacyPublic)) {
      app.use(express.static(legacyPublic));
    }

    // helpful message at root so you know to build the client
    app.get('/', (req, res) => {
      res.send('Backend running. No built client found. Run `cd client && npm run build` to create the frontend in client/dist.');
    });
  }

  app.use(cookieParser());

  // Simple helper: normalize varied incoming rule shapes into canonical shape
  /**
   * normalizeIncomingRules(rules)
   * Accepts varied incoming "rule" shapes from the frontend and returns an array
   * of normalized rule objects that astToMongoQuery can consume.
   *
   * Normalized shape: [{ field: string, op: string, value: any }, ...]
   * - op will be a mongo-like token when possible (e.g. "$gt", "$lt", "$eq", "$ne", "$contains")
   */
  function normalizeIncomingRules(rules) {
    if (!Array.isArray(rules)) {
      // if client sent a single rule object, wrap it
      if (typeof rules === 'object' && rules !== null) rules = [rules];
      else return [];
    }

    const symbolToMongo = {
      ">": "$gt",
      "<": "$lt",
      ">=": "$gte",
      "<=": "$lte",
      "=": "$eq",
      "==": "$eq",
      "!=": "$ne",
      "contains": "$contains"
    };

    return rules.map((r) => {
      // defensive read of many possible keys the frontend or clients may send
      const field = r.field ?? r.name ?? r.key ?? "";
      // op may be in op, operator, mongoOp, opName, operatorName
      let rawOp = r.op ?? r.operator ?? r.mongoOp ?? r.opName ?? r.operatorName;
      // If op is not present but r has an opObj like { "$gt": 10 }, read that
      if (!rawOp && r.opObj && typeof r.opObj === 'object') {
        const keys = Object.keys(r.opObj);
        if (keys.length) rawOp = keys[0];
      }
      // value may be separate or inside opObj or inside condition
      let value = r.value ?? r.val ?? r.v;
      if (value === undefined && r.opObj && typeof r.opObj === 'object') {
        const keys = Object.keys(r.opObj);
        if (keys.length) value = r.opObj[keys[0]];
      }
      if (value === undefined && r.condition && typeof r.condition === 'object') {
        value = r.condition.value ?? r.condition.val;
        if (!rawOp) rawOp = r.condition.operator ?? r.condition.op;
      }

      // If rawOp already looks like a mongo token ($gt) keep it
      let op = rawOp;
      if (typeof rawOp === 'string' && rawOp.startsWith('$')) {
        op = rawOp;
      } else if (typeof rawOp === 'string' && symbolToMongo[rawOp] !== undefined) {
        op = symbolToMongo[rawOp];
      } else if (rawOp === undefined) {
        // Try to infer op from presence of keys like "$gt" inside the rule object
        const possibleMongoOps = Object.keys(r).find(k => k.startsWith('$'));
        if (possibleMongoOps) {
          op = possibleMongoOps;
          value = r[possibleMongoOps];
        }
      }

      // final defensive trimming / conversions
      return { field: String(field).trim(), op: op, value: value };
    });
  }

  // Provide a template for SegmentNew (optional but helpful)
  app.get('/api/segments/new', async (req, res) => {
    try {
      console.log('[DEBUG] GET /api/segments/new called from', req.ip, 'origin:', req.headers.origin);
      return res.status(200).json({ name: "", rules: [{ field: "", op: ">", value: "" }] });
    } catch (err) {
      console.error('GET /api/segments/new error (unexpected)', err);
      return res.status(200).json({ name: "", rules: [{ field: "", op: ">", value: "" }] });
    }
  });

  // GET single segment by id
  app.get('/api/segments/:id', async (req, res) => {
    try {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });
      const seg = await segments.findOne({ _id: new ObjectId(id) });
      if (!seg) return res.status(404).json({ error: 'Not found' });
      res.json(seg);
    } catch (err) {
      console.error('GET /api/segments/:id error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET users for a segment
  app.get('/api/segments/:id/users', async (req, res) => {
    try {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid segment id' });

      const seg = await segments.findOne({ _id: new ObjectId(id) });
      if (!seg) return res.status(404).json({ error: 'Segment not found' });

      // pagination
      const page = Math.max(1, parseInt(req.query.page || '1', 10));
      const limit = Math.min(200, parseInt(req.query.limit || '50', 10));
      const skip = (page - 1) * limit;

      // Case A: segment explicitly stores userIds (array)
      if (Array.isArray(seg.userIds) && seg.userIds.length) {
        // ensure items are ObjectIds
        const ids = seg.userIds.map(i => {
          try { return typeof i === 'string' && ObjectId.isValid(i) ? new ObjectId(i) : i; } 
          catch { return i; }
        });
        const q = { _id: { $in: ids } };
        const usersList = await users.find(q).skip(skip).limit(limit).toArray();
        const total = await users.countDocuments(q);
        return res.json({ total, page, limit, users: usersList });
      }

      // Case B: segment stores rules/AST -> convert to Mongo query
      if (seg.rules) {
        let mongoQuery = {};
        try {
          mongoQuery = astToMongoQuery(seg.rules) || {};
        } catch (e) {
          // if conversion fails, return a helpful error
          return res.status(400).json({ error: 'Invalid segment rules: ' + e.message });
        }

        const usersList = await users
          .find(mongoQuery, { projection: { name:1, email:1, total_spend:1, visits:1, last_active_at:1 } })
          .skip(skip)
          .limit(limit)
          .toArray();

        const total = await users.countDocuments(mongoQuery);
        return res.json({ total, page, limit, users: usersList });
      }

      // fallback: segment has neither userIds nor rules
      return res.json({ total: 0, page, limit, users: [] });
    } catch (err) {
      console.error('GET /api/segments/:id/users error', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // debug helper: sample users + count
  app.get('/api/users/sample', async (req, res) => {
    try {
      const count = await users.countDocuments();
      const sample = await users
        .find({}, { projection: { name:1, email:1, total_spend:1, visits:1, last_active_at:1 } })
        .limit(20)
        .toArray();
      res.json({ count, sample });
    } catch (err) {
      console.error('/api/users/sample error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // List users with optional search + pagination
  app.get('/api/users', async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page || '1', 10));
      const limit = Math.min(200, parseInt(req.query.limit || '50', 10));
      const skip = (page - 1) * limit;

      // optional search ?q=alice
      const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : null;
      const filter = {};
      if (q) {
        filter.$or = [
          { name: { $regex: q, $options: 'i' } },
          { email: { $regex: q, $options: 'i' } }
        ];
      }

      // projection: only return safe fields used by frontend
      const cursor = users.find(filter, { projection: { name:1, email:1, total_spend:1, visits:1, last_active_at:1 }});
      const total = await cursor.count();
      const list = await cursor.skip(skip).limit(limit).toArray();

      res.json({ total, page, limit, users: list });
    } catch (err) {
      console.error('GET /api/users error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Session setup (keep secret in .env)
  app.use(session({
    secret: process.env.SESSION_SECRET || 'dev_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
  }));

  // Passport init
  app.use(passport.initialize());
  app.use(passport.session());

  // Passport serialize / deserialize using Mongo user _id
  passport.serializeUser((user, done) => {
    // store the MongoDB _id as string
    done(null, user._id.toString());
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const u = await users.findOne({ _id: new ObjectId(id) });
      done(null, u || null);
    } catch (err) {
      done(err);
    }
  });

  // Configure Google strategy (make sure .env has GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL)
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails && profile.emails[0] && profile.emails[0].value;
      const data = {
        googleId: profile.id,
        displayName: profile.displayName,
        email,
        photo: profile.photos && profile.photos[0] && profile.photos[0].value,
        updatedAt: new Date()
      };

      // upsert user by googleId
      const result = await users.findOneAndUpdate(
        { googleId: profile.id },
        { $set: data, $setOnInsert: { createdAt: new Date() } },
        { upsert: true, returnDocument: 'after' }
      );

      // result.value is the user document
      return done(null, result.value);
    } catch (err) {
      return done(err);
    }
  }));  

  // ---- Authentication routes ----
  app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
  );

  app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => {
      // auth succeeded
      // you can redirect to your frontend route or /profile for demo
      res.redirect('/profile');
    }
  );

  app.get('/profile', (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/auth/google');
    // send minimal profile info
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

  // ---- Your existing API endpoints ----
  app.get('/api/health', (req,res)=> res.json({ ok:true }));

  // POST /api/segments/preview (normalize incoming rules before building mongo query)
  app.post('/api/segments/preview', async (req,res) => {
    try {
      // debug log - what server actually receives
      console.log('>>> PREVIEW /api/segments/preview body:', JSON.stringify(req.body, null, 2));

      let ast = req.body.rules;
      if(!ast) return res.status(400).json({ error: 'Missing rules' });

      // Normalize incoming rules to a canonical shape the astToMongoQuery expects.
      const normalized = normalizeIncomingRules(ast);
      console.log('>>> PREVIEW normalized rules:', JSON.stringify(normalized, null, 2));

      const mongoQuery = astToMongoQuery(normalized) || {};
      const count = await users.countDocuments(mongoQuery);
      const sample = await users.find(mongoQuery, { projection: { name:1, email:1, total_spend:1, visits:1, last_active_at:1 }}).limit(10).toArray();
      res.json({ count, sample });
    } catch (e) {
      console.error('/api/segments/preview error:', e);
      res.status(400).json({ error: e.message });
    }
  });

  // Create a new segment - returns the saved document (normalized rules saved)
  app.post('/api/segments', async (req,res) => {
    try {
      console.log('>>> POST /api/segments body:', JSON.stringify(req.body, null, 2));

      const { name } = req.body;
      let { rules } = req.body;
      if (!name || !rules) return res.status(400).json({ error: 'Missing name or rules' });

      // Normalize incoming rules
      const normalized = normalizeIncomingRules(rules);
      console.log('>>> POST normalized rules:', JSON.stringify(normalized, null, 2));

      let mongoQuery = {};
      try {
        mongoQuery = astToMongoQuery(normalized) || {};
      } catch (e) {
        return res.status(400).json({ error: 'Invalid rules: ' + e.message });
      }

      const audience_size = await users.countDocuments(mongoQuery);

      const insertRes = await segments.insertOne({
        name,
        rules: normalized,   // save normalized rules for clarity
        audience_size,
        created_at: new Date()
      });

      // retrieve saved document including _id
      const saved = await segments.findOne({ _id: insertRes.insertedId });

      res.status(201).json(saved);
    } catch(e){
      console.error('POST /api/segments error', e);
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/segments', async (req,res) => {
    const list = await segments.find({}, { projection: { name:1, audience_size:1, created_at:1 } }).sort({ created_at: -1 }).toArray();
    res.json(list);
  });



  app.get('/api/campaigns/:id', async (req,res) => {
    try {
      const id = req.params.id;
      if(!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });
      const doc = await campaigns.findOne({ _id: new ObjectId(id) });
      if(!doc) return res.status(404).json({ error: 'Not found' });
      res.json(doc);
    } catch(e){
      res.status(400).json({ error: e.message });
    }
  });

    // ------------------------------------------------------------
  // expose collections/helpers for external route modules
  // ------------------------------------------------------------
  app.locals.collections = { users, segments, campaigns };
  app.locals.ObjectId = ObjectId;
  app.locals.astToMongoQuery = astToMongoQuery;

  // ------------------------------------------------------------
  // Robust mounting of external route modules in ./routes/
  // (will mount routes if files exist; safe to keep even if they don't)
  // ------------------------------------------------------------
    // Robust mounting of external route modules in ./routes/
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

      // unwrap potential ESM default export: { default: Router }
      if (mod && typeof mod === 'object' && 'default' in mod) {
        mod = mod.default;
      }

      // If mod is a function, it may be a factory or a router (both acceptable)
      if (typeof mod === 'function') {
        // Try calling as factory with helpers — but only if it returns a router
        try {
          const maybeRouter = mod({ db, collections: { users, segments, campaigns }, ObjectId, astToMongoQuery });
          if (maybeRouter && (typeof maybeRouter === 'function' || (typeof maybeRouter === 'object' && (typeof maybeRouter.use === 'function' || typeof maybeRouter.handle === 'function')))) {
            app.use(mountPoint, maybeRouter);
            console.log(`Mounted route (factory) ${found} at ${mountPoint}`);
            return;
          }
        } catch (e) {
          // factory call threw — maybe mod is a plain router function (Express allows router to be callable)
          // fallthrough to check if mod itself looks like middleware/router
        }

        // If mod itself looks like a router/middleware, mount directly
        if (typeof mod === 'function') {
          app.use(mountPoint, mod);
          console.log(`Mounted route (function) ${found} at ${mountPoint}`);
          return;
        }
      }

      // If module is an object that looks like a Router, mount it
      if (mod && typeof mod === 'object' && (typeof mod.use === 'function' || typeof mod.handle === 'function')) {
        app.use(mountPoint, mod);
        console.log(`Mounted route ${found} at ${mountPoint}`);
        return;
      }

      console.warn(`Found ${found} but it does not export an express Router or a factory function. Skipping mount.`);
    } catch (err) {
      console.warn(`Failed to mount ${relPathNoExt} at ${mountPoint}:`, (err && err.message) || err);
    }
  }

  // Mount the routes
  tryMountRouteFlexible('./routes/segments', '/api/segments');
  tryMountRouteFlexible('./routes/campaigns', '/api/campaigns');


  // Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
}


start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
