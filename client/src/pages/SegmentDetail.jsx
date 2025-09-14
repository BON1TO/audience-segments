// client/src/pages/SegmentDetail.jsx
import React, { useEffect, useState } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { getSegment, getSegmentUsers } from "../lib/api";
import Card from "../components/Card";
import Spinner from "../components/Spinner";
import "../index.css";

export default function SegmentDetail({ apiUrl }) {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [segment, setSegment] = useState(location.state?.segment ?? null);
  const [loading, setLoading] = useState(!segment);
  const [error, setError] = useState("");
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  // load segment if not passed in via state
  useEffect(() => {
    if (segment) return;
    let mounted = true;
    setLoading(true);
    getSegment(id)
      .then(d => mounted && setSegment(d))
      .catch(e => { console.error(e); mounted && setError("Failed to load segment"); })
      .finally(() => mounted && setLoading(false));
    return () => (mounted = false);
  }, [id]);

  // load users for the segment
  useEffect(() => {
    if (!segment) return;
    let mounted = true;
    setUsersLoading(true);
    getSegmentUsers(segment._id ?? segment.id ?? id, { limit, page })
      .then(res => { if (!mounted) return; setUsers(res.items || []); })
      .catch(e => { console.error(e); if (mounted) setUsers([]); })
      .finally(() => mounted && setUsersLoading(false));
    return () => (mounted = false);
  }, [segment, page, limit]);

  if (loading) return <div style={{ padding: 24 }}><Spinner size={36} /></div>;
  if (error) return <div className="error" style={{ padding: 18 }}>{error}</div>;
  if (!segment) return <div style={{ padding: 18 }}>No segment found</div>;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 12 }}>
        <div style={{ display:'flex', gap: 12, alignItems:'center' }}>
          <button className="btn ghost" onClick={() => navigate(-1)}>← Back</button>
          <div>
            <h2 style={{ margin: 0 }}>{segment.name}</h2>
            <div className="muted">Audience: {segment.audience_size ?? '—'}</div>
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn">Edit</button>
          <button className="btn primary">Apply Campaign</button>
        </div>
      </div>

      <Card style={{ marginBottom: 12 }}>
        <div>
          <div className="muted">Description</div>
          <div style={{ marginTop: 8 }}>{segment.description || 'No description'}</div>
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Users in this segment</h3>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <select className="input" value={limit} onChange={e => { setLimit(Number(e.target.value)); setPage(1); }}>
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        {usersLoading ? (
          <div style={{ display:'flex', justifyContent:'center', padding: 18 }}><Spinner size={36} /></div>
        ) : users.length === 0 ? (
          <div className="muted" style={{ padding: 12 }}>No users found for this segment (or increase limit).</div>
        ) : (
          <AnimatePresence>
            <div style={{ display:'grid', gap: 8 }}>
              {users.map(u => (
                <motion.div key={u._id ?? u.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:10, borderRadius:8, background: 'linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.00))' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{u.name || u.email}</div>
                      <div className="muted" style={{ marginTop: 4 }}>{u.email}</div>
                    </div>
                    <div style={{ textAlign:'right' }} className="muted">
                      <div>visits: {u.visits ?? '-'}</div>
                      <div>spend: {u.total_spend ?? '-'}</div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* pagination for users returned by backend */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop: 12 }}>
              <div className="muted">Showing {users.length} users</div>
              <div style={{ display:'flex', gap:8 }}>
                <button className="btn" onClick={()=> setPage(p => Math.max(1, p-1))} disabled={page===1}>Prev</button>
                <div className="muted">Page {page}</div>
                <button className="btn" onClick={()=> setPage(p => p+1)}>Next</button>
              </div>
            </div>
          </AnimatePresence>
        )}
      </Card>
    </motion.div>
  );
}
