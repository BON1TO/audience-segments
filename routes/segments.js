// routes/segments.js
const express = require('express');
const { ObjectId } = require('mongodb');
const router = express.Router();

// helper to access collections and helpers added to app.locals in server.js
function getCollections(req) {
  const cols = req.app && req.app.locals && req.app.locals.collections;
  if (!cols) throw new Error('Collections not available on req.app.locals.collections');
  return cols;
}

// Provide a small template for the "New segment" UI
// GET /api/segments/new
router.get('/new', async (req, res) => {
  try {
    return res.status(200).json({ name: "", rules: [{ field: "", op: ">", value: "" }] });
  } catch (err) {
    console.error('routes/segments GET /new error', err);
    return res.status(200).json({ name: "", rules: [{ field: "", op: ">", value: "" }] });
  }
});

// List all segments
// GET /api/segments
router.get('/', async (req, res) => {
  try {
    const { segments } = getCollections(req);
    const list = await segments
      .find({}, { projection: { name: 1, audience_size: 1, created_at: 1 } })
      .sort({ created_at: -1 })
      .toArray();
    res.json(list);
  } catch (err) {
    console.error('routes/segments GET / error', err);
    res.status(500).json({ error: err.message });
  }
});

// Create a segment
// POST /api/segments
// Create a segment
// POST /api/segments
router.post('/', async (req, res) => {
  try {
    const { segments, users } = getCollections(req);
    const astToMongoQuery = req.app.locals && req.app.locals.astToMongoQuery;

    let { name, rules } = req.body;

    if (!name || !rules) return res.status(400).json({ error: 'Missing name or rules' });
    if (!Array.isArray(rules)) return res.status(400).json({ error: 'Rules must be an array' });

    // Defensive normalization & type coercion:
    // - Ensure each rule has field/op/value
    // - Convert numeric-looking values to numbers so queries like visits < 50 match numeric fields
    const normalized = rules.map((r = {}) => {
      const field = String(r.field ?? r.name ?? '').trim();
      let op = (r.op ?? r.operator ?? '>').toString();
      // normalize common eq token
      if (op === '==') op = '=';
      let value = r.value ?? r.v ?? r.val ?? (r.condition && r.condition.value);

      // If value is not null/undefined, coerce possible numeric strings to numbers
      if (typeof value === 'string') {
        const trimmed = value.trim();
        // integer or float detection
        if (trimmed !== '' && !Number.isNaN(Number(trimmed))) {
          // only convert when it looks like a pure number
          value = Number(trimmed);
        } else {
          value = trimmed;
        }
      }

      return { field, op, value };
    }).filter(r => r.field && (r.value !== undefined && r.value !== ''));

    // Build mongo query from normalized rules (if astToMongoQuery available)
    let mongoQuery = {};
    if (astToMongoQuery && typeof astToMongoQuery === 'function') {
      try {
        mongoQuery = astToMongoQuery(normalized) || {};
      } catch (e) {
        console.error('Invalid normalized rules -> AST conversion error:', e);
        return res.status(400).json({ error: 'Invalid rules: ' + e.message });
      }
    } else {
      // If no astToMongoQuery available, just save normalized rules and audience_size 0
      console.warn('astToMongoQuery not available on server; saving segment without audience calculation.');
    }

    // DEBUG: log query you will run (remove/disable in production)
    console.log('[segments POST] normalized rules:', JSON.stringify(normalized));
    console.log('[segments POST] mongoQuery:', JSON.stringify(mongoQuery));

    // Compute audience size using mongoQuery if non-empty, otherwise 0
    let audience_size = 0;
    try {
      // if mongoQuery is an empty object, countDocuments({}) returns total users — which might be okay,
      // but to be explicit, only run count if we actually have any filters or rules were provided.
      if (Object.keys(mongoQuery).length > 0) {
        audience_size = await users.countDocuments(mongoQuery);
      } else if (normalized.length > 0) {
        // ast returned empty query despite rules — safe fallback: attempt an exact field match approach
        // (optional) try to build a naive query: OR of field:value equality for each rule
        const fallbackOr = normalized.map(r => ({ [r.field]: r.value }));
        if (fallbackOr.length) {
          audience_size = await users.countDocuments({ $or: fallbackOr });
        }
      } else {
        audience_size = 0;
      }
    } catch (e) {
      console.warn('[segments POST] error counting users for audience_size:', e);
      // leave audience_size as 0 and continue save
    }

    // Save normalized rules and audience_size
    const insertDoc = { name, rules: normalized, audience_size, created_at: new Date() };
    const insertRes = await segments.insertOne(insertDoc);
    const saved = await segments.findOne({ _id: insertRes.insertedId });

    // return created segment (with audience_size)
    res.status(201).json(saved);
  } catch (err) {
    console.error('routes/segments POST / error', err);
    res.status(500).json({ error: err.message });
  }
});


