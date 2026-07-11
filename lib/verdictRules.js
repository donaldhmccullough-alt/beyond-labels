/**
 * lib/verdictRules.js — Unified L1/L2 verdict rule table (design artifact)
 *
 * STAGE 3 of the L1/L2 unification project. This file is a STANDALONE DATA
 * STRUCTURE — it is not imported by pages/api/scan.js, lib/rulesEngine.js,
 * or any live code path. Nothing in production reads this file. It exists
 * so the eventual unification refactor has a single, reviewed, tested
 * source of truth to build against, instead of re-deriving intent from two
 * separately-evolved code paths at cutover time.
 *
 * ── Relationship to Stage 1 (golden-master snapshot) and Stage 2 (report) ──
 * Stage 1 froze scan.js's CURRENT behavior, bugs included, as ground truth
 * for regression-testing the eventual refactor. Stage 2 read scan.js and
 * rulesEngine.js line-by-line and reported every place L1 and L2 disagree,
 * asking which disagreements are bugs vs. intentional design.
 *
 * This file is deliberately NOT a transcription of Stage 1's snapshot.
 * Three rows below encode CORRECTED target behavior that differs from what
 * scan.js does today:
 *
 *   - bioengineering: gains organic/non-gmo/prefix clearance (today's
 *     rulesEngine.js has none — see DESIGN_DECISIONS.correctedBioengineering
 *     ClearanceForOrganicPath, discrepancy #1).
 *   - conventional_meat: game-meat detection becomes a no-op at L2, matching
 *     L1's already-correct behavior, instead of L2's current unconditional
 *     green override (see DESIGN_DECISIONS.correctedGameMeatNoOpAtL2,
 *     discrepancy #2).
 *   - conventional_eggs / conventional_meat: conventional_eggs is given
 *     strict priority over the generic conventional_meat injection at both
 *     levels, whenever both would otherwise apply (see
 *     DESIGN_DECISIONS.correctedEggsPriorityOverGenericMeatInjection,
 *     discrepancy #4).
 *
 * Two more decisions are encoded as documentation only, with no behavior
 * change:
 *
 *   - conventional_eggs is intentionally NOT cleared by non-gmo-project-
 *     verified, unlike conventional_crops (discrepancy #3 — see
 *     DESIGN_DECISIONS.intentionalEggsNonGmoExclusion for the reasoning).
 *   - the old L2 tree's post-waterfall "strip conventional_crops when
 *     clearedBy==='organic'" line is NOT carried into this table at all —
 *     Stage 2 traced it and believes it is dead/unreachable given current
 *     clearance logic (discrepancy #6 — see
 *     DESIGN_DECISIONS.deadCodePostTreeConventionalCropsStrip). Whoever
 *     retires the old scan.js L2 tree should double-check this before
 *     deleting the line, per that decision's own instruction.
 *
 * Do NOT read this file as "what scan.js currently does." Read it as
 * "what the unified system should do once cutover happens." The Node 4
 * bioengineering leak, the Node 6 game-meat leak, and the egg/meat
 * ordering issue all still exist, unpatched, in pages/api/scan.js today —
 * this table fixes them by construction, not by a separate patch, per
 * explicit Stage 3 instruction.
 */

// ────────────────────────────────────────────────────────────────────────
// Enums
// ────────────────────────────────────────────────────────────────────────

/**
 * How a category's severity is determined. Four shapes exist in the real
 * code (per Stage 2's line-by-line read of lib/rulesEngine.js) — no
 * category uses a fifth shape.
 */
const SEVERITY_RULE = {
  /** Always 'reject', at both levels, ignoring LEVEL_1_YELLOW_CATEGORIES
   *  entirely. Engine hardcodes `severity: 'reject'` directly rather than
   *  calling severityFor(). Applies to: trans_fats, additives. */
  HARDCODED_REJECT: 'hardcoded_reject',

  /** severityFor(category, userLevel): caution at L1 (category is a member
   *  of LEVEL_1_YELLOW_CATEGORIES), reject at L2. The "normal" shape —
   *  applies to: seed_oils, conventional_crops, bioengineering,
   *  natural_flavors, conventional_eggs. */
  LEVEL_AWARE: 'level_aware',

  /** A one-off inline severity expression that fits neither of the above.
   *  Applies only to glyphosate_heavy:
   *  `(userLevel === 1 || hasGlyphosateFree) ? 'caution' : 'reject'`. */
  INLINE_CUSTOM: 'inline_custom',

  /** Always 'caution', at both levels, never reject. Engine hardcodes
   *  `severity: 'caution'` directly. Applies to: gluten_grains, and the
   *  three organic-path-only injected categories (fortified_vitamins,
   *  natural_colorants, olive_oil_adulteration). */
  HARDCODED_CAUTION: 'hardcoded_caution',

  /** Not an engine category at all — scan.js injects the flag directly at
   *  one or more call sites, and each call site hardcodes its own
   *  severity inline (not via severityFor() or any shared function).
   *  Applies to: conventional_meat, conventional_dairy. */
  INJECTED: 'injected',
};

