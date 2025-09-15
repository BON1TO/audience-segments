// client/src/pages/CampaignNew.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api"; // <-- use centralized axios instance

export default function CampaignNew({ apiUrl = "/api/campaigns" }) {
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
      // use axios instance (it will use the BASE you set in lib/api.js)
      const resp = await api.post(apiUrl, { title, description });
      // success -> go to campaigns list
      navigate("/campaigns");
    } catch (err) {
      // axios error handling
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        "Save failed";
      setError(String(msg));
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
