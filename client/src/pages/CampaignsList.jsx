// src/pages/CampaignsList.jsx
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { listItemVariants, fadeIn } from "../styles/motionVariants";
import "../styles/theme.css";

export default function CampaignsList({
  apiUrl = "/api/campaigns",
  segmentsApi = "/api/segments",
}) {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [segments, setSegments] = useState([]);
  const [attachingTo, setAttachingTo] = useState(null); // campaign obj while attaching
  const [attachLoading, setAttachLoading] = useState(false);
  const [attachSegmentId, setAttachSegmentId] = useState("");
  const [previewing, setPreviewing] = useState(null); // campaign obj being previewed

  // ---------- helpers ----------
  const normalizeId = (raw) => {
    if (!raw) return null;
    if (typeof raw === "string") {
      const m = raw.match(/[0-9a-fA-F]{24}/);
      return m ? m[0] : raw;
    }
    if (raw && typeof raw === "object") {
      if (raw.$oid) return raw.$oid;
      if (raw.toString && typeof raw.toString === "function") {
        const s = raw.toString();
        const m = s.match(/[0-9a-fA-F]{24}/);
        if (m) return m[0];
      }
    }
    return null;
  };

  const getSegmentName = (campaignOrSegment) => {
    const segCandidate =
      campaignOrSegment && campaignOrSegment.segment
        ? campaignOrSegment.segment
        : campaignOrSegment;
    if (segCandidate && typeof segCandidate === "object") {
      return segCandidate.name || segCandidate.title || String(segCandidate._id || segCandidate.id).slice(0, 8);
    }
    const segIdCandidate =
      typeof campaignOrSegment?.segment === "string"
        ? campaignOrSegment.segment
        : campaignOrSegment?.segmentId
        ? String(campaignOrSegment.segmentId)
        : typeof campaignOrSegment === "string"
        ? campaignOrSegment
        : null;
    if (segIdCandidate) {
      const found = segments.find((s) => {
        const sid = s._id ?? s.id ?? s._id?.$oid;
        return String(sid) === String(segIdCandidate);
      });
      if (found) return found.name || found.title || String(found._id).slice(0, 8);
      return String(segIdCandidate).slice(0, 8);
    }
    return "Not linked";
  };

  const getSegmentAudience = (campaign) => {
    if (!campaign) return 0;
    if (typeof campaign.audience_size === "number") return campaign.audience_size;
    if (campaign.segment && typeof campaign.segment === "object" && typeof campaign.segment.audience_size === "number")
      return campaign.segment.audience_size;

    const segIdCandidate =
      typeof campaign.segment === "string" ? campaign.segment : campaign.segmentId ? String(campaign.segmentId) : null;
    if (segIdCandidate) {
      const found = segments.find((s) => {
        const sid = s._id ?? s.id ?? s._id?.$oid;
        return String(sid) === String(segIdCandidate);
      });
      if (found) return found.audience_size ?? found.audience ?? 0;
    }
    return 0;
  };

  // ---------- data loading ----------
  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");
        const res = await fetch(apiUrl, { signal: controller.signal });
        const text = await res.text();
        let data;
        try {
          data = text ? JSON.parse(text) : null;
        } catch (parseErr) {
          console.warn("[CampaignsList] response text (non-json):", text);
          throw new Error(`Non-JSON response (status ${res.status})`);
        }

        if (!res.ok) {
          console.warn("[CampaignsList] non-ok response:", res.status, data);
          throw new Error(`Status ${res.status}: ${data?.message || JSON.stringify(data)}`);
        }

        if (!mounted) return;

        const items =
          Array.isArray(data) && data.length
            ? data
            : Array.isArray(data?.items)
            ? data.items
            : Array.isArray(data?.campaigns)
            ? data.campaigns
            : Array.isArray(data?.data)
            ? data.data
            : [];

        setCampaigns(items);
      } catch (e) {
        if (e.name === "AbortError") {
          console.log("[CampaignsList] fetch aborted");
        } else {
          console.error("[CampaignsList] fetch error:", e);
          setError(String(e.message || "Failed to fetch campaigns"));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [apiUrl]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(segmentsApi);
        if (!res.ok) {
          console.warn("[CampaignsList] failed to load segments", res.status);
          return;
        }
        const data = await res.json();
        const list = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : data.segments || [];
        setSegments(list);
      } catch (err) {
        console.warn("[CampaignsList] segments load error:", err);
      }
    })();
  }, [segmentsApi]);

  // ---------- actions ----------
  const onCreate = () => navigate("/campaigns/new");

  const onPreview = async (c) => {
    const rawId = typeof c === "string" ? c : c && (c._id ?? c.id ?? c._id?.$oid);
    const id = normalizeId(rawId);
    if (!id) {
      console.warn("Cannot preview - missing campaign id", c);
      alert("Preview not available: campaign id missing (see console).");
      return;
    }

    try {
      setPreviewing({ _loading: true });

      const res = await fetch(`${apiUrl}/${id}`);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `Status ${res.status}`);
      }
      const campaign = await res.json();

      // compute audience (try segment users endpoint)
      let audience = typeof campaign.audience_size === "number" ? campaign.audience_size : 0;
      const segId = campaign.segment ?? campaign.segmentId ?? null;
      const segIdNorm = normalizeId(segId);
      if (segIdNorm) {
        try {
          const su = await fetch(`/api/segments/${segIdNorm}/users?limit=1`);
          if (su.ok) {
            const suData = await su.json();
            if (typeof suData.total === "number") audience = suData.total;
          } else {
            const sres = await fetch(`/api/segments/${segIdNorm}`);
            if (sres.ok) {
              const sdoc = await sres.json();
              if (typeof sdoc.audience_size === "number") audience = sdoc.audience_size;
            }
          }
        } catch (e) {
          console.warn("Failed to fetch segment audience:", e);
        }
      }

      setPreviewing({ ...campaign, audience_count: audience, _loading: false });
    } catch (err) {
      console.error("Preview failed:", err);
      setPreviewing(null);
      alert("Failed to load preview: " + (err.message || err));
    }
  };

  const openAttach = (campaign) => {
    setAttachingTo(campaign);
    setAttachSegmentId(
      campaign?.segment && typeof campaign.segment === "string"
        ? campaign.segment
        : campaign?.segment?._id ?? campaign?.segment?.id ?? ""
    );
  };
  const closeAttach = () => {
    setAttachingTo(null);
    setAttachSegmentId("");
  };

  const doAttach = async (campaignOrId, segmentId) => {
    const rawCampaignId =
      typeof campaignOrId === "string"
        ? campaignOrId
        : campaignOrId && (campaignOrId._id ?? campaignOrId.id ?? campaignOrId._id?.$oid);
    const campaignId = normalizeId(rawCampaignId);
    const segId = normalizeId(segmentId);

    if (!campaignId) {
      alert("Cannot attach: campaign id missing (check console).");
      console.warn("doAttach missing campaign id:", rawCampaignId);
      return;
    }

    setAttachLoading(true);
    try {
      const url = `${apiUrl}/${campaignId}`;
      const body = { segmentId: segId || "" };

      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `Status ${res.status}`);
      }

      // refresh campaigns
      const refreshed = await (await fetch(apiUrl)).json();
      const items = Array.isArray(refreshed)
        ? refreshed
        : refreshed.items || refreshed.campaigns || refreshed.data || [];
      setCampaigns(items);
      closeAttach();
    } catch (err) {
      console.error("Attach failed:", err);
      alert("Attach failed: " + String(err.message));
    } finally {
      setAttachLoading(false);
    }
  };

  // ---------- render ----------
  if (loading) {
    // simple skeleton-ish loader
    return (
      <div className="container">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div className="h1">Campaigns</div>
            <div className="h2 muted">Target, schedule & send</div>
          </div>
          <button className="btn btn-primary" onClick={onCreate}>
            + New Campaign
          </button>
        </div>

        <div className="list">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card list-item" style={{ minHeight: 72 }}>
              <div style={{ flex: 1 }}>
                <div style={{ width: "60%", height: 12, background: "rgba(255,255,255,0.02)", borderRadius: 6 }} />
                <div style={{ marginTop: 8, width: "40%", height: 10, background: "rgba(255,255,255,0.01)", borderRadius: 6 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) return <div className="container"><div style={{ color: "salmon" }}>Error: {error}</div></div>;

  return (
    <div className="container" role="region" aria-labelledby="campaigns-heading">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div id="campaigns-heading" className="h1">Campaigns</div>
          <div className="h2 muted">Target, schedule & send</div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn ghost" onClick={() => window.location.reload()} aria-label="Refresh campaigns">Refresh</button>
          <button className="btn btn-primary" onClick={onCreate} aria-label="Create campaign">+ New Campaign</button>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 700 }}>No campaigns yet</div>
              <div className="muted" style={{ marginTop: 6 }}>Create a campaign to get started.</div>
            </div>
            <button className="btn btn-primary" onClick={onCreate}>Create</button>
          </div>
        </div>
      ) : (
        <div className="list" aria-live="polite">
          <AnimatePresence>
            {campaigns.map((c, idx) => {
              const key = c && (c._id || c.id) ? c._id || c.id : `campaign-${idx}`;
              const displayTitle =
                c?.title ||
                c?.name ||
                (c?.meta && (c.meta.title || c.meta.name)) ||
                (c?.details && (c.details.title || c.details.name)) ||
                "(no title)";
              const segmentName = getSegmentName(c);

              return (
                <motion.article
                  className="card list-item"
                  key={key}
                  custom={idx}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  variants={listItemVariants}
                  transition={{ duration: 0.28 }}
                  role="group"
                  aria-labelledby={`campaign-${key}-title`}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flex: 1 }}>
                      <div className="accent-line" style={{ height: 44, width: 8, borderRadius: 8 }} />
                      <div style={{ flex: 1 }}>
                        <div id={`campaign-${key}-title`} style={{ fontWeight: 700 }}>{displayTitle}</div>
                        <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>{c.description ?? ""}</div>
                        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>Segment: {segmentName}</div>
                      </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                      <div className="muted" style={{ fontSize: 12 }}>{c.status || "draft"}</div>

                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn" onClick={() => onPreview(c)}>Preview</button>
                        <button className="btn ghost" onClick={() => openAttach(c)}>Attach</button>
                        <button
                          className="btn"
                          onClick={() => navigate(`/campaigns/${normalizeId(c._id ?? c.id ?? c._id?.$oid)}`)}
                          aria-label={`Edit ${displayTitle}`}
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Attach modal */}
      <AnimatePresence>
        {attachingTo && (
          <motion.div
            className="modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(2,6,23,0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
            }}
            onClick={closeAttach}
            aria-modal="true"
            role="dialog"
          >
            <motion.div
              className="card"
              initial={{ y: 12, opacity: 0, scale: 0.99 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 8, opacity: 0, scale: 0.995 }}
              transition={{ duration: 0.22 }}
              onClick={(e) => e.stopPropagation()}
              style={{ minWidth: 320, maxWidth: 520 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0 }}>Attach campaign to segment</h3>
                <button className="btn ghost" onClick={closeAttach} aria-label="Close attach dialog">Close</button>
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ marginBottom: 8 }}>
                  <strong>Campaign:</strong> {attachingTo.title || attachingTo.name || "(no title)"}
                </div>

                <label htmlFor="attach-seg" className="muted" style={{ display: "block", marginBottom: 6 }}>
                  Select segment
                </label>
                <select
                  id="attach-seg"
                  className="input"
                  value={attachSegmentId || ""}
                  onChange={(e) => setAttachSegmentId(e.target.value)}
                >
                  <option value="">-- No segment --</option>
                  {segments.map((s) => (
                    <option key={s._id || s.id} value={s._id || s.id}>
                      {s.name || s.title || `Segment ${s._id || s.id}`}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                <button className="btn ghost" onClick={closeAttach}>Cancel</button>
                <button
                  className="btn btn-primary"
                  disabled={attachLoading}
                  onClick={() => doAttach(attachingTo, attachSegmentId)}
                >
                  {attachLoading ? "Attaching…" : "Attach"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Preview modal */}
      <AnimatePresence>
        {previewing && (
          <motion.div
            className="modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(2,6,23,0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
            }}
            onClick={() => setPreviewing(null)}
            aria-modal="true"
            role="dialog"
          >
            <motion.div
              className="card"
              initial={{ y: 12, opacity: 0, scale: 0.99 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 8, opacity: 0, scale: 0.995 }}
              transition={{ duration: 0.22 }}
              onClick={(e) => e.stopPropagation()}
              style={{ minWidth: 320, maxWidth: 720 }}
            >
              {previewing._loading ? (
                <div>Loading preview…</div>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h3 style={{ margin: 0 }}>{previewing.title || previewing.name || "(no title)"}</h3>
                    <button className="btn ghost" onClick={() => setPreviewing(null)} aria-label="Close preview">Close</button>
                  </div>

                  <p style={{ marginTop: 12, color: "var(--muted)" }}>{previewing.description || "No description"}</p>

                  <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                    <div><strong>Segment:</strong> {previewing.segment?.name || getSegmentName(previewing)}</div>
                    <div><strong>Audience:</strong> {typeof previewing.audience_count === "number" ? previewing.audience_count : getSegmentAudience(previewing)}</div>
                    <div><strong>Created:</strong> {previewing.created_at ? new Date(previewing.created_at).toLocaleString() : "—"}</div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                    <button className="btn" onClick={() => setPreviewing(null)}>Close</button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
