// rulesToMongo.js
// Accepts either an AST ({ op: 'COND'|'AND'|'OR', ... }) or a flat array of rules
// (e.g. [{ field, op, value }, ...]) and returns a Mongo query object.

function normalizeOperator(op) {
  // Accept both symbol tokens and mongo-style tokens ($gt, $lt, $eq, $contains)
  if (!op && op !== 0) return undefined;
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
    return mapDollarToSymbol[clean] ?? clean; // if unknown $token, return as-is
  }

  // allow '==' -> '=' normalization
  if (clean === '==') return '=';

  return clean;
}

function buildCond(cond) {
  // cond may contain { field, operator, value } (operator could be '>' or '$gt')
  const f = cond.field;
  let op = cond.operator ?? cond.op ?? cond.operatorName ?? cond.opName;
  op = normalizeOperator(op);
  const v = cond.value;

  if (!f) throw new Error('Condition missing field');
  if (!op) throw new Error('Unsupported operator: ' + String(op));

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

  const value = (f === 'total_spend' || f === 'visits') ? Number(v) : v;
  return { [f]: { [mapOp]: value } };
}

function astToMongoQuery(ast) {
  if (!ast) return {};

  // If the input is a plain array, we need to decide whether it's:
  //  A) an array of plain rule objects like { field, op, value }
  //  B) an array of AST-node objects like { op: 'COND', field, operator, value }
  if (Array.isArray(ast)) {
    // quick check: if first item looks like an AST node, treat whole array as AST children
    const first = ast[0];
    const looksLikeAstNode = first && typeof first === 'object' && typeof first.op === 'string' &&
      (first.op === 'COND' || first.op === 'AND' || first.op === 'OR');

    if (looksLikeAstNode) {
      // If array already contains AST nodes, wrap them in AND if multiple
      ast = ast.length === 1 ? ast[0] : { op: 'AND', children: ast };
    } else {
      // convert plain rules array into AST children
      const children = ast.map((r) => {
        // r may be { field, op, value } or { field, operator, value } or include mongoOp ($gt)
        // be defensive: if r.op === 'COND' but it also has `operator`, use operator.
        let operator;
        if (r && r.op === 'COND') {
          // weird shape: prefer explicit operator or mongoOp if present
          operator = r.operator ?? r.mongoOp ?? r.operatorName ?? r.opName;
        } else {
          operator = r.operator ?? r.op ?? r.mongoOp ?? r.operatorName ?? r.opName;
        }
        return { op: 'COND', field: r.field, operator: operator, value: r.value ?? r.val ?? r.v };
      });
      // Wrap as AND node if multiple, or return single COND node
      ast = children.length === 1 ? children[0] : { op: 'AND', children };
    }
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
