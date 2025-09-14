// src/App.jsx
import React from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";

import Sidebar from "./components/Sidebar";
import Home from "./pages/Home";
import SegmentNew from "./pages/SegmentNew";
import SegmentsList from "./pages/SegmentsList";
import SegmentDetail from "./pages/SegmentDetail";
import CampaignsList from "./pages/CampaignsList";
import CampaignNew from "./pages/CampaignNew";
import UsersList from "./pages/UsersList";
import NotFound from "./pages/NotFound";

// Theme + motion presets (create these files if you haven't yet)
import "./styles/theme.css"; // modern dark/bluish theme (recommended)
import { pageVariants } from "./styles/motionVariants"; // framer motion variants

export default function App() {
  const location = useLocation();

  return (
    <div className="layout" style={{ minHeight: "100vh", display: "flex" }}>
      <Sidebar />

      <div className="main" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <header
          className="app-header card-sm"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: 14,
            gap: 12,
            borderBottom: "1px solid rgba(255,255,255,0.02)",
            backdropFilter: "blur(6px)",
          }}
        >
          <div className="left" style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <motion.h1
              style={{ margin: 0, fontSize: 18 }}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
            >
              Audience Segments
            </motion.h1>

            <div className="muted" style={{ marginLeft: 6 }}>
              Manage users, campaigns & previews
            </div>
          </div>

          <div className="controls" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <motion.button
              className="btn ghost"
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.98 }}
              aria-label="Help"
            >
              Help
            </motion.button>

            <motion.button
              className="btn"
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.98 }}
              aria-label="Sign in"
            >
              Sign in
            </motion.button>
          </div>
        </header>

        <main id="content" style={{ flex: 1, padding: 20 }}>
          <AnimatePresence mode="wait">
            {/* motion wrapper keyed by pathname to animate route transitions */}
            <motion.div
              key={location.pathname}
              initial="initial"
              animate="in"
              exit="out"
              variants={pageVariants}
              style={{ minHeight: "60vh" }}
            >
              <Routes location={location} key={location.pathname}>
                {/* default -> segments */}
                <Route path="/" element={<Navigate to="/segments" replace />} />

                {/* pages */}
                <Route path="/segments/new" element={<SegmentNew />} />
                <Route path="/segments" element={<SegmentsList />} />
                <Route path="/segments/:id" element={<SegmentDetail />} />

                <Route path="/campaigns" element={<CampaignsList />} />
                <Route path="/campaigns/new" element={<CampaignNew />} />

                <Route path="/users" element={<UsersList />} />
                <Route path="/home" element={<Home />} />

                {/* fallback */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Floating Action Button (quick new campaign) */}
      <motion.button
        className="btn btn-primary"
        style={{
          position: "fixed",
          right: 28,
          bottom: 28,
          borderRadius: 999,
          padding: "14px 18px",
          zIndex: 60,
          boxShadow: "0 12px 40px rgba(91,120,255,0.16)",
        }}
        whileHover={{ scale: 1.03, y: -4 }}
        whileTap={{ scale: 0.97 }}
        onClick={() => {
          // navigate to new campaign — using a location change is simplest here
          // If you prefer programmatic navigation, replace with useNavigate hook.
          window.location.href = "/campaigns/new";
        }}
        aria-label="Create new campaign"
      >
        + New
      </motion.button>
    </div>
  );
}
