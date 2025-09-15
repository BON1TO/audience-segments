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
router.post('/', async (req, res) => {
  try {
    const { segments } = getCollections(req);
    const { name, rules } = req.body;
    if (!name || !rules) return res.status(400).json({ error: 'Missing name or rules' });

    const insertRes = await segments.insertOne({
      name,
      rules,
      audience_size: 0,
      created_at: new Date(),
    });
    const saved = await segments.findOne({ _id: insertRes.insertedId });
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
