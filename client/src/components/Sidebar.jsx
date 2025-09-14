// client/src/components/Sidebar.jsx
import React from 'react';
import { NavLink } from 'react-router-dom';

export default function Sidebar() {
  return (
    <aside className="sidebar" aria-label="Sidebar">
      <div className="logo">
        <div className="mark">AS</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Audience</div>
          <div className="muted" style={{ fontSize: 12 }}>Segments manager</div>
        </div>
      </div>

      <nav>
        <NavLink to="/segments" className={({isActive}) => isActive ? 'active' : ''}>Segments</NavLink>
        <NavLink to="/campaigns" className={({isActive}) => isActive ? 'active' : ''}>Campaigns</NavLink>
        <NavLink to="/users" className={({isActive}) => isActive ? 'active' : ''}>Users</NavLink>
        <NavLink to="/profile" className={({isActive}) => isActive ? 'active' : ''}>Profile</NavLink>
      </nav>

      <div style={{ flex: 1 }} />

      <div className="muted" style={{ fontSize: 12 }}>
        v1.0 · <span style={{ color: 'rgba(255,255,255,0.6)' }}>local</span>
      </div>
    </aside>
  );
}