/** Whether a category's clearance/no-op path needs the "any pre-existing
 *  reject-severity flag blocks this downgrade" gate — the pattern fixed
 *  for L2 Node 5 (PROMPT_VERSION 29) and Node 7 (PROMPT_VERSION 39). */
const GATE_REQUIREMENT = {
  /** This category has a clearance/no-op path that actively sets a
   *  lower verdict (green/yellow) and therefore MUST check for a
   *  pre-existing reject-severity flag before doing so, or it risks
   *  silently discarding it — exactly the Node 4/6/7 bug shape. */
  REQUIRED: 'required',

  /** This category's own rows never discard a pre-existing reject flag —
   *  either because they only ever set red (nothing to discard), or
   *  because they only ever upgrade green→yellow / no-op (structurally
   *  safe by construction, per Stage 2's finding about L1's overrides). */
  NOT_REQUIRED: 'not_required',

  /** This category has no clearance/downgrade concept at all — it's
   *  either always-invisible (gluten_grains) or scoped entirely inside
   *  an already-branched context with nothing left to gate (the three
   *  organic-path-only categories). */
  NOT_APPLICABLE: 'not_applicable',
};

/** Where in the decision flow a category is even evaluated. */
const SCOPE = {
  /** Evaluated unconditionally, independent of any other category. */
  GLOBAL: 'global',

  /** Only ever evaluated once the product is already confirmed on the
   *  organic path (today's L2 Node 4; in the unified design, wherever
   *  organic clearance is resolved) — mutually exclusive with the other
   *  two categories that share this scope; first match wins. */
  ORGANIC_PATH_ONLY: 'organic_path_only',
};

// ────────────────────────────────────────────────────────────────────────
// The unified rule table
// ────────────────────────────────────────────────────────────────────────

/**
 * One entry per category. Order matches the Stage 2 report's table order
 * (roughly: engine categories in their rulesEngine.js loop order, then the
 * five scan.js-injected pseudo-categories). Order here carries no
 * evaluation-priority meaning by itself — INSTANT_RED_PRIORITY_TIER and
 * each row's own scope/priorityRelativeTo fields encode priority
 * explicitly, since a plain array order was judged too easy to
 * misinterpret as "this is the eval order" once this becomes real code.
 *
 * @typedef {Object} VerdictRule
 * @property {string} category
 * @property {boolean} isEngineCategory - true if lib/rulesEngine.js emits
 *   this flag directly; false if only pages/api/scan.js ever injects it.
 * @property {string} severityRule - one of SEVERITY_RULE
 * @property {string} severityDetail - human-readable explanation
 * @property {{severity: string, verdictImpact: string, notes: string}} level1
 * @property {{severity: string, verdictImpact: string, notes: string, divergesFromLiveScanJs: boolean, divergenceReason?: string}} level2
 * @property {Array<{mechanism: string, effect: string, notes?: string}>} clearance
 * @property {{required: string, notes: string}} rejectFlagGate - `required` is a GATE_REQUIREMENT value
 * @property {string} scope - one of SCOPE
 * @property {Array<{category: string, relation: string, appliesAtLevels: number[]}>} [priorityRelativeTo]
 * @property {string} notes
 */

