// client/src/pages/SegmentsList.jsx
import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { getSegments } from "../lib/api";
import Card from "../components/Card";
import Spinner from "../components/Spinner";
import "../index.css";

/*
  Minimal safe animation upgrade:
  - keeps all original behavior (API, pagination, filtering, navigation)
  - improved motion: staggered list entrance, eased easing, hover/tap micro-interactions
  - uses Framer Motion's `custom` prop to stagger per-index
*/

const listItemVariants = {
  hidden: { opacity: 0, y: 10, scale: 0.997 },
  show: (i) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      delay: Math.min(0.15, i * 0.03), // small stagger but capped so long lists don't lag
      duration: 0.36,
      ease: [0.22, 0.9, 0.32, 1],
    },
  }),
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: 0.18, ease: [0.22, 0.9, 0.32, 1] },
  },
};

export default function SegmentsList({ apiUrl }) {
  const navigate = useNavigate();
  const [segments, setSegments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  // load segments (unchanged logic)
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    getSegments(apiUrl)
      .then(data => {
        if (!mounted) return;
        setSegments(Array.isArray(data) ? data : data.items || []);
      })
      .catch(e => {
        console.error(e);
        if (mounted) setError("Failed to load segments");
      })
      .finally(() => mounted && setLoading(false));
    return () => (mounted = false);
  }, [apiUrl]);

  // filtered + paginated (unchanged)
  const filtered = useMemo(() => {
    if (!q) return segments;
    const s = q.trim().toLowerCase();
    return segments.filter(x =>
      ((x.name || "").toLowerCase().includes(s)) ||
      ((x.description || "").toLowerCase().includes(s))
    );
  }, [segments, q]);

  const total = filtered.length;
  const effectivePageSize = pageSize === "all" ? (total || 1) : Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(total / effectivePageSize));
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [totalPages]);

  const start = (page - 1) * effectivePageSize;
  const visible = pageSize === 'all' ? filtered : filtered.slice(start, start + effectivePageSize);

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent:'space-between', alignItems:'center', gap: 12, marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Segments</h2>
          <div className="muted">Manage audience segments — preview users, apply campaigns</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn secondary" onClick={() => navigate('/segments/new')}>+ New</button>
          <input
            className="input"
            placeholder="Search segments..."
            aria-label="Search segments"
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1); }}
            style={{ minWidth: 220 }}
          />
          <select
            className="input"
            value={pageSize}
            onChange={e => { setPageSize(e.target.value === 'all' ? 'all' : Number(e.target.value)); setPage(1); }}
          >
            <option value="10" style={{ background: "#1a1a1a", color: "#ffffff" }}>10</option>
  <option value="25" style={{ background: "#1a1a1a", color: "#ffffff" }}>25</option>
  <option value="50" style={{ background: "#1a1a1a", color: "#ffffff" }}>50</option>
  <option value="all" style={{ background: "#1a1a1a", color: "#ffffff" }}>All</option>
          </select>
        </div>
      </div>

      <Card>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 28 }}>
            <Spinner size={36} />
          </div>
        ) : error ? (
          <div className="error">{error}</div>
        ) : total === 0 ? (
          <div className="muted" style={{ padding: 18 }}>No segments yet — create one with rules to target users.</div>
        ) : (
          <>
            <div role="list" style={{ display: 'grid', gap: 8 }}>
              <AnimatePresence>
                {(visible || []).map((seg, idx) => (
                  <motion.div
                    key={seg._id ?? seg.id}
                    layout
                    custom={idx}
                    initial="hidden"
                    animate="show"
                    exit="exit"
                    variants={listItemVariants}
                    transition={{ duration: 0.26 }}
                    onClick={() => navigate(`/segments/${seg._id ?? seg.id}`, { state: { segment: seg } })}
                    className="segment-row"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/segments/${seg._id ?? seg.id}`, { state: { segment: seg } }); }}
                    style={{ cursor: 'pointer', outline: 'none' }}
                    whileHover={{ y: -4, scale: 1.01 }}
                    whileTap={{ scale: 0.995 }}
                    aria-label={`Open segment ${seg.name || (seg._id ?? seg.id)}`}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{seg.name || 'Unnamed segment'}</div>
                        <div className="muted" style={{ marginTop: 4 }}>{seg.description || `${seg.audience_size ?? 0} users`}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="muted">Audience</div>
                        <div style={{ fontWeight: 700 }}>{seg.audience_size ?? '—'}</div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* pagination */}
            {pageSize !== 'all' && totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                <div className="muted">Showing {Math.min(total, start + 1)} - {Math.min(total, start + (visible?.length || 0))} of {total}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="btn" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}>Prev</button>
                  <div className="muted">Page {page} / {totalPages}</div>
                  <button className="btn" onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}>Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
