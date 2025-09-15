// client/src/components/NLToRules.jsx
import React, { useState } from 'react';
import api from '../lib/api'; // adjust if your axios wrapper path differs

function humanDate(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleString(); // user-local readable
  } catch (e) {
    return null;
  }
}

export default function NLToRules({
  availableFields = [
    'total_spend',
    'visits',
    'last_active_at',
    'created_at',
    'avg_order_value',
    'city',
  ],
  onApply,
}) {
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
      setError(e?.response?.data?.error || e?.message || 'Conversion failed');
      setAst(null);
      setInternalRules([]);
    } finally {
      setLoading(false);
    }
  }

  function updateRuleValue(idx, newValRaw) {
    // coerce numeric fields to numbers, keep strings for others
    setInternalRules((prev) => {
      const copy = prev.map((r) => ({ ...r }));
      if (!copy[idx]) return copy;
      const field = copy[idx].field;
      let newVal = newValRaw;
      if (field === 'visits' || field === 'total_spend' || field === 'avg_order_value') {
        // try to parse numeric input, allow empty to clear
        if (String(newValRaw).trim() === '') newVal = '';
        else {
          const n = Number(String(newValRaw).replace(/,/g, ''));
          newVal = Number.isNaN(n) ? newValRaw : n;
        }
      }
      copy[idx] = { ...copy[idx], value: newVal };
      return copy;
    });
  }

  // Apply: by default this will POST to /api/segments to save the segment.
  // If an onApply handler is provided, we call that instead (useful to auto-fill parent form)
  async function applySegment() {
    if (!segmentName) {
      setError('Please provide a segment name.');
      return;
    }
    if (!internalRules || internalRules.length === 0) {
      setError('No parsed rules to apply.');
      return;
    }

    const payload = { name: segmentName, rules: internalRules };
    try {
      if (onApply) {
        // pass AST and internalRules so parent can decide what to do
        onApply({ ast, internalRules });
        return;
      }
      await api.post('/api/segments', payload);
      // feedback (you can replace with nicer UI)
      alert('Segment created/updated');
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to save segment');
    }
  }

  return (
    <div style={{ border: '1px solid #e6e6e6', padding: 12, borderRadius: 6, marginTop: 12 }}>
      <h4 style={{ margin: 0, marginBottom: 8 }}>AI: Natural Language → Segment Rules</h4>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          'e.g. "People who haven’t shopped in 6 months and spent over ₹5K", or "People who visit over 30 times", "haven\'t visited in 5 months"'
        }
        rows={3}
        style={{ width: '100%', marginBottom: 8, padding: 8 }}
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button onClick={handleConvert} disabled={loading || !text}>
          {loading ? 'Converting...' : 'Convert'}
        </button>
        <button onClick={() => setText("People who haven’t shopped in 6 months and spent over ₹5K")}>Example</button>
        <button
          onClick={() => {
            setText('');
            setAst(null);
            setInternalRules([]);
            setError(null);
            setSegmentName('');
          }}
        >
          Clear
        </button>
      </div>

      {error && (
        <div style={{ color: 'red', marginBottom: 8 }}>
          {error}
        </div>
      )}

      {ast && (
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 8 }}>
            <label style={{ marginRight: 8 }}>Segment Name:</label>
            <input value={segmentName} onChange={(e) => setSegmentName(e.target.value)} style={{ width: 320, padding: 6 }} />
          </div>

          <div style={{ marginBottom: 8 }}>
            <strong>Parsed AST</strong>
            <pre
              style={{
                background: '#1e1e1e',
                color: '#f8f8f2',
                padding: 12,
                borderRadius: 6,
                maxHeight: 200,
                overflow: 'auto',
                fontSize: 13,
                lineHeight: 1.4,
              }}
            >
              {JSON.stringify(ast, null, 2)}
            </pre>
          </div>

          <div style={{ marginTop: 8 }}>
            <strong>Preview rules (editable)</strong>
            {internalRules.map((r, i) => {
              const human = typeof r.value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(r.value) ? humanDate(r.value) : null;
              return (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                  <div style={{ minWidth: 160 }}>
                    <small style={{ color: '#666' }}>{r.field}</small>
                  </div>
                  <div style={{ minWidth: 40 }}>{r.operator ?? r.op ?? ''}</div>
                  <input
                    value={r.value ?? ''}
                    onChange={(e) => updateRuleValue(i, e.target.value)}
                    style={{ width: 160, padding: 6 }}
                  />
                  {human ? <div style={{ color: '#666', marginLeft: 8, fontSize: 12 }}>({human})</div> : null}
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 12 }}>
            <button onClick={applySegment} disabled={!internalRules || internalRules.length === 0}>
              Apply to segment
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