/** @type {VerdictRule[]} */
const VERDICT_RULES = [
  {
    category: 'trans_fats',
    isEngineCategory: true,
    severityRule: SEVERITY_RULE.HARDCODED_REJECT,
    severityDetail: "Engine hardcodes severity: 'reject' directly in the TRANS_FATS loop — never calls severityFor(), never level-aware.",
    level1: { severity: 'reject', verdictImpact: 'red', notes: 'No L1 softening at all.' },
    level2: {
      severity: 'reject', verdictImpact: 'red',
      notes: 'Also a member of the instant-red priority tier (see INSTANT_RED_PRIORITY_TIER) — redundant safety net on top of its own hardcoded severity.',
      divergesFromLiveScanJs: false,
    },
    clearance: [],
    rejectFlagGate: { required: GATE_REQUIREMENT.NOT_REQUIRED, notes: 'Source category — it is itself a reject signal, never a target of downgrade.' },
    scope: SCOPE.GLOBAL,
    notes: '',
  },
  {
    category: 'seed_oils',
    isEngineCategory: true,
    severityRule: SEVERITY_RULE.LEVEL_AWARE,
    severityDetail: "severityFor('seed_oils', userLevel) — member of LEVEL_1_YELLOW_CATEGORIES.",
    level1: { severity: 'caution', verdictImpact: 'yellow', notes: '' },
    level2: {
      severity: 'reject', verdictImpact: 'red',
      notes: 'Also a member of the instant-red priority tier.',
      divergesFromLiveScanJs: false,
    },
    clearance: [
      { mechanism: 'none', effect: 'no-clearance', notes: 'Only an isInFreeOrNonContext() "-free" false-positive guard (e.g. "canola-free") — that prevents a wrong match, it is not a certification clearance.' },
    ],
    rejectFlagGate: { required: GATE_REQUIREMENT.NOT_REQUIRED, notes: 'Source category, instant-red tier.' },
    scope: SCOPE.GLOBAL,
    notes: '',
  },
  {
    category: 'conventional_crops',
    isEngineCategory: true,
    severityRule: SEVERITY_RULE.LEVEL_AWARE,
    severityDetail: "severityFor('conventional_crops', userLevel).",
    level1: { severity: 'caution', verdictImpact: 'yellow', notes: '' },
    level2: {
      severity: 'reject', verdictImpact: 'red',
      notes: 'Reject-severity flag present → red. Never itself discards another category\'s flag.',
      divergesFromLiveScanJs: false,
    },
    clearance: [
      { mechanism: 'usda-organic-label', effect: 'full-clearance', notes: 'No flag emitted at all (engine-level continue).' },
      { mechanism: 'non-gmo-project-verified-label', effect: 'full-clearance' },
      { mechanism: 'organic-ingredient-prefix', effect: 'full-clearance' },
    ],
    rejectFlagGate: { required: GATE_REQUIREMENT.NOT_REQUIRED, notes: 'Only ever sets red; never discards an existing reject flag.' },
    scope: SCOPE.GLOBAL,
    notes: 'Reference pattern for bioengineering\'s corrected clearance below (discrepancy #1).',
  },
  {
    category: 'bioengineering',
    isEngineCategory: true,
    severityRule: SEVERITY_RULE.LEVEL_AWARE,
    severityDetail: "severityFor('bioengineering', userLevel).",
    level1: { severity: 'caution', verdictImpact: 'yellow', notes: '' },
    level2: {
      severity: 'reject', verdictImpact: 'red',
      notes: 'Reject-severity flag present (and not cleared — see clearance below) → red.',
      divergesFromLiveScanJs: true,
      divergenceReason:
        "CORRECTED per Stage 2 discrepancy #1. Today's lib/rulesEngine.js BIOENGINEERING_TERMS loop has NO organic/non-gmo/prefix clearance at all — " +
        'it is the one reject-capable category with no engine-level clearance path, which is the direct root cause of the live Node 4 bug (a usda-organic-labeled ' +
        'product with a bioengineering disclosure gets a full GREEN, silently discarding the reject flag) documented in the Stage 2 report. This row instead gives ' +
        'bioengineering the SAME clearance shape as conventional_crops.',
    },
    clearance: [
      { mechanism: 'usda-organic-label', effect: 'full-clearance', notes: 'Explicitly required by the Stage 3 instructions for discrepancy #1.' },
      { mechanism: 'non-gmo-project-verified-label', effect: 'full-clearance', notes:
        'INTERPRETIVE CHOICE — flagged for review. The Stage 3 instructions named conventional_crops/eggs/glyphosate_heavy as the reference pattern, but those three ' +
        'do not all share one clearance shape (conventional_crops: organic OR non-gmo OR prefix; conventional_eggs and glyphosate_heavy: organic OR prefix only, no ' +
        'non-gmo). This row mirrors conventional_crops\'s fuller pattern specifically, because (a) it was the first-listed reference, (b) a literal Non-GMO Project ' +
        'Verified label is close to a direct semantic negation of a "bioengineered" disclosure, and (c) this is exactly the scenario from the Stage 1 golden-master ' +
        'finding that motivated the Node 7 fix (PROMPT_VERSION 39) — a product carrying both. If the intent was instead to mirror conventional_eggs/glyphosate_heavy\'s ' +
        'narrower organic-only clearance, remove this row.' },
      { mechanism: 'organic-ingredient-prefix', effect: 'full-clearance' },
    ],
    rejectFlagGate: {
      required: GATE_REQUIREMENT.NOT_REQUIRED,
      notes: 'Once bioengineering is cleared at the engine layer (this row\'s corrected clearance), there is no stray reject flag left for the organic path or the ' +
        'game-meat path to silently discard — the gate that Node 4/Node 6 would otherwise need becomes unnecessary by construction, per the Stage 3 design intent.',
    },
    scope: SCOPE.GLOBAL,
    notes: 'See level2.divergenceReason above for the full correction rationale (Stage 2 discrepancy #1).',
  },
  {
    category: 'natural_flavors',
    isEngineCategory: true,
    severityRule: SEVERITY_RULE.LEVEL_AWARE,
    severityDetail: "severityFor('natural_flavors', userLevel).",
    level1: { severity: 'caution', verdictImpact: 'yellow', notes: '' },
    level2: {
      severity: 'reject', verdictImpact: 'red',
      notes: 'Also a member of the instant-red priority tier.',
      divergesFromLiveScanJs: false,
    },
    clearance: [{ mechanism: 'none', effect: 'no-clearance' }],
    rejectFlagGate: { required: GATE_REQUIREMENT.NOT_REQUIRED, notes: 'Source category, instant-red tier.' },
    scope: SCOPE.GLOBAL,
    notes: '',
  },
  {
    category: 'additives',
    isEngineCategory: true,
    severityRule: SEVERITY_RULE.HARDCODED_REJECT,
    severityDetail: "Engine hardcodes severity: 'reject' in both the PRIORITY_ADDITIVES and SYNTHETIC_ADDITIVES loops. NOT a member of LEVEL_1_YELLOW_CATEGORIES.",
    level1: { severity: 'reject', verdictImpact: 'red', notes: 'No L1 softening at all — the only additive-family category with zero level-awareness anywhere.' },
    level2: {
      severity: 'reject', verdictImpact: 'red',
      notes: 'Also a member of the instant-red priority tier.',
      divergesFromLiveScanJs: false,
    },
    clearance: [{ mechanism: 'none', effect: 'no-clearance' }],
    rejectFlagGate: { required: GATE_REQUIREMENT.NOT_REQUIRED, notes: 'Source category, instant-red tier.' },
    scope: SCOPE.GLOBAL,
    notes: '',
  },
  {
    category: 'glyphosate_heavy',
    isEngineCategory: true,
    severityRule: SEVERITY_RULE.INLINE_CUSTOM,
    severityDetail: "(userLevel === 1 || hasGlyphosateFree) ? 'caution' : 'reject' — the only category whose severity depends on BOTH level and a label in one inline expression.",
    level1: { severity: 'caution', verdictImpact: 'yellow', notes: 'Always caution at L1, regardless of any certification — the userLevel===1 branch of the inline expression short-circuits before the label check.' },
    level2: {
      severity: 'reject-or-caution', verdictImpact: 'red-or-yellow',
      notes: "Reject/red unless the glyphosate-free label is present, in which case caution/yellow (flag stays, only severity changes).",
      divergesFromLiveScanJs: false,
    },
    clearance: [
      { mechanism: 'usda-organic-label', effect: 'full-clearance', notes: 'No flag emitted at all.' },
      { mechanism: 'organic-ingredient-prefix', effect: 'full-clearance' },
      { mechanism: 'glyphosate-free-label', effect: 'severity-downgrade', notes: 'Flag still emitted, severity becomes caution instead of reject — this is NOT the same as full clearance.' },
    ],
    rejectFlagGate: {
      required: GATE_REQUIREMENT.REQUIRED,
      notes: 'Already correctly implemented in live scan.js (Node 11b checks severity==="reject" specifically before setting red) — no change needed. Included here for completeness, not as a correction.',
    },
    scope: SCOPE.GLOBAL,
    notes: '',
  },
  {
    category: 'gluten_grains',
    isEngineCategory: true,
    severityRule: SEVERITY_RULE.HARDCODED_CAUTION,
    severityDetail: "Engine hardcodes severity: 'caution' always — never reject, at either level.",
    level1: { severity: 'caution', verdictImpact: 'no-op', notes: 'Caution-severity per the engine, but stripped from the response entirely before display — invisible (future paywall feature). See CROSS_CUTTING_RULES.glutenStripMechanism.' },
    level2: {
      severity: 'caution', verdictImpact: 'no-op',
      notes: 'Same as L1 — stripped entirely before the L2 rules evaluate, identically invisible at both levels. This is Stage 2 discrepancy #9: not a disagreement, both levels agree on "hide this."',
      divergesFromLiveScanJs: false,
    },
    clearance: [{ mechanism: 'none', effect: 'no-clearance', notes: 'Deliberately organic-immune — prolamin concern is independent of how the crop was grown. Organic wheat is still a prolamin concern.' }],
    rejectFlagGate: { required: GATE_REQUIREMENT.NOT_APPLICABLE, notes: 'Never reject-severity, so the gate concept does not apply.' },
    scope: SCOPE.GLOBAL,
    notes: 'Always caution, always stripped, at both levels — genuinely symmetric, unlike every other row in this table.',
  },
  {
    category: 'conventional_eggs',
    isEngineCategory: true,
    severityRule: SEVERITY_RULE.LEVEL_AWARE,
    severityDetail: "severityFor('conventional_eggs', userLevel).",
    level1: { severity: 'caution', verdictImpact: 'yellow', notes: 'Untouched by any L1-specific override — flows straight through from the engine.' },
    level2: {
      severity: 'reject', verdictImpact: 'red',
      notes: 'Reject-severity flag present → red.',
      divergesFromLiveScanJs: true,
      divergenceReason:
        "CORRECTED per Stage 2 discrepancy #4. Today's scan.js L2 tree checks isConventionalMeat (Node 8) BEFORE the conventional_eggs flag check (Node 8b) — an " +
        "OFF-tagged egg product ('en:eggs'/'en:egg-products'/'en:poultry-eggs' are members of MEAT_CATEGORIES) hits the generic conventional_meat injection first. " +
        'Verdict ends up correct either way (both are reject-severity), but the generic land-animal-flavored flag renders ahead of the specific, more accurate egg ' +
        'messaging — see priorityRelativeTo below and the conventional_meat row\'s matching entry.',
    },
    clearance: [
      { mechanism: 'usda-organic-label', effect: 'full-clearance' },
      { mechanism: 'organic-ingredient-prefix', effect: 'full-clearance' },
      { mechanism: 'non-gmo-project-verified-label', effect: 'INTENTIONALLY-NOT-CLEARED', notes:
        'Stage 2 discrepancy #3, resolved as intentional — see DESIGN_DECISIONS.intentionalEggsNonGmoExclusion for the full reasoning. Kept as-is; not a correction.' },
    ],
    rejectFlagGate: { required: GATE_REQUIREMENT.NOT_REQUIRED, notes: 'Only ever sets red; never discards an existing reject flag.' },
    scope: SCOPE.GLOBAL,
    priorityRelativeTo: [
      { category: 'conventional_meat', relation: 'takes-priority-over', appliesAtLevels: [1, 2] },
    ],
    notes:
      'INTENTIONAL: not cleared by non-gmo-project-verified (discrepancy #3). Reasoning: Non-GMO Project Verification is fundamentally a crop-genetics ' +
      'certification; applied to eggs it is really a claim about hen feed, a materially narrower/different claim than what the label means on a plant crop. ' +
      'CORRECTED: takes strict priority over the generic conventional_meat injection at both levels whenever both would otherwise apply (discrepancy #4).',
  },
  {
    category: 'conventional_meat',
    isEngineCategory: false,
    severityRule: SEVERITY_RULE.INJECTED,
    severityDetail: 'Not an engine category. scan.js injects this flag at multiple call sites, each hardcoding its own severity inline — not via severityFor() or any shared function.',
    level1: {
      severity: 'caution', verdictImpact: 'yellow-upgrade-only',
      notes: 'Injected only when isMeat is true and the product is not wild-caught seafood and not game meat. Verdict only ever upgraded green→yellow, never forced down from an existing red.',
    },
    level2: {
      severity: 'reject', verdictImpact: 'red',
      notes: 'Injected when isMeat is true and the product is not wild-caught seafood and not game meat (and organic clearance, below, does not apply).',
      divergesFromLiveScanJs: true,
      divergenceReason:
        "CORRECTED per Stage 2 discrepancy #2. Today's scan.js L2 tree Node 6 treats game-meat detection as an ACTIVE, unconditional override to verdict='green' " +
        "with no reject-flag gate — the exact bug shape fixed at Node 5 (PROMPT_VERSION 29) and Node 7 (PROMPT_VERSION 39), but never fixed here. This row instead " +
        "makes L2's game-meat handling a NO-OP, matching L1's behavior (L1's Override 2 game-meat branch has always been a no-op, and was therefore never vulnerable " +
        "to this bug shape at all — see DESIGN_DECISIONS.correctedGameMeatNoOpAtL2). Once game-meat detection is a no-op instead of an active override, the reject-" +
        'flag gate it would otherwise need becomes unnecessary by construction, same reasoning as the bioengineering row above.',
    },
    clearance: [
      { mechanism: 'usda-organic-label', effect: 'no-injection', notes: 'Structural in today\'s live code (Node 4 short-circuits before Nodes 5b/8/8c are ever reached) — kept as an explicit rule here rather than an accidental side effect of branch ordering.' },
      { mechanism: 'wild-caught-signal', effect: 'no-op', notes: 'detectWildCaught() true for a seafood product — no injection, existing flags/verdict left alone.' },
      { mechanism: 'game-meat-category', effect: 'no-op', notes: 'CORRECTED (discrepancy #2) — no injection, existing flags/verdict left alone, same as the wild-caught path and same as L1 today.' },
    ],
    rejectFlagGate: {
      required: GATE_REQUIREMENT.REQUIRED,
      notes:
        'Required for the wild-caught-signal no-op path specifically (already correctly implemented in live L2 Node 5 — the gate that was missing before ' +
        'PROMPT_VERSION 29). NOT required for the game-meat-category no-op path, because that path is now itself a no-op (see clearance above) rather than an ' +
        'active override — a no-op cannot discard anything, so it needs no gate, matching L1\'s reasoning for why its overrides never needed this gate.',
    },
    scope: SCOPE.GLOBAL,
    priorityRelativeTo: [
      { category: 'conventional_eggs', relation: 'yields-priority-to', appliesAtLevels: [1, 2] },
    ],
    notes: 'CORRECTED: game-meat detection is a no-op at L2 now (discrepancy #2), and this injection yields priority to conventional_eggs at both levels whenever both would otherwise apply (discrepancy #4).',
  },
  {
    category: 'conventional_dairy',
    isEngineCategory: false,
    severityRule: SEVERITY_RULE.INJECTED,
    severityDetail: 'Not an engine category. scan.js injects this flag, hardcoding severity inline per call site.',
    level1: { severity: 'caution', verdictImpact: 'yellow-upgrade-only', notes: 'Injected only when containsMilkDerived() is true and no usda-organic label is present (explicit inline check). Only ever upgrades green→yellow.' },
    level2: {
      severity: 'reject', verdictImpact: 'red',
      notes: 'Injected when containsMilkDerived() is true (no organic label is present — structural, via the non-organic branch, not an inline check at this row).',
      divergesFromLiveScanJs: false,
    },
    clearance: [
      { mechanism: 'usda-organic-label', effect: 'no-injection', notes: 'Explicit inline check at L1; structural (organic-branch short-circuit) at L2. containsMilkDerived() itself has zero organic-awareness — the clearance lives entirely in the caller.' },
    ],
    rejectFlagGate: { required: GATE_REQUIREMENT.NOT_REQUIRED, notes: 'L1 only ever upgrades green→yellow; L2 only ever sets red. Neither ever discards an existing reject flag — confirmed already correct in Stage 2, no correction needed.' },
    scope: SCOPE.GLOBAL,
    notes: '',
  },
  {
    category: 'fortified_vitamins',
    isEngineCategory: false,
    severityRule: SEVERITY_RULE.HARDCODED_CAUTION,
    severityDetail: "Not an engine category. scan.js injects with severity: 'caution' hardcoded inline — the organic-path branch has no reject-severity concept at all.",
    level1: { severity: 'none', verdictImpact: 'not-applicable', notes: 'Does not exist at L1 — L1 has no organic sub-tree to parallel Node 4 at all.' },
    level2: {
      severity: 'caution', verdictImpact: 'yellow',
      notes: 'Only evaluated once the product is already on the organic path; first of three mutually-exclusive sub-checks (fortified_vitamins > natural_colorants > olive_oil_adulteration).',
      divergesFromLiveScanJs: false,
    },
    clearance: [{ mechanism: 'none', effect: 'not-applicable', notes: 'This category only exists because the organic label is already present — there is no separate clearance concept to layer on top.' }],
    rejectFlagGate: { required: GATE_REQUIREMENT.NOT_APPLICABLE, notes: 'Never reject-severity; only ever additive to an already-resolved organic-path verdict.' },
    scope: SCOPE.ORGANIC_PATH_ONLY,
    notes: 'Stage 2 discrepancy #8: intentional by omission, not a disagreement — L1 simply has no organic sub-tree.',
  },
  {
    category: 'natural_colorants',
    isEngineCategory: false,
    severityRule: SEVERITY_RULE.HARDCODED_CAUTION,
    severityDetail: "Not an engine category. scan.js injects with severity: 'caution' hardcoded inline.",
    level1: { severity: 'none', verdictImpact: 'not-applicable', notes: 'Does not exist at L1.' },
    level2: {
      severity: 'caution', verdictImpact: 'yellow',
      notes: 'Organic-path only; second of three mutually-exclusive sub-checks — only evaluated if fortified_vitamins did not already match.',
      divergesFromLiveScanJs: false,
    },
    clearance: [{ mechanism: 'none', effect: 'not-applicable' }],
    rejectFlagGate: { required: GATE_REQUIREMENT.NOT_APPLICABLE, notes: 'Never reject-severity.' },
    scope: SCOPE.ORGANIC_PATH_ONLY,
    notes: 'Stage 2 discrepancy #8: intentional by omission, not a disagreement.',
  },
  {
    category: 'olive_oil_adulteration',
    isEngineCategory: false,
    severityRule: SEVERITY_RULE.HARDCODED_CAUTION,
    severityDetail: "Not an engine category. scan.js injects with severity: 'caution' hardcoded inline.",
    level1: { severity: 'none', verdictImpact: 'not-applicable', notes: 'Does not exist at L1.' },
    level2: {
      severity: 'caution', verdictImpact: 'yellow',
      notes: 'Organic-path only; third and last of three mutually-exclusive sub-checks — only evaluated if neither fortified_vitamins nor natural_colorants already matched. Also sets the oliveCaveat side-effect boolean — see CROSS_CUTTING_RULES.oliveCaveatSideEffect.',
      divergesFromLiveScanJs: false,
    },
    clearance: [{ mechanism: 'none', effect: 'not-applicable' }],
    rejectFlagGate: { required: GATE_REQUIREMENT.NOT_APPLICABLE, notes: 'Never reject-severity.' },
    scope: SCOPE.ORGANIC_PATH_ONLY,
    notes: 'Stage 2 discrepancy #8: intentional by omission, not a disagreement. Also the only category with an out-of-band side effect (oliveCaveat).',
  },
];

