// routes/segments.js
const express = require('express');
const { ObjectId } = require('mongodb');
const router = express.Router();

function getCollections(req) {
  const cols = req.app && req.app.locals && req.app.locals.collections;
  if (!cols) throw new Error('Collections not available on req.app.locals.collections');
  return cols;
}

router.get('/', async (req, res) => {
  try {
    const { segments } = getCollections(req);
    const list = await segments.find({}, { projection: { name:1, audience_size:1, created_at:1 } }).sort({ created_at: -1 }).toArray();
    res.json(list);
  } catch (err) {
    console.error('routes/segments GET / error', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { segments, users } = getCollections(req);
    const { name, rules } = req.body;
    if (!name || !rules) return res.status(400).json({ error: 'Missing name or rules' });
    const insertRes = await segments.insertOne({ name, rules, audience_size: 0, created_at: new Date() });
    const saved = await segments.findOne({ _id: insertRes.insertedId });
    res.status(201).json(saved);
  } catch (err) {
    console.error('routes/segments POST / error', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { segments } = getCollections(req);
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });
    const seg = await segments.findOne({ _id: new ObjectId(id) });
    if (!seg) return res.status(404).json({ error: 'Not found' });
    res.json(seg);
  } catch (err) {
    console.error('routes/segments GET /:id error', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
