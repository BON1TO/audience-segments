// client/src/pages/CampaignsList.jsx
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { listItemVariants } from "../styles/motionVariants";
import "../styles/theme.css";
import api, { getCampaigns as getCampaignsHelper, getSegments as getSegmentsHelper, getCampaign as getCampaignHelper } from "../lib/api";

export default function CampaignsList() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [segments, setSegments] = useState([]);
  const [attachingTo, setAttachingTo] = useState(null);
  const [attachLoading, setAttachLoading] = useState(false);
  const [attachSegmentId, setAttachSegmentId] = useState("");
  const [previewing, setPreviewing] = useState(null);

  // Helper functions retained as-is (normalizeId/getSegmentName/getSegmentAudience)...
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

  // load campaigns
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setError("");
        // use helper to fetch campaigns (returns normalized { items,... })
        const resp = await getCampaignsHelper();
        // getCampaigns helper returns { items, total, ... } via normalizeListResponse
        const list = Array.isArray(resp.items) ? resp.items : Array.isArray(resp) ? resp : [];
        if (!mounted) return;
        setCampaigns(list);
      } catch (e) {
        console.error("[CampaignsList] fetch error:", e);
        if (mounted) setError("Failed to load campaigns");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => (mounted = false);
  }, []);

  // load segments for attaching/labels
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const resp = await getSegmentsHelper();
        const list = Array.isArray(resp.items) ? resp.items : Array.isArray(resp) ? resp : [];
        if (!mounted) return;
        setSegments(list);
      } catch (err) {
        console.warn("[CampaignsList] segments load error:", err);
      }
    })();
    return () => (mounted = false);
  }, []);

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
      const campaign = (await getCampaignHelper(id)) || null;
      if (!campaign) throw new Error("Campaign not found");

      // compute audience via segment endpoints using helper calls
      let audience = typeof campaign.audience_size === "number" ? campaign.audience_size : 0;
      const segId = campaign.segment ?? campaign.segmentId ?? null;
      const segIdNorm = normalizeId(segId);
      if (segIdNorm) {
        try {
          // try /api/segments/:id/users?limit=1 using helper (but that helper returns normalized data)
          const su = await api.get(`/api/segments/${segIdNorm}/users`, { params: { limit: 1 } });
          if (su?.data && typeof su.data.total === "number") {
            audience = su.data.total;
          } else {
            // fallback to segment doc
            const sdoc = await api.get(`/api/segments/${segIdNorm}`);
            if (sdoc?.data && typeof sdoc.data.audience_size === "number") audience = sdoc.data.audience_size;
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
      const url = `/api/campaigns/${campaignId}`;
      const body = { segmentId: segId || null };

      await api.patch(url, body);

      // refresh campaigns using helper
      const refreshed = await getCampaignsHelper();
      const items = Array.isArray(refreshed.items) ? refreshed.items : Array.isArray(refreshed) ? refreshed : [];
      setCampaigns(items);
      closeAttach();
    } catch (err) {
      console.error("Attach failed:", err);
      alert("Attach failed: " + String(err?.message || err));
    } finally {
      setAttachLoading(false);
    }
  };

  if (loading) {
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
      {/* ... the rest of your render is unchanged, using campaigns state */}
      {/* (omitted here for brevity, keep the JSX from your original file) */}
    </div>
  );
}
