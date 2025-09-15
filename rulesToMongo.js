// rulesToMongo.js
// Accepts either an AST ({ op: 'COND'|'AND'|'OR', ... }) or a flat array of rules
// (e.g. [{ field, op, value }, ...]) and returns a Mongo query object.

/**
 * Normalizes various operator tokens to the frontend symbols we use:
 * - accepts "$gt", "$lt" etc.
 * - accepts ">" "<" ">=" "<=" "=" "!=" "contains"
 * - converts "==" -> "="
 */
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
    '$contains': 'contains'
  };

  if (clean.startsWith('$')) {
    return mapDollarToSymbol[clean] ?? clean;
  }

  if (clean === '==') return '=';

  return clean;
}

function buildCond(cond) {
  // cond may contain { field, operator, value } (operator could be '>' or '$gt')
  const f = cond.field;
  // prefer explicit operator property; fallback to op, opName, etc.
  let op = cond.operator ?? cond.op ?? cond.operatorName ?? cond.opName;
  op = normalizeOperator(op);
  const v = cond.value;

  if (!f) throw new Error('Condition missing field');
  if (!op) throw new Error('Unsupported operator: ' + String(cond.operator ?? cond.op));

  // special handling for last_active_days -> last_active_at cutoff
  if (f === 'last_active_days') {
    const days = Number(v);
    if (Number.isNaN(days)) throw new Error('Invalid last_active_days value: ' + v);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    switch (op) {
      case '>':
      case '>=':
        return { last_active_at: { $lt: cutoff } };
      case '<':
      case '<=':
        return { last_active_at: { $gt: cutoff } };
      case '=':
        return { last_active_at: { $lt: cutoff } };
      default:
        throw new Error('Unsupported operator for last_active_days: ' + op);
    }
  }

  if (op === 'contains') {
    if (typeof v !== 'string') throw new Error('contains requires string value');
    return { [f]: { $regex: v, $options: 'i' } };
  }

  const mapOp = {
    '>': '$gt', '<': '$lt', '>=': '$gte', '<=': '$lte', '=': '$eq', '!=': '$ne'
  }[op];

  if (!mapOp) throw new Error('Unsupported operator: ' + op);

  // coerce numeric fields to Number
  const value = (f === 'total_spend' || f === 'visits') ? Number(v) : v;
  return { [f]: { [mapOp]: value } };
}

function astToMongoQuery(ast) {
  if (!ast) return {};

  // If input is a plain array of rules, convert them carefully.
  if (Array.isArray(ast)) {
    const children = ast.map((r) => {
      // r may contain:
      //  - { field, operator: '<', value: 30 }
      //  - { field, op: '<', value: 30 }
      //  - { field, op: 'COND', operator: '<', value: 30 }  <-- common in your payloads
      //  - { field, mongoOp: '$lt', value: 30 }
      //
      // Prefer (in order):
      // 1) r.operator
      // 2) r.mongoOp
      // 3) r.op but only if it's NOT 'COND' (treat 'COND' as AST marker)
      // 4) r.opName / operatorName
      let operator;
      if (r.operator !== undefined && r.operator !== null) {
        operator = r.operator;
      } else if (r.mongoOp !== undefined && r.mongoOp !== null) {
        operator = r.mongoOp;
      } else if (r.op !== undefined && r.op !== null && String(r.op).toUpperCase() !== 'COND') {
        operator = r.op;
      } else if (r.opName !== undefined) {
        operator = r.opName;
      } else if (r.operatorName !== undefined) {
        operator = r.operatorName;
      } else {
        operator = undefined;
      }

      return {
        op: 'COND',
        field: r.field,
        operator: operator,
        value: r.value ?? r.val ?? r.v
      };
    });

    ast = children.length === 1 ? children[0] : { op: 'AND', children };
  }

  function rec(node) {
    if (!node) return {};
    if (node.op === 'COND') return buildCond(node);
    if (node.op === 'AND' || node.op === 'OR') {
      const parts = (node.children || []).map(rec).filter(Boolean);
      if (parts.length === 0) return {};
      return node.op === 'AND' ? { $and: parts } : { $or: parts };
    }
    throw new Error('Unknown op: ' + node.op);
  }

  return rec(ast);
}

module.exports = { astToMongoQuery };
