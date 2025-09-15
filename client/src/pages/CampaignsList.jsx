// client/src/pages/CampaignsList.jsx
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { listItemVariants, fadeIn } from "../styles/motionVariants";
import "../styles/theme.css";
import api from "../lib/api"; // <-- import axios instance

export default function CampaignsList({
  apiUrl = "/api/campaigns",
  segmentsApi = "/api/segments",
}) {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [segments, setSegments] = useState([]);
  const [attachingTo, setAttachingTo] = useState(null);
  const [attachLoading, setAttachLoading] = useState(false);
  const [attachSegmentId, setAttachSegmentId] = useState("");
  const [previewing, setPreviewing] = useState(null);

  // helpers (unchanged) ...
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
      campaignOrSegment && campaignOrSegment.segment ? campaignOrSegment.segment : campaignOrSegment;
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

        // use axios (api) instance (supports cancellation via CancelToken if needed)
        const resp = await api.get(apiUrl); // resp.data expected
        if (!mounted) return;

        const data = resp.data;
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
        if (e.name === "CanceledError" || e?.__CANCEL__) {
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
        const resp = await api.get(segmentsApi);
        if (!resp || resp.status >= 400) {
          console.warn("[CampaignsList] failed to load segments", resp?.status);
          return;
        }
        const data = resp.data;
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

      const resp = await api.get(`${apiUrl}/${id}`);
      if (!resp || resp.status >= 400) {
        const txt = resp?.data ? JSON.stringify(resp.data) : `Status ${resp?.status}`;
        throw new Error(txt || `Status ${resp?.status}`);
      }
      const campaign = resp.data;

      // compute audience (try segment users endpoint)
      let audience = typeof campaign.audience_size === "number" ? campaign.audience_size : 0;
      const segId = campaign.segment ?? campaign.segmentId ?? null;
      const segIdNorm = normalizeId(segId);
      if (segIdNorm) {
        try {
          // use absolute backend for segment user requests (axios)
          const suResp = await api.get(`/api/segments/${segIdNorm}/users?limit=1`);
          if (suResp.status === 200) {
            const suData = suResp.data;
            if (typeof suData.total === "number") audience = suData.total;
          } else {
            const sres = await api.get(`/api/segments/${segIdNorm}`);
            if (sres.status === 200) {
              const sdoc = sres.data;
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

      // use axios PATCH
      const res = await api.patch(url, body);
      if (!res || res.status >= 400) {
        throw new Error(JSON.stringify(res?.data || `Status ${res?.status}`));
      }

      // refresh campaigns
      const refreshedResp = await api.get(apiUrl);
      const refreshed = refreshedResp.data;
      const items = Array.isArray(refreshed) ? refreshed : refreshed.items || refreshed.campaigns || refreshed.data || [];
      setCampaigns(items);
      closeAttach();
    } catch (err) {
      console.error("Attach failed:", err);
      alert("Attach failed: " + String(err?.message || err));
    } finally {
      setAttachLoading(false);
    }
  };

  // ---------- render ----------
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
      {/* ... rest is unchanged ... */}
