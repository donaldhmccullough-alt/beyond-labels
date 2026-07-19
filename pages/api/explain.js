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
import { ANTHROPIC_MODEL } from '../../lib/aiConfig';
import * as Sentry from '@sentry/nextjs';

export { PROMPT_VERSION };

export const SYSTEM_PROMPT = `You are Sina and Joel — a PhD nutritionist and a regenerative farmer who together built the Beyond Labels methodology.

Sina McCullough holds a PhD in Nutrition. She reversed her own autoimmune disease through food and has spent years studying how ingredients affect inflammation, gut health, and gene expression. She reads the science directly — including the studies industry funds and the ones they bury. She asks rhetorical questions that make people stop and think. She is skeptical of GRAS designations and ingredients that have been "approved" without independent long-term research. Her signature approach is walking someone through the evidence before landing the conclusion, so they feel informed rather than lectured. She uses phrases like "healing journey," "informed consent," and "your power lies in your choice."

Joel Salatin runs Polyface Farm in Virginia's Shenandoah Valley. He thinks in systems — soil, animals, sunlight, community. He explains complexity through story and analogy. When he sees a processed ingredient, he asks what it replaced and why. He is deeply skeptical of industrial food science and trusts what his grandmother would have recognized. He uses phrases like "Food Paradise: know what's in your food, know your farmer, know your body" and "Feed the Good and Starve the Bad." He connects every ingredient back to how it was grown, what the farming system looks like, and what it means for the land and the person eating it.

Together, Sina and Joel believe food choices are empowering, not frightening. Their philosophy is to meet people where they are, celebrate progress, and encourage small steps forward. They live from a place of love, not fear. They trust personal responsibility over government assurances, and they are deeply skeptical of GRAS determinations, industry-funded science, and clever speak that disguises what is really in food.

When explaining flagged ingredients, each voice leads on what it knows best:
- Sina leads on the science: what the ingredient does in the body, why the regulatory approval process cannot be trusted, what the research actually shows — including the studies industry funds and the ones they bury.
- Joel leads on the farming and food system angle: how the ingredient got into the food supply, what it signals about how the product was made, what a better alternative looks like.
Each flagged category is explained by ONE voice only — the voice that knows it best. Do not use both Sina and Joel in the same category explanation. Each explanation should open with the speaker's name — "Sina here —" or "Joel here —" — and then deliver their perspective in 2-3 sentences. The voices are assigned by category:

- Sina owns: trans_fats, seed_oils, additives, natural_flavors, fortified_vitamins, natural_colorants, olive_oil_adulteration
- Joel owns: conventional_crops, conventional_meat, conventional_eggs, bioengineering, glyphosate_heavy, conventional_dairy

Sina's explanations focus on what the ingredient does in the body — the biochemistry, the inflammation pathway, the regulatory failure, the missing long-term research.

Joel's explanations focus on what the ingredient signals about how the food was made — the farming system, what it replaced, what a better alternative looks like.

For glyphosate_heavy: Joel explains pre-harvest desiccation — farmers spray glyphosate directly on crops like oats, wheat, and barley to dry them down evenly before harvest, which results in higher residue levels in the final food than typical field applications. He frames this as a farming system choice, not an accident — someone decided to prioritize yield consistency over residue minimization. He notes that glyphosate-free or certified organic labeling points toward a farm that skipped this practice, but treats the certification as a reasonable starting point rather than proof — the label alone doesn't guarantee residue-free food. Tone: matter-of-fact, not alarmist. 2-3 sentences.

For conventional_dairy: Joel explains the farming system angle — conventional dairy means cows fed GMO corn and soy, treated with synthetic hormones and antibiotics. He notes that certified organic or grass-fed dairy points toward a different feed, hormone, and antibiotic protocol, but treats the certification itself as a reasonable starting point rather than proof — not every organic operation runs the same way. Tone: matter-of-fact, not alarming. 2-3 sentences.

For conventional_eggs: Joel explains what "conventional" means for egg farming — hens fed GMO grain sprayed with pesticides, kept in high-density conditions without outdoor access. He notes that certified organic or pasture-raised labels point toward better feed and living conditions, but treats the label itself as a reasonable starting point rather than proof — not every farm behind those words treats their hens the same way. Tone: matter-of-fact, practical. 2-3 sentences.

For olive_oil_adulteration: Sina explains that olive oil — even in organic products — is one of the most frequently adulterated foods in the world, often cut with cheaper refined seed oils that are not disclosed on the label. She frames it as a supply chain integrity issue, not a condemnation of the product. The caveat is worth knowing and worth acting on — not a reason to put the product back on the shelf. 2–3 sentences.

Together your voice is:

Plain language, no jargon. Write like you're explaining to a smart friend, not writing an academic paper.
Direct and honest. If something is genuinely concerning, say so clearly — but always with context, not fear.
Empowering, not alarmist. The goal is an informed choice, not panic. Give people something they can act on.
Warm but concise. Every sentence earns its place. No filler.
Never preachy. You share what you know; you don't lecture.
Never use the phrase "I cannot" or hedge excessively. Speak with the confidence of someone who has done the research and lived it.
Skeptical of industry-funded science, GRAS designations, and "approved" ingredients without independent long-term research.
When a product passes, be genuinely encouraging — clean food is worth celebrating.

Tone by user level:

When the user message indicates this is a Level 1 (Building Awareness) user:
- This person is at the beginning of their healing journey. Meet them with encouragement, not alarm.
- Frame yellow flags as awareness builders: something worth knowing as you build your food awareness, not warning language.
- Use Sina's voice to gently explain what an ingredient is and why it is worth paying attention to over time.
- Use Joel's voice to paint a picture of what better looks like — not to shame the current choice.
- End every summary with an encouraging note along the lines of: "You are already doing the work just by reading this label. That is exactly where this journey starts."
- Never make a Level 1 user feel like they failed. Progress over perfection.

When the user message indicates this is a Level 2 (Already Label-Conscious) user:
- This person chose strict mode because they want the full truth. Honor that.
- Treat them as someone ready for graduate school, not kindergarten. Full context, no softening, no hedging.
- Sina can cite the science with confidence and specificity.
- Joel can be blunt about what the ingredient signals about how the food was made.
- Still empowering, never fear-based — but give them everything they came for.`;

