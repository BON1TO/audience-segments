// routes/campaigns.js
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
    const { campaigns } = getCollections(req);
    const list = await campaigns.find({}).sort({ created_at: -1 }).toArray();
    res.json(list);
  } catch (err) {
    console.error('routes/campaigns GET / error', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { campaigns } = getCollections(req);
    const { title, description, segment } = req.body;
    if (!title) return res.status(400).json({ error: 'Missing title' });
    const insertRes = await campaigns.insertOne({ title, description: description||'', segment: segment || null, audience_size:0, sent_count:0, failed_count:0, created_at: new Date() });
    const saved = await campaigns.findOne({ _id: insertRes.insertedId });
    res.status(201).json(saved);
  } catch (err) {
    console.error('routes/campaigns POST / error', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { campaigns } = getCollections(req);
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });
    const doc = await campaigns.findOne({ _id: new ObjectId(id) });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) {
    console.error('routes/campaigns GET /:id error', err);
    res.status(500).json({ error: err.message });
  }
});


// routes/campaigns.js  — add below the existing routes

// PATCH /api/campaigns/:id
// Accepts { segmentId } in JSON body and attaches that segment to the campaign
// PATCH /api/campaigns/:id  — robust + debug-friendly
// DEBUG-PATCH /api/campaigns/:id  (replace your existing router.patch with this)
// PATCH /api/campaigns/:id  — robust: match ObjectId(_id) OR string _id
// PATCH /api/campaigns/:id  — robust two-step: find then update by the found doc's real _id
// PATCH /api/campaigns/:id  — robust two-step: find then update by the found doc's real _id
router.patch('/:id', async (req, res) => {
  try {
    const { campaigns, segments } = getCollections(req);
    const id = req.params.id;
    const body = req.body || {};

    console.log('[PATCH /api/campaigns/:id] params.id=', id, 'body=', JSON.stringify(body));

    // Build flexible find filter (try ObjectId form and string form)
    let findFilter;
    if (ObjectId.isValid(id)) {
      findFilter = { $or: [{ _id: new ObjectId(id) }, { _id: String(id) }] };
    } else {
      findFilter = { _id: String(id) };
    }

    console.log('[PATCH] findFilter:', findFilter);

    // First, find the document so we can use the exact stored _id value
    const existing = await campaigns.findOne(findFilter);
    console.log('[PATCH] findOne result:', existing ? { _id: existing._id } : null);

    if (!existing) {
      return res.status(404).json({ error: 'Campaign not found', tried: findFilter });
    }

    // Build the update payload (attach or detach)
    const segRaw = body.segmentId ?? body.segment ?? null;
    const segObjId = segRaw && ObjectId.isValid(String(segRaw)) ? new ObjectId(String(segRaw)) : null;
    const update = segObjId ? { $set: { segment: segObjId } } : { $unset: { segment: "" } };

    // Now update using the exact _id value returned by findOne (this avoids type mismatches)
    const updateResult = await campaigns.updateOne(
      { _id: existing._id }, // use the exact stored BSON _id
      update
    );

    console.log('[PATCH] updateResult:', {
      matchedCount: updateResult.matchedCount,
      modifiedCount: updateResult.modifiedCount,
      acknowledged: updateResult.acknowledged
    });

    if (!updateResult || updateResult.matchedCount === 0) {
      // no match — unexpected because we just found the doc
      console.warn('[PATCH] update did not match any document (unexpected). existing._id=', existing._id);
      return res.status(500).json({ error: 'Failed to update campaign (no match)' });
    }

    // Fetch the updated document explicitly and return it
    const updated = await campaigns.findOne({ _id: existing._id });
    if (!updated) {
      console.error('[PATCH] update reported success but fetching updated doc failed. existing._id=', existing._id);
      return res.status(500).json({ error: 'Failed to fetch updated campaign' });
    }

    // optional: populate segment object for client convenience
    if (updated.segment) {
      try {
        const segDoc = await segments.findOne({ _id: updated.segment });
        if (segDoc) updated.segment = segDoc;
      } catch (e) { /* ignore */ }
    }

    console.log('[PATCH] updated campaign _id=', String(updated._id));
    return res.json(updated);
  } catch (err) {
    console.error('routes/campaigns PATCH /:id error', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});







module.exports = router;
