// client/src/pages/CampaignNew.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";

export default function CampaignNew() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await api.post("/api/campaigns", { title, description });
      // if backend returns created doc, you can navigate to list
      navigate("/campaigns");
    } catch (err) {
      console.error("Campaign save error:", err?.response?.data ?? err);
      const txt = err?.response?.data?.message || err?.message || "Save failed";
      setError(String(txt));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Create Campaign</h2>
      {error && <div style={{ color: "salmon" }}>Error: {error}</div>}
      <form onSubmit={submit}>
        <div style={{ marginBottom: 8 }}>
          <label>Title</label><br />
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div style={{ marginBottom: 8 }}>
          <label>Description</label><br />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => navigate("/campaigns")} style={{ marginLeft: 8 }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
