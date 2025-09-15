// rulesToMongo.js
// Accepts either an AST ({ op: 'COND'|'AND'|'OR', ... }) or a flat array of rules
// (e.g. [{ field, op, value }, ...]) and returns a Mongo query object.

function normalizeOperator(op) {
  if (op === undefined || op === null) return undefined;
  if (typeof op !== 'string') op = String(op);
  const clean = op.trim();

  const mapDollarToSymbol = {
    '$gt': '>',
    '$lt': '<',
    '$gte': '>=',
    '$lte': '<=',
    '$eq': '=',
    '$ne': '!=',
    '$contains': 'contains',
    '$in': 'IN'
  };

  if (clean.startsWith('$')) {
    return mapDollarToSymbol[clean] ?? clean;
  }

  // common aliases
  if (clean === '==') return '=';
  if (clean.toUpperCase() === 'COND') return 'COND';
  if (clean.toLowerCase() === 'contains') return 'COND';
  if (clean.toLowerCase() === 'in') return 'IN';

  return clean;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function maybeNumberForField(field, value) {
  // if value is numeric-like and the field usually stores numbers, coerce
  const numericFields = new Set(['total_spend', 'visits', 'last_active_days', 'last_purchase_amount', 'revenue']);
  if (numericFields.has(field)) {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return value;
}

function buildCond(cond) {
  const f = cond.field;
  let op = cond.operator ?? cond.op ?? cond.operatorName ?? cond.opName;
  op = normalizeOperator(op);
  const v = cond.value;

  if (!f) throw new Error('Condition missing field');
  if (!op) throw new Error('Unsupported operator: ' + String(op));

  // special semantic: last_active_days is interpreted relative to now
  if (f === 'last_active_days') {
    const days = Number(v);
    if (Number.isNaN(days)) throw new Error('Invalid last_active_days value: ' + v);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    switch (op) {
      case '>':
      case '>=':
        // last_active_days > N => last_active_at older than cutoff => $lt cutoff
        return { last_active_at: { $lt: cutoff } };
      case '<':
      case '<=':
        // last_active_days < N => last_active_at more recent than cutoff => $gt cutoff
        return { last_active_at: { $gt: cutoff } };
      case '=':
        return { last_active_at: { $lt: cutoff } };
      default:
        throw new Error('Unsupported operator for last_active_days: ' + op);
    }
  }

  // COND / contains -> regex (case-insensitive) or $in if value is array-like
  if (op === 'COND') {
    // If v is an array (or JSON array string), use $in
    try {
      if (Array.isArray(v)) {
        return { [f]: { $in: v } };
      }
      if (typeof v === 'string') {
        const t = v.trim();
        if (t.startsWith('[') && t.endsWith(']')) {
          const parsed = JSON.parse(t);
          if (Array.isArray(parsed)) return { [f]: { $in: parsed } };
        }
      }
    } catch (e) {
      // fall through to regex fallback
    }

    if (v === undefined || v === null) throw new Error('contains/COND requires a value');
    const pattern = escapeRegex(String(v));
    return { [f]: { $regex: pattern, $options: 'i' } };
  }

  // IN operator support (exact membership)
  if (op === 'IN') {
    // v must be array or JSON array string
    if (Array.isArray(v)) return { [f]: { $in: v } };
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) return { [f]: { $in: parsed } };
        } catch (e) {
          // fallthrough
        }
      }
    }
    throw new Error('IN operator requires an array value');
  }

  const mapOp = { '>': '$gt', '<': '$lt', '>=': '$gte', '<=': '$lte', '=': '$eq', '!=': '$ne' }[op];

  if (!mapOp) throw new Error('Unsupported operator: ' + op);

  const value = maybeNumberForField(f, v);
  return { [f]: { [mapOp]: value } };
}

function astToMongoQuery(ast) {
  if (!ast) return {};

  // If the input is a plain array, convert to AST-like structure
  if (Array.isArray(ast)) {
    const first = ast[0];
    const looksLikeAstNode = first && typeof first === 'object' && typeof first.op === 'string' &&
      (first.op === 'COND' || first.op === 'AND' || first.op === 'OR');

    if (looksLikeAstNode) {
      ast = ast.length === 1 ? ast[0] : { op: 'AND', children: ast };
    } else {
      const children = ast.map((r) => {
        // determine operator token from several possible properties
        let operator;
        if (r && (r.op === 'COND' || (r.operator && String(r.operator).toLowerCase() === 'contains'))) {
          operator = r.operator ?? r.mongoOp ?? r.op ?? r.operatorName ?? r.opName;
        } else {
          operator = r.operator ?? r.op ?? r.mongoOp ?? r.operatorName ?? r.opName;
        }
        return { op: 'COND', field: r.field, operator: operator, value: r.value ?? r.val ?? r.v };
      });
      ast = children.length === 1 ? children[0] : { op: 'AND', children };
    }
  }

  function rec(node) {
    if (!node) return {};
    if (node.op === 'COND') return buildCond(node);
    if (node.op === 'AND' || node.op === 'OR') {
      const parts = (node.children || []).map(rec).filter(p => p && Object.keys(p).length);
      if (parts.length === 0) return {};
      return node.op === 'AND' ? { $and: parts } : { $or: parts };
    }
    throw new Error('Unknown op: ' + node.op);
  }

  return rec(ast);
}

module.exports = { astToMongoQuery };