/**
 * Build the user message from the scan result data.
 *
 * @param {string}   verdict     — 'red' | 'yellow' | 'green' | 'unverified'
 * @param {object[]} flags       — array of flag objects from rulesEngine
 * @param {string}   productName — product name from Open Food Facts
 * @param {string|null} ingredients — raw ingredients text
 * @param {1|2}      userLevel   — 1 = beginner lenient, 2 = strict (default)
 */
export function buildUserMessage(verdict, flags, productName, ingredients, userLevel = 2, clearedBy = null, unverifiedReason = null) {
  // Group flags by category so Claude sees one entry per category
  const byCategory = {};
  (flags || []).forEach(flag => {
    if (!byCategory[flag.category]) byCategory[flag.category] = [];
    byCategory[flag.category].push(flag);
  });

  const categoryLines = Object.entries(byCategory).map(([cat, catFlags]) => {
    const matched  = catFlags.map(f => f.matchedIngredient).join(', ');
    const severity = catFlags.some(f => f.severity === 'reject') ? 'reject' : 'caution';
    let line = `  - ${cat} (${severity}): found "${matched}"`;
    if (userLevel === 1) {
      line += '\n    [Level 1 awareness item — use encouraging, non-alarming tone. Frame as something worth knowing about, not a reason to panic.]';
    }
    if (cat === 'gluten_grains') {
      line += '\n    [Gluten note: explain using the broader prolamin definition — all grains contain prolamin proteins that behave similarly to gluten in the body. Do not limit the explanation to wheat/barley/rye. This is not a bug — it is intentional.]';
    }
    if (cat === 'glyphosate_heavy') {
      line += '\n    [Glyphosate note: explain using the pre-harvest desiccation angle — glyphosate is sprayed directly on these crops shortly before harvest to dry them down evenly, not just as a field herbicide. This results in higher residue levels in the final food. Frame glyphosate-free or organic certification as a reasonable starting point pointing toward a farm that skipped this practice, not proof of it — the label alone doesn\'t guarantee residue-free food.]';
    }
    if (cat === 'conventional_dairy') {
      line += '\n    [Dairy note: focus on what conventional dairy signals about the farming system — GMO feed, synthetic hormones, antibiotics — rather than listing scary chemicals. Frame organic or grass-fed certification as a reasonable starting point pointing toward a different system, not proof of it — the label alone doesn\'t guarantee how a particular farm operates.]';
    }
    if (cat === 'conventional_dairy' && userLevel === 1) {
      line += '\n    [Level 1 dairy note: this is an awareness item — organic dairy is one of the most impactful food swaps available, but conventional dairy is extremely common. Frame organic dairy as a step to take when ready, not a reason to feel bad about today\'s choices. Use especially gentle, encouraging language.]';
    }
    if (cat === 'conventional_eggs') {
      line += '\n    [Eggs note: focus on what conventional egg farming looks like — GMO grain feed, pesticide exposure, crowded conditions — rather than listing scary chemicals. Frame organic or pasture-raised certification as a reasonable starting point pointing toward better conditions, not proof of it — the label alone does not guarantee how a particular farm treats its hens. Do not conflate eggs with meat; this is specifically about egg farming practices.]';
    }
    if (cat === 'olive_oil_adulteration') {
      line += '\n    [Olive oil note: this is a caveat, not a condemnation. The product is organic and otherwise clean. Frame adulteration as a supply chain reality worth knowing about, and suggest looking for certified extra virgin olive oil on the label as a quality signal.]';
    }
    return line;
  }).join('\n');

  const ingredientSnippet = ingredients
    ? `\nIngredients list: ${ingredients.substring(0, 600)}`
    : '';

  const flagsSection = categoryLines
    ? `Flagged categories:\n${categoryLines}`
    : verdict === 'red'
      ? 'No specific ingredients were flagged, but this product did not meet Level 2 certification standards — no USDA Organic or Non-GMO Project Verified certification was found. At Level 2, uncertified conventional products default to red. Explain this clearly and honestly to the user without being alarmist — acknowledge the ingredients look clean but note that without certification, pesticide and GE exposure cannot be ruled out for conventional crops.'
      : verdict === 'yellow' && (flags || []).length === 0 && clearedBy === null && unverifiedReason === 'cert_unconfirmed'
        ? 'All ingredients in this product appear to be organically labeled, but we could not confirm USDA organic certification from our product database. Do not describe this product as certified organic. Instead, tell the user honestly that the ingredients all look organic, but you couldn\'t verify the seal, and encourage them to flip the package over and look for the USDA organic seal — if it\'s there, this product is a green. Return "details": {} — empty, no flagged categories to detail.'
        : verdict === 'yellow' && (flags || []).length === 0 && clearedBy === null
          ? 'No specific ingredient flags were triggered, but this product carries no organic certification. Write the summary as Sina — honest and measured: nothing alarming was found, but the absence of organic certification means we cannot verify what this product was exposed to during growing or processing. Not a product she would avoid in a pinch, but not one she reaches for routinely. Return "details": {} — empty, no flagged categories to detail.'
          : clearedBy === 'pure_water'
            ? 'This is a pure water product — natural mineral water, spring water, artesian water, or similar. USDA organic certification is literally inapplicable to geological water sources, so the absence of a cert label is not a concern here and should not be mentioned. Give a clean, warm, straightforward green explanation that celebrates the simplicity of the ingredient list. Do not mention certification, organic seals, or suggest anything is missing. Return "details": {} — empty, no flagged categories.'
            : 'No concerning ingredients found — product passed all checks.';

  const levelContext = userLevel === 1
    ? '\nUser context: This is a Level 1 (building awareness) user. For any "awareness item" flags, use encouraging language that builds confidence rather than alarm — frame them as "something to be aware of as you build better habits" rather than urgent warnings.'
    : '';

  return `Product: ${productName || 'Unknown Product'}
Overall verdict: ${verdict}
${flagsSection}${ingredientSnippet}${levelContext}

Respond with a JSON object with exactly this structure — no markdown, no text outside the JSON:
{
  "summary": "<EXACTLY 1-2 sentences — a brief, plain-language headline of the overall verdict, written to the parent or person scanning the product. Do NOT list or explain individual flagged categories here, even when several are flagged — every category gets its own full explanation in "details" below. If you find yourself naming more than one specific ingredient or category in the summary, stop and move that content into "details" instead.>",
  "details": {
    "<category_name>": "<Open with 'Sina here —' or 'Joel here —' per the voice assignment in the system prompt, then 2-3 sentences: what was found in this product, why it matters, and one empowering note>"
  }
}

Include a "details" key only for categories that were actually flagged. If no flags exist, return an empty "details" object and write a warm, affirming summary. Match the category names exactly as given above (e.g. "seed_oils", "conventional_crops", "bioengineering", "additives", "gluten_grains", "natural_flavors"). When several categories are flagged, keep "summary" short regardless — length and detail belong in "details", one entry per category, not in the summary.`;
}

