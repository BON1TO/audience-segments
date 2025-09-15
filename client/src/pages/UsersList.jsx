// client/src/pages/UsersList.jsx
import React, { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getUsers } from "../lib/api"; // use centralized helper

export default function UsersList({ apiUrl = "/api/users" }) {
  const pageSizeOptions = [10, 50, 100, "All"];
  const [pageSize, setPageSize] = useState(50);
  const [visibleUsers, setVisibleUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingAllProgress, setLoadingAllProgress] = useState(null);
  const [error, setError] = useState("");
  const abortRef = useRef(null);

  // (Replaced buildUrl + fetchPage to use getUsers helper)
  // fetchPage keeps the same signature: (limit, skip, signal)
  // but translates skip -> page to match backend paging.
  async function fetchPage(limit, skip, signal) {
    // If limit is null/undefined, treat as default page limit
    const lim = limit == null ? undefined : Number(limit);

    // Convert skip-based call into page number: page = floor(skip/limit)+1
    // If skip not provided, default to 0 -> page 1
    let page = 1;
    if (typeof skip === "number" && lim && lim > 0) {
      page = Math.floor(skip / lim) + 1;
    } else if (typeof skip === "number" && !lim) {
      // if no limit, assume page 1
      page = 1;
    }

    // Call centralized helper which returns { items, total, page, limit, raw }
    // Pass signal by doing a manual axios call is harder; getUsers uses axios which
    // doesn't accept signal easily here. For typical usage it's fine.
    // If you really need AbortController semantics, we can wire axios CancelToken.
    const resp = await getUsers(lim ? { limit: lim, page } : {});
    const items = resp.items ?? [];
    const totalFromBody = typeof resp.total === "number" ? resp.total : undefined;
    return { items, total: totalFromBody, ok: true, status: 200 };
  }

  useEffect(() => {
    let mounted = true;
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    async function load() {
      setLoading(true);
      setError("");
      setLoadingAllProgress(null);
      try {
        if (pageSize !== "All") {
          const limit = pageSize;
          const { items, total: totalFound, ok, status } = await fetchPage(limit, 0, signal);
          if (!ok) throw new Error(`Status ${status}`);
          if (!mounted) return;
          setVisibleUsers(items);
          setTotal(totalFound ?? items.length);
        } else {
          const chunk = 100;
          let all = [];
          let skip = 0;
          let fetchedPages = 0;
          const SAFETY_ITEM_CAP = 20000;
          while (true) {
            if (signal.aborted) throw new DOMException("Aborted", "AbortError");
            fetchedPages++;
            setLoadingAllProgress({ pages: fetchedPages, fetchedSoFar: all.length });
            const { items, total: totalFound, ok, status } = await fetchPage(chunk, skip, signal);
            if (!ok) throw new Error(`Status ${status}`);
            all = all.concat(items);
            skip += items.length;
            if (typeof totalFound === "number" && all.length >= totalFound) {
              setTotal(totalFound);
              break;
            }
            if (items.length < chunk) break;
            if (all.length > SAFETY_ITEM_CAP) throw new Error(`Reached safety cap of ${SAFETY_ITEM_CAP} items.`);
            await new Promise((r) => setTimeout(r, 50));
          }
          if (!mounted) return;
          setVisibleUsers(all);
          setTotal(all.length);
        }
      } catch (e) {
        if (e.name === "AbortError") {
          console.log("[UsersList] fetch aborted");
        } else {
          console.error("[UsersList] fetch error:", e);
          setError(String(e.message || "Failed to load users"));
        }
      } finally {
        if (mounted) setLoading(false);
        setLoadingAllProgress(null);
      }
    }

    load();
    return () => {
      mounted = false;
      if (abortRef.current) abortRef.current.abort();
    };
  }, [apiUrl, pageSize]);

  const handlePageSizeChange = (e) => {
    const val = e.target.value;
    setPageSize(val === "All" ? "All" : Number(val));
  };

  if (loading) {
    return (
      <div>
        <div>Loading users…</div>
        {loadingAllProgress && (
          <div style={{ color: "#9fb7d9", marginTop: 8 }}>
            Fetching pages: {loadingAllProgress.pages}, items fetched: {loadingAllProgress.fetchedSoFar}
          </div>
        )}
      </div>
    );
  }
  if (error) return <div style={{ color: "salmon" }}>Error: {error}</div>;

  return (
    <div className="container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div className="h1">Users</div>
          <div className="h2 muted">Manage, preview & view user details</div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <label style={{ fontSize: 13, color: "#9fb7d9" }}>Show:</label>
          <select
            value={pageSize}
            onChange={handlePageSizeChange}
            className="input"
            style={{ background: "#0b1220", color: "#e6eef8", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            {pageSizeOptions.map((opt) => (
              <option key={String(opt)} value={opt} style={{ color: "black" }}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 8, color: "#9fb7d9" }}>
        Showing {visibleUsers.length} of {total || visibleUsers.length} users
      </div>

      <div className="list">
        <AnimatePresence>
          {visibleUsers.map((u, idx) => {
            const key = u && (u._id || u.id) ? (u._id || u.id) : `user-${idx}`;
            return (
              <motion.div
                key={key}
                className="card list-item"
                custom={idx}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.28, ease: [0.22, 0.9, 0.32, 1] }}
                whileHover={{ y: -4, scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{u?.name ?? u?.email ?? "(no name)"}</div>
                    <div className="muted" style={{ fontSize: 13 }}>{u?.email ?? ""}</div>
                  </div>
                  <div>
                    <button className="btn ghost" onClick={() => { /* view user */ }}>View</button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
