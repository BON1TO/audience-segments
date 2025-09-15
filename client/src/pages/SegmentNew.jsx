// src/pages/SegmentNew.jsx
import React, { useEffect, useState } from "react";
import api from "../lib/api"; // use centralized axios instance
import { useNavigate } from "react-router-dom";
import NLToRules from "../components/NLToRules"; // <-- added import

/**
 * SegmentNew - robust "New Segment" UI.
 * - Tries GET templateUrl for a template (safe if backend returns 400/404)
 * - Falls back to a blank form if template load fails
 * - Posts to /api/segments to save
 *
 * Notes:
 * - Keeps your inline styling intact.
 * - Ensures rules always have a defined `op` before sending.
 */

export default function SegmentNew({ templateUrl = "/api/segments/new" }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [rules, setRules] = useState([{ id: `${Date.now()}-0`, field: "", op: ">", value: "" }]);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    async function loadTemplate() {
      if (!templateUrl) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError("");
        const res = await api.get(templateUrl);
        if (!mounted) return;
        const t = res.data || {};
        setName(t.name || "");
        if (t.rules?.length) {
          // Ensure every template rule has defaults so op is never undefined
          setRules(
            t.rules.map((r, idx) => ({
              id: r.id ?? `${Date.now()}-${idx}`,
              field: r.field ?? "",
              op: r.op ?? ">",
              value: r.value ?? "",
            }))
          );
        } else {
          setRules([{ id: `${Date.now()}-0`, field: "", op: ">", value: "" }]);
        }
      } catch (err) {
        console.error("Segment template fetch error:", {
          message: err.message,
          responseData: err?.response?.data,
          status: err?.response?.status,
          headers: err?.response?.headers,
        });
        // Non-blocking: continue with blank form
        setError(err?.response?.data?.message ?? `Failed to load template (status ${err?.response?.status ?? "network"})`);
        setName("");
        setRules([{ id: `${Date.now()}-0`, field: "", op: ">", value: "" }]);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadTemplate();
    return () => (mounted = false);
  }, [templateUrl]);

  function addRule() {
    setRules((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, field: "", op: ">", value: "" }]);
  }

  function updateRule(idx, key, value) {
    setRules((prev) => {
      const copy = prev.map((r) => ({ ...r }));
      // defensive: if index not found, no-op
      if (!copy[idx]) return copy;
      copy[idx][key] = value;
      return copy;
    });
  }

  function removeRule(idx) {
    setRules((prev) => prev.filter((_, i) => i !== idx));
  }

  // ---------------------------
  // NEW: handler for AI output
  // Accepts object from NLToRules onApply: { ast, internalRules }
  // internalRules are expected like: { op: "COND", field: "...", operator: "<", value: "..." }
  // We map that into the local `rules` state shape: { id, field, op, value }
  // ---------------------------
  function handleAIApply({ ast: aiAst, internalRules: aiInternalRules }) {
    try {
      if (aiAst?.name_suggestion) {
        setName(String(aiAst.name_suggestion));
      }
      if (!Array.isArray(aiInternalRules) || aiInternalRules.length === 0) return;

      const mapped = aiInternalRules.map((r, idx) => {
        // prefer r.operator (like '<', '>', 'between'), fallback to r.op if it contains operator token
        const opCandidate = r.operator ?? (typeof r.op === "string" && r.op !== "COND" ? r.op : null);
        const op = opCandidate ?? ">"; // fallback
        return {
          id: r.id ?? `ai-${Date.now()}-${idx}`,
          field: r.field ?? "",
          op,
          value: r.value ?? "",
        };
      });

      // Replace current rules with AI-produced rules (user can still edit)
      setRules(mapped);
    } catch (e) {
      console.error("Failed to apply AI rules:", e);
    }
  }

  // Helper to clean and validate rules before sending

  function getCleanRules() {
    // Allowed ops your frontend uses; map to backend tokens here if needed
    const allowedOps = new Set([">", "<", ">=", "<=", "=", "==", "!=", "contains"]);
    // If your backend expects different operator tokens (e.g. "$gt"), convert here:
    const opMap = {
      ">": ">",
      "<": "<",
      ">=": ">=",
      "<=": "<=",
      "=": "=",
      "==": "=",
      "!=": "!=",
      contains: "contains",
    };

    const cleaned = rules
      .map((r) => {
        const field = String(r?.field ?? "").trim();
        // fallback op to ">" if missing
        let opRaw = r?.op ?? ">";
        // normalize common variants
        if (opRaw === null) opRaw = ">";
        if (opRaw === "==") opRaw = "=";
        const op = String(opRaw).trim();
        let value = String(r?.value ?? "").trim();

        // --- Special normalization for email contains ---
        // If user is building a "contains" rule on the email field, normalize common inputs:
        // - "user@gmail.com"  -> ".com"
        // - "@gmail.com"      -> ".com"
        // - "gmail.com"       -> ".com"
        // - "example.com"     -> ".com"
        //
        // The rule: if field === 'email' and op === 'contains', and value contains '@' or a dot,
        // keep only the suffix starting from the first dot (so "gmail.com" -> ".com",
        // "example.co.in" -> ".co.in"). If no dot, leave value as-is.
        if (field.toLowerCase() === "email" && op.toLowerCase() === "contains") {
          // remove leading/trailing whitespace and any leading @ or username@
          // e.g. "user@gmail.com" -> "gmail.com", "@gmail.com" -> "gmail.com"
          const atIndex = value.indexOf("@");
          if (atIndex !== -1) {
            value = value.slice(atIndex + 1).trim();
          } else if (value.startsWith("@")) {
            value = value.slice(1).trim();
          }
          // if there is a dot in the remaining value, keep only from the first dot to the end
          const dotIndex = value.indexOf(".");
          if (dotIndex !== -1) {
            value = value.slice(dotIndex); // includes the leading dot, e.g. ".com" or ".co.in"
          } else {
            // no dot — leave as-is (user might intentionally search for a substring)
            value = value;
          }
        }

        return { field, op, value };
      })
      .filter((r) => r.field !== "" && r.value !== ""); // require both field and value

    // Validate ops and map them to final token
    for (const r of cleaned) {
      if (!allowedOps.has(r.op)) {
        console.error("Invalid op detected for rule:", r);
        throw new Error(`Invalid operator "${r.op}" in rule for field "${r.field}".`);
      }
      r.op = opMap[r.op] ?? r.op;
    }

    return cleaned;
  }

  async function handleSave(e) {
    e?.preventDefault?.();
    const trimmedName = String(name || "").trim();
    if (!trimmedName) {
      alert("Please provide a segment name.");
      return;
    }

    let cleanedRules;
    try {
      cleanedRules = getCleanRules();
    } catch (validationErr) {
      alert("Fix rules: " + validationErr.message);
      return;
    }

    if (cleanedRules.length === 0) {
      alert("Please add at least one rule with a field and value.");
      return;
    }

    try {
      setSaving(true);

      // Defensive mapping to cover multiple server expectations
      const opToMongo = {
        ">": "$gt",
        "<": "$lt",
        ">=": "$gte",
        "<=": "$lte",
        "=": "$eq",
        "==": "$eq",
        "!=": "$ne",
        contains: "$contains",
      };

      // Build a flat rules array (not AST). This is the important change:
      // -> send plain rule objects so backend's normalization can prefer r.operator or r.op
      const flatRules = cleanedRules.map((r) => {
        const normalizedOp = r.op === "==" ? "=" : r.op;
        return {
          field: r.field,
          value: r.value,
          op: normalizedOp, // e.g. ">"
          operator: normalizedOp, // alias backend might look for
          mongoOp: opToMongo[normalizedOp] ?? normalizedOp, // e.g. "$lt"
        };
      });

      // Build payload using flat rules (no AST wrapper)
      const payload = {
        name: trimmedName,
        rules: flatRules,
      };

      // DEBUG: log payload so you can inspect what is actually being sent
      console.log("Segment save payload:", JSON.stringify(payload, null, 2));

      // Post to your API (server expects name + rules)
      const res = await api.post("/api/segments", payload);
      const saved = res.data;
      alert("Segment saved");

      // Prefer navigating to detail if backend returned an id, otherwise go to list
      if (saved && (saved._id || saved.id)) {
        const id = saved._id ?? saved.id;
        navigate(`/segments/${id}`);
      } else {
        navigate("/segments");
      }
    } catch (err) {
      console.error("Save error:", err?.response?.data ?? err.message);
      const msg = err?.response?.data?.message ?? JSON.stringify(err?.response?.data) ?? err?.message ?? "Save failed";
      alert("Save failed: " + msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <h2>New Segment</h2>

      {loading ? <div>Loading template…</div> : null}
      {error ? (
        <div style={{ color: "salmon", marginBottom: 8 }}>
          Template load error: {error}. You can still create a segment below.
        </div>
      ) : null}

      {/* AI assistant block */}
      <NLToRules
        availableFields={["last_purchase_date", "total_spend", "visits", "avg_order_value", "city", "signup_date"]}
        onApply={handleAIApply}
      />

      <form onSubmit={handleSave}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", marginBottom: 6 }}>Segment name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ width: "100%", padding: 8 }}
            aria-label="Segment name"
            placeholder="e.g. High-value users"
          />
        </div>

        <div>
          <label style={{ display: "block", marginBottom: 6 }}>Rules</label>
          {rules.map((r, i) => (
            <div key={r.id} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <input
                placeholder="field"
                value={r.field}
                onChange={(e) => updateRule(i, "field", e.target.value)}
                aria-label={`Rule ${i + 1} field`}
              />
              <select
                value={r.op}
                onChange={(e) => updateRule(i, "op", e.target.value)}
                aria-label={`Rule ${i + 1} operator`}
              >
                <option value=">">&gt;</option>
                <option value="<">&lt;</option>
                <option value=">=">&gt;=</option>
                <option value="<=">&lt;=</option>
                <option value="=">=</option>
                <option value="!=">!=</option>
                <option value="contains">contains</option>
              </select>

              <input
                placeholder="value"
                value={r.value}
                onChange={(e) => updateRule(i, "value", e.target.value)}
                aria-label={`Rule ${i + 1} value`}
              />
              <button
                type="button"
                onClick={() => removeRule(i)}
                aria-label={`Remove rule ${i + 1}`}
                style={{ padding: "6px 8px" }}
              >
                Remove
              </button>
            </div>
          ))}
          <div style={{ marginTop: 6 }}>
            <button type="button" onClick={addRule} style={{ padding: "6px 10px" }}>
              Add rule
            </button>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <button type="submit" disabled={saving} style={{ padding: "8px 12px" }}>
            {saving ? "Saving…" : "Save segment"}
          </button>
          <button type="button" onClick={() => navigate("/segments")} style={{ marginLeft: 8 }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