// ────────────────────────────────────────────────────────────────────────
// Cross-cutting rules — do NOT fit a per-category row (per Stage 2's own
// recommendation). Documented here as constants/comments, not table rows.
// ────────────────────────────────────────────────────────────────────────

const CROSS_CUTTING_RULES = {
  /** Nodes 1–3 of today's L2 tree: any flag in these four categories
   *  short-circuits the entire tree to red before the organic path (or
   *  anything else) is even evaluated. Not a per-category fact — it's a
   *  cross-category priority tier. */
  instantRedPriorityTier: {
    description:
      'At L2, any reject-severity flag in this set forces verdict=red immediately, before the organic path or any other rule runs. Redundant with each ' +
      'member category\'s own hardcoded/level-aware severity, but positioned first in evaluation order as a safety net.',
    categories: ['trans_fats', 'seed_oils', 'natural_flavors', 'additives'],
    appliesAtLevels: [2],
  },

  /** Removes gluten_grains from the flags array and recomputes verdict
   *  from the remainder. Implemented twice today (once for L1, once
   *  inside the L2 tree) as separately hand-written but logically
   *  identical code — a generic operation, not a category-specific rule. */
  glutenStripMechanism: {
    description:
      "Filter out every flag with category==='gluten_grains', then recompute verdict from the remaining flags' severities (reject→red, caution→yellow, " +
      'else green). gluten_grains is a future paywall feature, invisible at both levels by design.',
    appliesAtLevels: [1, 2],
  },

  /** Post-verdict metadata only — never touches flags or verdict itself. */
  certUnconfirmedRule: {
    description:
      "When verdict is default-yellow with zero flags and no clearedBy, and every non-trivial ingredient token is prefixed 'organic', sets " +
      "unverifiedReason='cert_unconfirmed' so the explanation layer can say 'the label looks organic — flip the package and check for the seal' instead of " +
      'the generic no-cert framing. Does not change verdict or flags.',
    codedAtLevels: [1, 2],
    practicallyEffectiveAtLevels: [2],
    practicalNote:
      'Coded level-unconditional, but verdict==="yellow" with zero flags is essentially unreachable at L1 given how the engine and the L1 overrides compute ' +
      'verdict (traced exhaustively in the Stage 2 report) — L1 arrives at green via engine-level clearance before this check would ever apply.',
  },

  /** Whole-product ingredient-composition check, not a single-trigger
   *  category match. */
  pureWaterRule: {
    description:
      "When verdict is default-yellow with zero flags and no clearedBy, and every ingredient token is in WATER_SAFE_INGREDIENTS (water forms, naturally " +
      "occurring minerals, CO2), upgrades verdict to green with clearedBy='pure_water'. USDA organic certification is inapplicable to geological water " +
      'sources, so the absence of a cert label should not read as a concern for these products.',
    codedAtLevels: [1, 2],
    practicallyEffectiveAtLevels: [2],
    practicalNote: 'Same reasoning as certUnconfirmedRule — a qualifying L1 water product already reaches green via engine-level clearance before this check would apply.',
  },

  /** Keys off unverifiedIngredients.length, orthogonal to any specific
   *  category trigger. */
  inconclusiveVerdictRule: {
    description:
      "When a product has real ingredient text, the verdict is otherwise green, there are no real flags (gluten_grains excluded — it's invisible by " +
      'design), and more than 5 ingredient tokens were unrecognized, overrides verdict to "inconclusive" — the engine could not meaningfully screen this ' +
      'product, so a false-clean green would be misleading. Runs once, identically, regardless of level.',
    appliesAtLevels: [1, 2],
  },

  /** A top-level response field, not part of flags[] — no other category
   *  has an out-of-band side effect like this. */
  oliveCaveatSideEffect: {
    description:
      'A boolean response field (not a flags[] entry) set to true only when the organic-path olive_oil_adulteration sub-check fires. Signals the ' +
      'explanation layer to add adulteration-risk framing even though the product is otherwise clean/organic.',
    tiedToCategory: 'olive_oil_adulteration',
  },

  /** Not rules themselves — shared infrastructure that multiple category
   *  clearance checks read from. Documented once, centrally, rather than
   *  re-derived per row. */
  sharedInputSignals: {
    description:
      'Computed once per scan, consumed by multiple rows above rather than recomputed per category: isMeat (= isMeatCategory || isMeatIngredient, feeds ' +
      'conventional_meat), detectWildCaught() (feeds conventional_meat\'s wild-caught clearance), isSeafoodProduct()/isGameMeatProduct() (feed ' +
      'conventional_meat\'s routing and the seafood/game-meat no-op paths).',
    signals: ['isMeat', 'isMeatCategory', 'isMeatIngredient', 'detectWildCaught', 'isSeafoodProduct', 'isGameMeatProduct'],
  },
};

