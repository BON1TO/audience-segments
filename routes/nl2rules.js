// routes/nl2rules.js
const express = require('express');
const router = express.Router();
const fetch = require('node-fetch'); // npm i node-fetch@2
const Ajv = require('ajv');
const ajv = new Ajv();

let astToMongoQuery = null;
try { astToMongoQuery = require('../rulesToMongo').astToMongoQuery || require('../rulesToMongo'); } catch(e) { astToMongoQuery = null; }

// ----------------- AST schema -----------------
const AST_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string" },
    name_suggestion: { type: "string" },
    logic: { type: "string", enum: ["AND", "OR", "NOT"] },
    rules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field: { type: "string" },
          op: { type: "string" },
          value: {},
          value_relative: { type: "string" },
          currency: { type: "string" }
        },
        required: ["field", "op"]
      }
    }
  },
  required: ["intent", "rules"]
};
const validateAst = ajv.compile(AST_SCHEMA);

// ----------------- helpers -----------------
function parseRelativeTime(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/(\d+)\s*(year|years|month|months|week|weeks|day|days)/i);
  if (!m) return null;
  const unitRaw = m[2].toLowerCase();
  const unit =
    unitRaw.startsWith('year') ? 'year' :
    unitRaw.startsWith('month') ? 'month' :
    unitRaw.startsWith('week') ? 'week' : 'day';
  return { n: parseInt(m[1], 10), unit };
}

