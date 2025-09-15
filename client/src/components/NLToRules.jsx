// client/src/components/NLToRules.jsx
import React, { useState } from 'react';
import api from '../lib/api'; // if this path differs, adjust to where your axios wrapper is

export default function NLToRules({ availableFields = ['last_purchase_date','total_spend','visits','avg_order_value','city','signup_date'], onApply }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [ast, setAst] = useState(null);
  const [internalRules, setInternalRules] = useState([]);
  const [error, setError] = useState(null);
  const [segmentName, setSegmentName] = useState('');

  async function handleConvert() {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.post('/api/nl2rules', { text, availableFields });
      const { ast: gotAst, internalRules: gotInternalRules } = resp.data;
      setAst(gotAst);
      setInternalRules(gotInternalRules || []);
      setSegmentName(gotAst?.name_suggestion || '');
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Conversion failed');
      setAst(null);
      setInternalRules([]);
    } finally {
      setLoading(false);
    }
  }

  function updateRuleValue(idx, newVal) {
    const copy = [...internalRules];
    copy[idx] = { ...copy[idx], value: newVal };
    setInternalRules(copy);
  }

  // Apply: by default this will POST to /api/segments to save the segment.
  // If you want to just pass rules to a parent form instead, attach an onApply prop.
  async function applySegment() {
    if (!segmentName) { setError('Please provide a segment name.'); return; }
    const payload = { name: segmentName, rules: internalRules };
    try {
      // if parent wants to handle saving, call onApply
      if (onApply) {
        onApply({ ast, internalRules });
        return;
      }
      const resp = await api.post('/api/segments', payload);
      alert('Segment created/updated');
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to save segment');
    }
  }

  return (
    <div style={{ border: '1px solid #e6e6e6', padding: 12, borderRadius: 6, marginTop: 12 }}>
      <h4 style={{ margin: 0, marginBottom: 8 }}>AI: Natural Language → Segment Rules</h4>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='e.g. "People who haven’t shopped in 6 months and spent over ₹5K"'
        rows={3}
        style={{ width: '100%', marginBottom: 8, padding: 8 }}
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button onClick={handleConvert} disabled={loading || !text}>
          {loading ? 'Converting...' : 'Convert'}
        </button>
        <button onClick={() => setText("People who haven’t shopped in 6 months and spent over ₹5K")}>Example</button>
        <button onClick={() => { setText(''); setAst(null); setInternalRules([]); setError(null); }}>Clear</button>
      </div>

      {error && <div style={{ color: 'red', marginBottom: 8 }}>{error}</div>}

      {ast && (
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 8 }}>
            <label style={{ marginRight: 8 }}>Segment Name:</label>
            <input value={segmentName} onChange={(e) => setSegmentName(e.target.value)} style={{ width: 320, padding: 6 }} />
          </div>

          <div style={{ marginBottom: 8 }}>
            <strong>Parsed AST</strong>
            <pre style={{
  background: '#1e1e1e',   // dark gray (VS Code-like)
  color: '#f8f8f2',        // light text
  padding: 12,
  borderRadius: 6,
  maxHeight: 200,
  overflow: 'auto',
  fontSize: 13,
  lineHeight: 1.4
}}>
  {JSON.stringify(ast, null, 2)}
</pre>
          </div>

          <div style={{ marginTop: 8 }}>
            <strong>Preview rules (editable)</strong>
            {internalRules.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                <div style={{ minWidth: 160 }}>
                  <small style={{ color: '#666' }}>{r.field}</small>
                </div>
                <div style={{ minWidth: 40 }}>{r.operator}</div>
                <input value={r.value ?? ''} onChange={(e) => updateRuleValue(i, e.target.value)} style={{ width: 160, padding: 6 }} />
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12 }}>
            <button onClick={applySegment}>Apply to segment</button>
          </div>
        </div>
      )}
    </div>
  );
}
