const express = require("express");
const router = express.Router();
const Campaign = require("../models/Campaign");

// Create a new campaign
router.post("/", async (req, res) => {
  try {
    const { title, description, segment } = req.body;

    const campaign = new Campaign({
      title,
      description,
      segment: segment || null, // may be undefined if not chosen
    });

    await campaign.save();

    // return populated campaign
    const populated = await Campaign.findById(campaign._id).populate("segment", "name");
    res.status(201).json(populated);
  } catch (err) {
    console.error("Create campaign error:", err);
    res.status(500).json({ message: err.message });
  }
});

// Get all campaigns
router.get("/", async (req, res) => {
  try {
    const campaigns = await Campaign.find()
      .sort({ createdAt: -1 })
      .populate("segment", "name"); // only return segment name + id
    res.json(campaigns);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get one campaign (for Preview)
router.get("/:id", async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).populate("segment", "name");
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update (attach to segment, change title, etc.)
router.patch("/:id", async (req, res) => {
  try {
    const { title, description, status, segment } = req.body;

    const campaign = await Campaign.findByIdAndUpdate(
      req.params.id,
      { $set: { title, description, status, segment } },
      { new: true, runValidators: true }
    ).populate("segment", "name");

    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
