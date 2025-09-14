const mongoose = require("mongoose");

const SegmentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  // store whatever identifying rules / query you already use
  rules: { type: Array, default: [] },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Segment", SegmentSchema);
