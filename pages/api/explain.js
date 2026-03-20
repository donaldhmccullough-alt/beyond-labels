/**
 * pages/api/explain.js — Beyond Labels AI explanation endpoint
 *
 * POST /api/explain
 * Body (JSON): { verdict, flags, productName, ingredients }
 *
 * Calls the Claude API with the Sina-Joel voice system prompt and returns
 * a plain-language explanation of the scan result.
 *
 * Response shape (200):
 * {
 *   summary: string,          — 1-2 sentence verdict summary for the hero card
 *   details: {                — 2-3 sentence explanation per flagged category
 *     [category]: string
 *   }
 * }
 *
 * Graceful failures: if the API key is missing or Claude is unreachable,
 * the endpoint returns a 502 so the frontend can degrade silently.
 */

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `You are Sina and Joel — a PhD nutritionist and a regenerative farmer who together built the Beyond Labels methodology. You explain food ingredients the way a trusted friend with deep expertise would — direct, clear, empowering, never alarmist. You help families understand what's in their food and why it matters, one ingredient at a time.

Your voice:
- Plain language, no jargon. Write like you're explaining to a smart friend, not writing an academic paper.
- Direct and honest. If something is genuinely concerning, say so clearly — but always with context, not fear.
- Empowering, not alarmist. The goal is an informed choice, not panic. Give people something they can act on.
- Warm but concise. Every sentence earns its place. No filler.
- Never preachy. You share what you know; you don't lecture.
- When a product passes, be genuinely encouraging — clean food is worth celebrating.`;

/**
 * Build the user message from the scan result data.
 *
 * @param {string}   verdict     — 'red' | 'yellow' | 'green' | 'unverified'
 * @param {object[]} flags       — array of flag objects from rulesEngine
 * @param {string}   productName — product name from Open Food Facts
 * @param {string|null} ingredients — raw ingredients text
 */
function buildUserMessage(verdict, flags, productName, ingredients) {
  // Group flags by category so Claude sees one entry per category
  const byCategory = {};
  (flags || []).forEach(flag => {
    if (!byCategory[flag.category]) byCategory[flag.category] = [];
    byCategory[flag.category].push(flag);
  });

  const categoryLines = Object.entries(byCategory).map(([cat, catFlags]) => {
    const matched  = catFlags.map(f => f.matchedIngredient).join(', ');
    const severity = catFlags.some(f => f.severity === 'reject') ? 'reject' : 'caution';
    return `  - ${cat} (${severity}): found "${matched}"`;
  }).join('\n');

  const ingredientSnippet = ingredients
    ? `\nIngredients list: ${ingredients.substring(0, 600)}`
    : '';

  const flagsSection = categoryLines
    ? `Flagged categories:\n${categoryLines}`
    : 'No concerning ingredients found — product passed all checks.';

  return `Product: ${productName || 'Unknown Product'}
Overall verdict: ${verdict}
${flagsSection}${ingredientSnippet}

Respond with a JSON object with exactly this structure — no markdown, no text outside the JSON:
{
  "summary": "<1-2 sentence plain-language summary of the overall verdict, written to the parent or person scanning the product>",
  "details": {
    "<category_name>": "<2-3 sentences: what was found in this product, why it matters for a family, and one empowering note>"
  }
}

Include a "details" key only for categories that were actually flagged. If no flags exist, return an empty "details" object and write a warm, affirming summary. Match the category names exactly as given above (e.g. "seed_oils", "conventional_crops", "bioengineering", "additives", "gluten", "natural_flavors").`;
}

/**
 * Next.js API route handler.
 *
 * @param {import('next').NextApiRequest}  req
 * @param {import('next').NextApiResponse} res
 */
export default async function handler(req, res) {
  // ── Method guard ──────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Send a POST request.' });
  }

  // ── Input validation ──────────────────────────────────────────────────────
  const { verdict, flags, productName, ingredients } = req.body ?? {};

  if (!verdict) {
    return res.status(400).json({ error: '`verdict` is required.' });
  }

  // ── API key check ─────────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on this server.' });
  }

  // ── Call Claude ───────────────────────────────────────────────────────────
  try {
    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system:     SYSTEM_PROMPT,
      messages: [{
        role:    'user',
        content: buildUserMessage(verdict, flags, productName, ingredients),
      }],
    });

    const rawText = message.content.find(b => b.type === 'text')?.text ?? '{}';

    // Parse Claude's JSON response
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // Claude occasionally wraps JSON in a markdown code fence — strip it
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        // Total fallback: return the raw text as the summary
        parsed = { summary: rawText, details: {} };
      }
    }

    return res.status(200).json({
      summary: parsed.summary ?? '',
      details: parsed.details ?? {},
    });

  } catch (err) {
    // Surface auth errors distinctly to help with Vercel debugging
    if (err.status === 401) {
      return res.status(500).json({ error: 'Anthropic API key is invalid or expired.' });
    }
    return res.status(502).json({
      error:  'Failed to generate explanation.',
      detail: err.message,
    });
  }
}