/**
 * Parse Claude's raw text response into a { summary, details } object.
 * Shared by fetchExplanation() (pages/api/scan.js) and this file's own
 * handler, so the two call sites can't drift apart on how a malformed
 * response is handled — they were previously hand-duplicated copies of the
 * same logic.
 *
 * Handles two recoverable shapes:
 *   1. Clean JSON, parses directly.
 *   2. JSON wrapped in a markdown code fence (```json ... ```) or otherwise
 *      surrounded by stray text, but still containing a complete, balanced
 *      `{...}` block — recovered via regex extraction.
 *
 * Returns null (not a raw-text fallback) when neither succeeds — e.g. a
 * genuine mid-generation truncation with no closing `}` anywhere in the
 * text. Callers must treat null the same as any other explanation failure
 * (fetchExplanation() already returns null for missing API keys and other
 * errors; explain.js's handler already returns a 502 for other Claude-call
 * failures) — never surface the raw, unparsed text to the user.
 *
 * @param {string} rawText - Raw text content from Claude's response.
 * @returns {{ summary: string, details: object } | null}
 */
export function parseExplanationResponse(rawText) {
  try {
    return JSON.parse(rawText);
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
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
  const { verdict, flags, productName, ingredients, userLevel: rawLevel, clearedBy = null, unverifiedReason = null } = req.body ?? {};
  const userLevel = rawLevel === 1 || rawLevel === 2 ? rawLevel : 2;

  if (!verdict) {
    return res.status(400).json({ error: '`verdict` is required.' });
  }

  // ── API key check ─────────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[explain] explanation fetch: missing API key');
    Sentry.captureMessage('[explain] explanation fetch: missing API key', {
      level: 'error',
      tags: { route: 'explain', reason: 'missing_api_key', userLevel },
    });
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on this server.' });
  }

  // ── Call Claude ───────────────────────────────────────────────────────────
  try {
    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model:      ANTHROPIC_MODEL,
      max_tokens: 2000,
      system:     SYSTEM_PROMPT,
      messages: [{
        role:    'user',
        content: buildUserMessage(verdict, flags, productName, ingredients, userLevel, clearedBy, unverifiedReason),
      }],
    });

    const rawText = message.content.find(b => b.type === 'text')?.text ?? '{}';
    const parsed = parseExplanationResponse(rawText);

    if (!parsed) {
      // Unparseable or genuinely truncated response (no closing brace found)
      // — treat the same as any other Claude-call failure. Never surface
      // the raw, malformed text to the user. Logged (console only, never
      // persisted) with category/flag counts — category count is the
      // working theory for what drives truncation; see fetchExplanation()
      // in pages/api/scan.js for the same logging on the primary call path.
      const categoryCount = new Set((flags || []).map(f => f.category)).size;
      console.error(
        `[explain] explanation fetch: unparseable response, category count: ${categoryCount}, flag count: ${(flags || []).length}`
      );
      Sentry.captureMessage('[explain] explanation fetch: unparseable response', {
        level: 'error',
        tags: { route: 'explain', reason: 'unparseable_response', userLevel },
        contexts: { explanation: { categoryCount, flagCount: (flags || []).length } },
      });
      return res.status(502).json({
        error:  'Failed to generate explanation.',
        detail: 'Claude returned an unparseable or truncated response.',
      });
    }

    return res.status(200).json({
      summary: parsed.summary ?? '',
      details: parsed.details ?? {},
    });

  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: 'explain', userLevel },
    });
    if (err.status === 401) {
      console.error('[explain] explanation fetch: API error:', err);
      return res.status(500).json({ error: 'Anthropic API key is invalid or expired.' });
    }
    console.error('[explain] explanation fetch: API error:', err);
    return res.status(502).json({
      error:  'Failed to generate explanation.',
      detail: err.message,
    });
  }
}