function subtractRelativeFromDate(now, parsed) {
  if (!parsed) return null;
  const d = new Date(now);
  const { n, unit } = parsed;
  if (unit === 'year') d.setFullYear(d.getFullYear() - n);
  else if (unit === 'month') d.setMonth(d.getMonth() - n);
  else if (unit === 'week') d.setDate(d.getDate() - n * 7);
  else d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function normalizeNumberLike(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return v;
  const s = v.replace(/[₹,$\s]/g, '').toLowerCase();
  const k = s.match(/^([\d,.]+)k$/);
  if (k) return Math.round(parseFloat(k[1].replace(/,/g, '')) * 1000);
  const parsed = parseFloat(s.replace(/,/g, ''));
  return Number.isNaN(parsed) ? v : parsed;
}

function mapOpToOperator(opRaw) {
  const o = String(opRaw).toLowerCase();
  if (o === '>' || o === 'gt' || o.includes('over') || o.includes('more')) return '>';
  if (o === '<' || o === 'lt' || o.includes('under') || o.includes('less')) return '<';
  if (o === '=' || o === 'eq' || o === 'equals') return '=';
  if (o.includes('between')) return 'between';
  if (o === 'exists') return 'exists';
  if (o === 'not_exists' || o === 'not exists') return 'not_exists';
  return opRaw;
}

function astRuleToInternal(r, now = new Date()) {
  if (r.value_relative && (r.op === 'before' || r.op === '<' || /not.*recent/i.test(r.op))) {
    const parsed = parseRelativeTime(r.value_relative);
    const cutoff = subtractRelativeFromDate(now, parsed);
    return { op: "COND", field: r.field, operator: "<", value: cutoff };
  }

  const operator = mapOpToOperator(r.op);

  if (['>', '<', '=', 'between'].includes(operator)) {
    if (operator === 'between' && Array.isArray(r.value) && r.value.length === 2) {
      return {
        op: "COND",
        field: r.field,
        operator: 'between',
        value: [normalizeNumberLike(r.value[0]), normalizeNumberLike(r.value[1])]
      };
    }
    return {
      op: "COND",
      field: r.field,
      operator,
      value: normalizeNumberLike(r.value)
    };
  }

  return { op: "COND", field: r.field, operator: '=', value: r.value };
}

// ----------------- Cohere prompt builder -----------------
function buildSystemPrompt(availableFields = []) {
  return `You are a converter that outputs ONLY valid JSON (no commentary). Convert the user's natural-language marketing segment into JSON with this schema:

{
  "intent": "create_segment",
  "name_suggestion": "<short name>",
  "logic": "AND|OR|NOT",
  "rules": [
    {"field":"<one of: ${availableFields.join(', ')}>", "op":"<, >, =, between, exists, not_exists, contains, before", "value": "<value or [min,max]>", "value_relative": "<optional like '6 months'>", "currency":"INR"}
  ]
}

Notes:
- Use 'total_spend' for money spent.
- Use 'visits' for number of visits.
- Use 'last_active_at' for last activity/last visit recency.
- Use 'created_at' for signup date.
- Normalize numeric amounts (remove currency signs like ₹, commas, and convert '5K' to 5000).
- Output only valid JSON.`;
}



// ----------------- fallback small extractor (upgraded with visits + inactivity) -----------------
function fallbackExtract(text, availableFields = []) {
  const rules = [];
  const lower = text.toLowerCase();

  // 1) Inactivity / last-visit patterns
  // Matches phrases like:
  // - "haven't visited in 5 months"
  // - "not visited in 2 weeks"
  // - "last visit more than 5 months ago"
  // - "haven't shopped in 6 months" (kept)
  const inactivityPatterns = [
    /haven'?t (?:shopp?ed|visited|been active|logged in) in (\d+\s*(?:year|years|month|months|week|weeks|day|days))/i,
    /not (?:shopp?ed|visited|been active|logged in) in (\d+\s*(?:year|years|month|months|week|weeks|day|days))/i,
    /last (?:visit|seen|active) (?:more than|over)?\s*(\d+\s*(?:year|years|month|months|week|weeks|day|days))\s*(?:ago)?/i
  ];
  for (const pat of inactivityPatterns) {
    const m = lower.match(pat);
    if (m) {
      
      const field = availableFields.includes('last_active_at')
  ? 'last_active_at'
  : (availableFields.includes('last_purchase_date') ? 'last_purchase_date' : (availableFields[0] || 'last_active_at'));

      rules.push({ field, op: 'before', value_relative: m[1] });
      break;
    }
  }

  // 2) Visits numeric patterns
  // Matches:
  // - "visited over 30 times"
  // - "visits over 30 times"
  // - "people who visit > 30"
  // - "users with visits >= 10"
  // - "visited between 10 and 20 times"
  const visitsBetween = lower.match(/visits?\s*(?:between)\s*(\d{1,6})\s*(?:and|-|to)\s*(\d{1,6})/i)
    || lower.match(/visited\s*(?:between)\s*(\d{1,6})\s*(?:and|-|to)\s*(\d{1,6})/i);
  if (visitsBetween) {
    const field = availableFields.includes('visits') ? 'visits' : (availableFields[0] || 'visits');
    rules.push({ field, op: 'between', value: [parseInt(visitsBetween[1], 10), parseInt(visitsBetween[2], 10)] });
  } else {
    // greater / less / exact patterns
    const visitsGt = lower.match(/visits?\s*(?:of|over|more than|>)\s*(\d{1,6})/i)
      || lower.match(/visited\s*(?:over|more than|>)\s*(\d{1,6})/i)
      || lower.match(/visits?\s*(?:>=|≥)\s*(\d{1,6})/i);
    if (visitsGt) {
      const field = availableFields.includes('visits') ? 'visits' : (availableFields[0] || 'visits');
      rules.push({ field, op: '>', value: parseInt(visitsGt[1], 10) });
    } else {
      const visitsLt = lower.match(/visits?\s*(?:less than|under|<|<=|≤)\s*(\d{1,6})/i)
        || lower.match(/visited\s*(?:less than|under|<|<=|≤)\s*(\d{1,6})/i);
      if (visitsLt) {
        const field = availableFields.includes('visits') ? 'visits' : (availableFields[0] || 'visits');
        rules.push({ field, op: '<', value: parseInt(visitsLt[1], 10) });
      }
    }
  }

  // 3) Money spent patterns (existing)
  const spent = lower.match(/spent (?:over |more than |>)?\s*₹?([\d,\.]+k?)/i)
    || lower.match(/spent (?:over |more than |>)?\s*([0-9,\.]+k?)\s*(inr|rs|₹)?/i);
  if (spent) {
    const amount = spent[1];
    const field = availableFields.includes('total_spend') ? 'total_spend' : (availableFields[0] || 'total_spend');
    rules.push({ field, op: '>', value: amount, currency: 'INR' });
  }

  // 4) city / location fallback (existing)
  if (rules.length === 0) {
    const cityMatch = text.match(/in ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/);
    if (cityMatch) rules.push({ field: 'city', op: '=', value: cityMatch[1] });
  }

  // Build final AST (keep same structure)
  return {
    intent: 'create_segment',
    name_suggestion: rules.length ? 'Converted segment' : 'Unclear segment',
    logic: 'AND',
    rules
  };
}



// ----------------- route -----------------
router.post('/', async (req, res) => {
  const { text, availableFields = ['total_spend','visits','last_active_at','created_at','avg_order_value','city'] } = req.body || {};

  if (!text) return res.status(400).json({ error: 'text required' });

  const COHERE_KEY = process.env.COHERE_API_KEY;
  const system = buildSystemPrompt(availableFields);
  const user = `Text: "${text}"\nFields: ${availableFields.join(', ')}`;

  try {
    let ast = null;

    if (COHERE_KEY) {
      const resp = await fetch('https://api.cohere.ai/generate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${COHERE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: "command-xlarge",
          prompt: `${system}\n\n${user}\n\nReturn JSON:`,
          max_tokens: 300,
          temperature: 0.0
        })
      });

      const data = await resp.json();
      const content = data?.generations?.[0]?.text;
      if (content) {
        try {
          ast = JSON.parse(content);
        } catch (parseErr) {
          const jsonMatch = content.match(/\{[\s\S]*\}$/);
          if (jsonMatch) {
            ast = JSON.parse(jsonMatch[0]);
          } else {
            ast = null;
          }
        }
      }
    }

    if (!ast) ast = fallbackExtract(text, availableFields);

    if (!validateAst(ast)) {
      const fallback = fallbackExtract(text, availableFields);
      if (validateAst(fallback)) ast = fallback;
      else return res.status(422).json({ error: 'AST validation failed', details: validateAst.errors, rawAst: ast });
    }

    const now = new Date();
    const internalRules = ast.rules.map(r => astRuleToInternal(r, now));

    let mongoQuery = null;
    try { if (astToMongoQuery) mongoQuery = astToMongoQuery(internalRules); } catch (e) { mongoQuery = null; }

    return res.json({ ast, internalRules, mongoQuery });
  } catch (err) {
    console.error('nl2rules error', err);
    const fallback = fallbackExtract(text, availableFields);
    const internalRules = fallback.rules.map(r => astRuleToInternal(r, new Date()));
    return res.json({ ast: fallback, internalRules, note: 'fallback used due to error' });
  }
});

module.exports = router;