// ────────────────────────────────────────────────────────────────────────
// Design decisions log — the Stage 2 discrepancy resolutions this table
// encodes. Kept as structured data (not just prose in row.notes) so tests
// can assert directly that each decision is actually reflected in the
// table, rather than only asserting on the table's surface shape.
// ────────────────────────────────────────────────────────────────────────

const DESIGN_DECISIONS = {
  correctedBioengineeringOrganicClearance: {
    discrepancy: '#1',
    kind: 'correction',
    liveScanJsBug: "L2 Node 4 (organic path) has no reject-flag gate and lib/rulesEngine.js's BIOENGINEERING_TERMS loop has no organic/non-gmo clearance at all — a usda-organic-labeled product with a bioengineered disclosure gets a full GREEN, silently discarding the reject flag.",
    tableEncodesInstead: 'bioengineering row gains organic/non-gmo/prefix clearance, matching conventional_crops\'s pattern — see the row\'s level2.divergenceReason.',
    appliedToLiveCode: false,
  },
  correctedGameMeatNoOpAtL2: {
    discrepancy: '#2',
    kind: 'correction',
    liveScanJsBug: 'L2 Node 6 (game meat) unconditionally sets verdict=green with no reject-flag gate, silently discarding any pre-existing reject-severity flag (bioengineering, conventional_crops, conventional_eggs, glyphosate_heavy).',
    tableEncodesInstead: "conventional_meat row's game-meat-category clearance path is a no-op (matching L1's already-correct behavior), not an active override — see the row's level2.divergenceReason.",
    appliedToLiveCode: false,
  },
  intentionalEggsNonGmoExclusion: {
    discrepancy: '#3',
    kind: 'intentional_no_fix',
    reasoning: 'Non-GMO Project Verification is fundamentally a crop-genetics certification; applied to eggs it is really a claim about hen feed, a materially narrower/different claim than what the label means on a plant crop.',
    tableEncodesInstead: 'conventional_eggs row\'s clearance list explicitly marks non-gmo-project-verified as INTENTIONALLY-NOT-CLEARED, distinct from conventional_crops which is cleared by it.',
    appliedToLiveCode: false,
  },
  correctedEggsPriorityOverGenericMeatInjection: {
    discrepancy: '#4',
    kind: 'correction',
    liveScanJsBug: "L2 Node 8 (conventional meat) is checked before Node 8b (conventional_eggs), so an OFF-tagged egg product hits the generic conventional_meat injection first — verdict ends up correct either way, but the generic land-animal-flavored message renders ahead of the specific egg messaging. The same ordering issue exists at L1 (Override 2's 'else' branch has no egg-awareness at all).",
    tableEncodesInstead: 'conventional_eggs.priorityRelativeTo and conventional_meat.priorityRelativeTo encode conventional_eggs as strictly taking priority over the generic conventional_meat injection, at both levels.',
    appliedToLiveCode: false,
  },
  deadCodePostTreeConventionalCropsStrip: {
    discrepancy: '#6',
    kind: 'not_carried_forward',
    whatItWas: "Today's L2 tree has a post-waterfall step: strip any surviving conventional_crops flag when clearedBy==='organic'.",
    whyNotInTable: 'Stage 2 traced every assignment to clearedBy in the L2 tree and could not construct a path where a conventional_crops flag survives into `flags` AND clearedBy ends up "organic" simultaneously, given conventional_crops\'s existing engine-level organic clearance. Believed dead/unreachable, not asserted with total certainty.',
    actionItem: 'Whoever retires the old pages/api/scan.js L2 tree at cutover should double-check this reasoning before deleting the line, in case some code path was missed.',
    appliedToLiveCode: false,
  },
};

module.exports = {
  SEVERITY_RULE,
  GATE_REQUIREMENT,
  SCOPE,
  VERDICT_RULES,
  CROSS_CUTTING_RULES,
  DESIGN_DECISIONS,
};