/**
 * IMPORTANT: define /:id/users BEFORE /:id
 * Otherwise, /:id will greedily match "new" or "<id>/users"
 */

// Get users for a segment (paginated).
// GET /api/segments/:id/users
router.get('/:id/users', async (req, res) => {
  try {
    const { segments, users } = getCollections(req);
    const astToMongoQuery = req.app.locals && req.app.locals.astToMongoQuery;

    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Missing segment id' });

    // Resolve segment (try ObjectId first, then string)
    let seg = null;
    if (ObjectId.isValid(id)) {
      seg = await segments.findOne({ _id: new ObjectId(id) });
    }
    if (!seg) {
      seg = await segments.findOne({ _id: id }) || await segments.findOne({ name: id });
    }
    if (!seg) return res.status(404).json({ error: 'Segment not found' });

    // Pagination
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(200, parseInt(req.query.limit || '50', 10));
    const skip = (page - 1) * limit;

    // Case A: explicit userIds
    if (Array.isArray(seg.userIds) && seg.userIds.length) {
      const ids = seg.userIds.map(i => {
        try {
          return typeof i === 'string' && ObjectId.isValid(i) ? new ObjectId(i) : i;
        } catch {
          return i;
        }
      });
      const q = { _id: { $in: ids } };
      const usersList = await users
        .find(q, { projection: { name: 1, email: 1, total_spend: 1, visits: 1, last_active_at: 1 } })
        .skip(skip)
        .limit(limit)
        .toArray();
      const total = await users.countDocuments(q);
      return res.json({ total, page, limit, users: usersList });
    }

    // Case B: rules → convert with astToMongoQuery
    if (seg.rules && astToMongoQuery && typeof astToMongoQuery === 'function') {
      let mongoQuery = {};
      try {
        mongoQuery = astToMongoQuery(seg.rules) || {};
      } catch (e) {
        return res.status(400).json({ error: 'Invalid segment rules: ' + e.message });
      }

      const usersList = await users
        .find(mongoQuery, { projection: { name: 1, email: 1, total_spend: 1, visits: 1, last_active_at: 1 } })
        .skip(skip)
        .limit(limit)
        .toArray();
      const total = await users.countDocuments(mongoQuery);
      return res.json({ total, page, limit, users: usersList });
    }

    // Fallback: no users
    return res.json({ total: 0, page, limit, users: [] });
  } catch (err) {
    console.error('routes/segments GET /:id/users error', err);
    res.status(500).json({ error: err.message });
  }
});

// Get one segment by id
// GET /api/segments/:id
router.get('/:id', async (req, res) => {
  try {
    const { segments } = getCollections(req);
    const id = req.params.id;

    let seg = null;
    if (ObjectId.isValid(id)) {
      seg = await segments.findOne({ _id: new ObjectId(id) });
    }
    if (!seg) {
      seg = await segments.findOne({ _id: id }) || await segments.findOne({ name: id });
    }
    if (!seg) return res.status(404).json({ error: 'Not found' });
    res.json(seg);
  } catch (err) {
    console.error('routes/segments GET /:id error', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
