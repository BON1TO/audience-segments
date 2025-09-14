import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

export default function PeopleList({ apiUrl }) {
  const navigate = useNavigate();
  const [allPeople, setAllPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(apiUrl);
        const data = await res.json();
        setAllPeople(Array.isArray(data) ? data : data.items || []);
      } catch (err) {
        setError("Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [apiUrl]);

  if (loading) return <div>Loading...</div>;
  if (error) return <div style={{ color: "red" }}>{error}</div>;

  const total = allPeople.length;
  const effectivePageSize = pageSize === "all" ? total : pageSize;
  const totalPages = Math.ceil(total / effectivePageSize);
  const start = (currentPage - 1) * effectivePageSize;
  const end = pageSize === "all" ? total : start + effectivePageSize;
  const visible = allPeople.slice(start, end);

  return (
    <div style={{ maxWidth: 800, margin: "20px auto", padding: 20 }}>
      <button onClick={() => navigate(-1)} style={{ marginBottom: 20 }}>
        ⬅ Back
      </button>

      <div style={{ marginBottom: 16 }}>
        Show:
        <select
          value={pageSize}
          onChange={(e) =>
            setPageSize(e.target.value === "all" ? "all" : Number(e.target.value))
          }
          style={{ marginLeft: 8 }}
        >
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value="all">All</option>
        </select>
      </div>

      <AnimatePresence>
        {visible.map((p, i) => (
          <motion.div
            key={p.id ?? i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            style={{
              padding: 12,
              marginBottom: 8,
              borderRadius: 8,
              background: "#f0f4ff",
            }}
          >
            <strong>{p.name || `Person ${start + i + 1}`}</strong>
            <div style={{ fontSize: 12, color: "#555" }}>{p.email || ""}</div>
          </motion.div>
        ))}
      </AnimatePresence>

      {pageSize !== "all" && (
        <div style={{ marginTop: 16 }}>
          <button
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
          >
            Prev
          </button>
          <span style={{ margin: "0 8px" }}>
            Page {currentPage} of {totalPages}
          </span>
          <button
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
