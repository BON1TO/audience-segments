// client/src/components/Card.jsx
import React from 'react';

export default function Card({ children, style = {}, ...rest }) {
  return (
    <div
      {...rest}
      style={{
        background: 'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))',
        border: '1px solid rgba(255,255,255,0.04)',
        padding: 14,
        borderRadius: 12,
        boxShadow: '0 6px 18px rgba(2,6,23,0.6)',
        ...style
      }}
    >
      {children}
    </div>
  );
}
