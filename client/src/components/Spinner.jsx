// client/src/components/Spinner.jsx
import React from 'react';

export default function Spinner({ size = 24 }) {
  return (
    <div style={{ display: 'inline-block', width: size, height: size }}>
      <svg viewBox="0 0 50 50" style={{ width: '100%', height: '100%' }}>
        <circle cx="25" cy="25" r="20" stroke="rgba(255,255,255,0.12)" strokeWidth="6" fill="none" />
        <path d="M45 25a20 20 0 0 0-20-20" stroke="white" strokeWidth="6" strokeLinecap="round" fill="none">
          <animateTransform attributeName="transform" type="rotate" dur="0.9s" from="0 25 25" to="360 25 25" repeatCount="indefinite"/>
        </path>
      </svg>
    </div>
  );
}
