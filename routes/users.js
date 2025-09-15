// routes/users.js
const express = require('express');
const router = express.Router();

// Helper to get collections from req.app.locals
function getCollections(req) {
  const cols = req.app && req.app.locals && req.app.locals.collections;
  if (!cols) throw new Error('Collections not available on req.app.locals.collections');
  return cols;
}

/**
 * GET /api/users
 * - supports ?q=search, ?limit, ?page
 * - returns { total, page, limit, users: [...] } (or array if you prefer)
 */
router.get('/', async (req, res) => {
  try {
    const { users } = getCollections(req);

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(200, parseInt(req.query.limit || req.query.limit || '50', 10));
    const skip = (page - 1) * limit;

    const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : null;
    const filter = {};
    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } }
      ];
    }

    const cursor = users.find(filter, { projection: { name:1, email:1, total_spend:1, visits:1, last_active_at:1 } });
    const total = await cursor.count();
    const list = await cursor.skip(skip).limit(limit).toArray();

    res.json({ total, page, limit, users: list });
  } catch (err) {
    console.error('routes/users GET / error', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/users/sample
 * - debug: small sample + count
 */
router.get('/sample', async (req, res) => {
  try {
    const { users } = getCollections(req);
    const sample = await users.find({}, { projection: { name:1, email:1, total_spend:1, visits:1, last_active_at:1 } })
      .limit(20).toArray();
    const count = await users.countDocuments();
    res.json({ count, sample });
  } catch (err) {
    console.error('routes/users GET /sample error', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
