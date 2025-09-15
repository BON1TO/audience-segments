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
// Replace the existing POST / handler with this block
router.post('/', async (req, res) => {
  try {
    const { segments, users } = getCollections(req);
    const astToMongoQuery = req.app.locals && req.app.locals.astToMongoQuery;

    const { name, rules } = req.body || {};
    if (!name || !Array.isArray(rules)) return res.status(400).json({ error: 'Missing name or rules' });

    // Operator map
    const OP_MAP = {
      "<": "$lt", ">": "$gt", "<=": "$lte", ">=": "$gte", "!=": "$ne", "==": "$eq", "=": "$eq",
      "$lt":"$lt", "$gt":"$gt", "$lte":"$lte", "$gte":"$gte", "$ne":"$ne", "$eq":"$eq"
    };

    // Fields you expect to be numeric in users collection
    const numericFields = new Set(['visits','total_spend','totalSpend','money_spent','total_spent']);

    // Normalize each incoming rule (sets mongoOp and coerces numeric values when appropriate)
    function normalizeRule(r) {
      const rr = Object.assign({}, r);
      const raw = (rr.mongoOp || rr.op || rr.operator || "").toString();
      if (OP_MAP[raw]) rr.mongoOp = OP_MAP[raw];
      else if (raw && raw.startsWith("$")) rr.mongoOp = raw;
      else rr.mongoOp = "$eq";

      // If this field is a numeric-type field, coerce value to Number if possible
      if (numericFields.has(rr.field) && typeof rr.value === "string") {
        const n = Number(rr.value);
        if (!Number.isNaN(n)) rr.value = n;
      }

      // If value was sent as e.g. "true"/"false" convert to boolean
      if (typeof rr.value === "string") {
        const lv = rr.value.toLowerCase?.();
        if (lv === "true") rr.value = true;
        else if (lv === "false") rr.value = false;
      }

      return rr;
    }

    const normalizedRules = (rules || []).map(normalizeRule);

    // Build Mongo query from normalized rules.
    // If astToMongoQuery exists prefer that (it may support richer logic). Otherwise build a simple AND.
    let mongoQuery = {};
    if (normalizedRules.length === 0) mongoQuery = {};
    else if (astToMongoQuery && typeof astToMongoQuery === 'function') {
      try {
        mongoQuery = astToMongoQuery(normalizedRules) || {};
      } catch (e) {
        // fallback to manual build if astToMongoQuery fails
        mongoQuery = {};
      }
    }

    // fallback manual build if not using astToMongoQuery or it failed
    if (!mongoQuery || Object.keys(mongoQuery).length === 0) {
      mongoQuery = {};
      normalizedRules.forEach(r => {
        if (!r.field || !r.mongoOp || r.value === undefined) return;
        if (!mongoQuery[r.field]) mongoQuery[r.field] = {};
        mongoQuery[r.field][r.mongoOp] = r.value;
      });
    }

    // compute audience_size
    const audience_size = await users.countDocuments(mongoQuery);

    // signature to avoid duplicates (name + rules)
    const signature = JSON.stringify({ name, rules: normalizedRules });

    // optional dedupe check
    const existing = await segments.findOne({ signature });
    if (existing) {
      // update audience_size proactively in case it changed
      await segments.updateOne({ _id: existing._id }, { $set: { audience_size, rules: normalizedRules }});
      const saved = await segments.findOne({ _id: existing._id });
      return res.status(200).json(saved);
    }

    // insert normalized doc
    const doc = {
      name,
      rules: normalizedRules,
      audience_size,
      signature,
      created_at: new Date()
    };

    const insertRes = await segments.insertOne(doc);
    const saved = await segments.findOne({ _id: insertRes.insertedId });
    return res.status(201).json(saved);

  } catch (err) {
    console.error('routes/segments POST / error', err);
    return res.status(500).json({ error: err.message });
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
