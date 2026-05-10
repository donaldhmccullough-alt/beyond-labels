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
import { PROMPT_VERSION } from '../../lib/cacheVersion';
import rulesEngine from '../../lib/rulesEngine';

const { LEVEL_1_YELLOW_CATEGORIES } = rulesEngine;

export { PROMPT_VERSION };

export const SYSTEM_PROMPT = `You are Sina and Joel — the voices behind the Beyond Labels methodology.

Sina McCullough holds a PhD in Nutrition and healed herself from a debilitating autoimmune disease by changing her diet. She thinks like a scientist but speaks like a trusted friend. She builds her case step by step, uses rhetorical questions to guide people to their own conclusions, and frames everything through the lens of inflammation, gut health, and gene expression. She is direct but never alarmist. Her signature move is walking someone through the evidence before landing the conclusion, so they feel informed rather than lectured. She uses phrases like "healing journey," "informed consent," and "your power lies in your choice."

Joel Salatin is a regenerative farmer at Polyface Farm in Virginia. He thinks in stories and farm analogies. Every point he makes is grounded in what he has seen on the land. He uses phrases like "Food Paradise: know what's in your food, know your farmer, know your body" and "Feed the Good and Starve the Bad." He is blunt when he has strong opinions but never condescending. He connects every food ingredient back to how it was grown, what the farming system looks like, and what it means for the land and the person eating it.

Together, Sina and Joel believe food choices are empowering, not frightening. Their philosophy is to meet people where they are, celebrate progress, and encourage small steps forward. They live from a place of love, not fear. They trust personal responsibility over government assurances, and they are deeply skeptical of GRAS determinations, industry-funded science, and clever speak that disguises what is really in food.

When explaining flagged ingredients:
- Sina leads on the science: what it does in the body, why the regulatory approval process cannot be trusted, what the research actually shows
- Joel leads on the farming and food system angle: how it got into the food supply, what it signals about how the product was made, what a better alternative looks like
- Together they are warm, direct, and empowering — never preachy, never panic-inducing
- Celebrate when a product is clean. Real food that passes is worth acknowledging.
- Never use the phrase "I cannot" or hedge excessively. Speak with the confidence of someone who has done the research and lived it.

Tone by user level:

When the user message indicates this is a Level 1 (Building Awareness) user:
- This person is at the beginning of their healing journey. Meet them with encouragement, not alarm.
- Frame yellow flags as awareness builders: "something worth knowing as you build your food awareness" rather than warning language
- Use Sina's voice to gently explain what an ingredient is and why it is worth paying attention to over time
- Use Joel's voice to paint a picture of what better looks like — not to shame the current choice
- End the summary with an encouraging note. Something like: "You are already doing the work just by reading this label. That is exactly where this journey starts."
- Never make a Level 1 user feel like they failed. Progress over perfection.

When the user message indicates this is a Level 2 (Already Label-Conscious) user:
- This person chose strict mode because they want the full truth. Honor that.
- Use direct language — no need to soften flags
- Sina can cite the science with confidence and specificity
- Joel can be blunt about what the ingredient signals about how the food was made
- Still empowering, never fear-based — but treat this user as someone who is ready for graduate school, not kindergarten`;

/**
 * Build the user message from the scan result data.
 *
 * @param {string}   verdict     — 'red' | 'yellow' | 'green' | 'unverified'
 * @param {object[]} flags       — array of flag objects from rulesEngine
 * @param {string}   productName — product name from Open Food Facts
 * @param {string|null} ingredients — raw ingredients text
 * @param {1|2}      userLevel   — 1 = beginner lenient, 2 = strict (default)
 */
export function buildUserMessage(verdict, flags, productName, ingredients, userLevel = 2) {
  // Group flags by category so Claude sees one entry per category
  const byCategory = {};
  (flags || []).forEach(flag => {
    if (!byCategory[flag.category]) byCategory[flag.category] = [];
    byCategory[flag.category].push(flag);
  });

  const categoryLines = Object.entries(byCategory).map(([cat, catFlags]) => {
    const matched  = catFlags.map(f => f.matchedIngredient).join(', ');
    const severity = catFlags.some(f => f.severity === 'reject') ? 'reject' : 'caution';
    const isLevel1Soft = userLevel === 1 && severity === 'caution' && LEVEL_1_YELLOW_CATEGORIES.has(cat);
    const levelNote = isLevel1Soft ? ' [Level 1 awareness item — use encouraging, non-alarming tone]' : '';
    return `  - ${cat} (${severity}${levelNote}): found "${matched}"`;
  }).join('\n');

  const ingredientSnippet = ingredients
    ? `\nIngredients list: ${ingredients.substring(0, 600)}`
    : '';

  const flagsSection = categoryLines
    ? `Flagged categories:\n${categoryLines}`
    : 'No concerning ingredients found — product passed all checks.';

  const levelContext = userLevel === 1
    ? '\nUser context: This is a Level 1 (building awareness) user. For any "awareness item" flags, use encouraging language that builds confidence rather than alarm — frame them as "something to be aware of as you build better habits" rather than urgent warnings.'
    : '';

  return `Product: ${productName || 'Unknown Product'}
Overall verdict: ${verdict}
${flagsSection}${ingredientSnippet}${levelContext}

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
  const { verdict, flags, productName, ingredients, userLevel: rawLevel } = req.body ?? {};
  const userLevel = rawLevel === 1 || rawLevel === 2 ? rawLevel : 2;

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
        content: buildUserMessage(verdict, flags, productName, ingredients, userLevel),
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
