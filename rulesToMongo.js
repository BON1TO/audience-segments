// rulesToMongo.js
// Robust converter from frontend rules/AST -> Mongo query object.

function normalizeOperator(op) {
  if (op === null || op === undefined) return undefined;
  if (typeof op !== "string") op = String(op);

  const clean = op.trim();

  // Map mongo tokens -> symbol tokens
  const mapDollarToSymbol = {
    "$gt": ">",
    "$lt": "<",
    "$gte": ">=",
    "$lte": "<=",
    "$eq": "=",
    "$ne": "!=",
    "$contains": "contains"
  };

  if (clean.startsWith("$")) {
    return mapDollarToSymbol[clean] ?? clean;
  }

  if (clean === "==") return "=";
  return clean;
}

function buildCond(cond) {
  // cond may contain { field, operator, value } (operator could be '>' or '$gt')
  const field = cond.field ?? cond.name ?? cond.key;
  // Prefer explicit 'operator' or 'mongoOp' values if present.
  let opRaw = cond.operator ?? cond.mongoOp ?? cond.op ?? cond.opName ?? cond.operatorName;

  // Sometimes frontend stored an AST node with op === 'COND' and put actual operator elsewhere.
  // If opRaw is 'COND' but a better candidate exists (cond.operator or cond.mongoOp), use that.
  if (opRaw === "COND") {
    if (cond.operator && cond.operator !== "COND") opRaw = cond.operator;
    else if (cond.mongoOp && cond.mongoOp !== "COND") opRaw = cond.mongoOp;
    else if (cond.op && cond.op !== "COND") opRaw = cond.op;
  }

  const op = normalizeOperator(opRaw);
  const rawValue = cond.value ?? cond.val ?? cond.v;

  if (!field) throw new Error("Condition missing field");
  if (!op) throw new Error("Unsupported operator: " + String(opRaw));

  // Special field: last_active_days -> convert to date comparison on last_active_at
  if (String(field) === "last_active_days") {
    const days = Number(rawValue);
    if (Number.isNaN(days)) throw new Error("Invalid last_active_days value: " + rawValue);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    switch (op) {
      case ">":
      case ">=":
        // users with last_active_days >= X => last_active_at <= cutoff (older than X days)
        return { last_active_at: { $lt: cutoff } };
      case "<":
      case "<=":
        return { last_active_at: { $gt: cutoff } };
      case "=":
        return { last_active_at: { $lt: cutoff } };
      default:
        throw new Error("Unsupported operator for last_active_days: " + op);
    }
  }

  if (op === "contains") {
    if (typeof rawValue !== "string") throw new Error("contains requires string value");
    return { [field]: { $regex: rawValue, $options: "i" } };
  }

  const mapOp = { ">": "$gt", "<": "$lt", ">=": "$gte", "<=": "$lte", "=": "$eq", "!=": "$ne" }[op];
  if (!mapOp) throw new Error("Unsupported operator: " + op);

  // Convert numeric fields where appropriate
  let value = rawValue;
  if (field === "visits" || field === "total_spend") {
    const n = Number(rawValue);
    if (Number.isNaN(n)) {
      // if empty or non-numeric, throw so client sees error
      throw new Error("Invalid numeric value for " + field + ": " + rawValue);
    }
    value = n;
  }

  return { [field]: { [mapOp]: value } };
}

function astToMongoQuery(ast) {
  if (!ast) return {};

  // If frontend passed a plain array of rules, convert to AST-like node(s).
  if (Array.isArray(ast)) {
    const children = ast.map((r) => {
      // Prefer operator/mongoOp first, but still pass op for compatibility.
      const operatorCandidate = r.operator ?? r.mongoOp ?? r.op ?? r.opName ?? r.operatorName;
      return {
        op: "COND",
        field: r.field ?? r.name ?? r.key,
        operator: operatorCandidate,
        value: r.value ?? r.val ?? r.v
      };
    });
    ast = children.length === 1 ? children[0] : { op: "AND", children };
  }

  function rec(node) {
    if (!node) return {};
    if (node.op === "COND") return buildCond(node);
    if (node.op === "AND" || node.op === "OR") {
      const parts = (node.children || []).map(rec).filter(p => p && Object.keys(p).length);
      if (parts.length === 0) return {};
      return node.op === "AND" ? { $and: parts } : { $or: parts };
    }
    // Some frontends may use lowercase op names; tolerate them
    if (String(node.op).toUpperCase() === "COND") return buildCond(node);
    if (String(node.op).toUpperCase() === "AND") {
      const parts = (node.children || []).map(rec).filter(p => p && Object.keys(p).length);
      return parts.length ? { $and: parts } : {};
    }
    if (String(node.op).toUpperCase() === "OR") {
      const parts = (node.children || []).map(rec).filter(p => p && Object.keys(p).length);
      return parts.length ? { $or: parts } : {};
    }

    throw new Error("Unknown op: " + node.op);
  }

  return rec(ast);
}

module.exports = { astToMongoQuery };
