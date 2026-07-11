'use strict';

/**
 * lib/verdictRules.test.js
 *
 * Asserts the Stage 3 unified rule table (lib/verdictRules.js) against the
 * ground-truth facts documented in the Stage 2 report — i.e. these tests
 * check the TABLE'S DATA, not pages/api/scan.js's or lib/rulesEngine.js's
 * live behavior. lib/verdictRules.js is not imported by any production
 * code path, so these tests do not exercise scan.js or rulesEngine.js at
 * all.
 *
 * Three categories (bioengineering, conventional_meat, conventional_eggs)
 * are deliberately asserted to hold CORRECTED target behavior that
 * disagrees with what scan.js does today — those assertions are the point
 * of this file, not a bug in the test.
 */

const {
  SEVERITY_RULE,
  GATE_REQUIREMENT,
  SCOPE,
  VERDICT_RULES,
  CROSS_CUTTING_RULES,
  DESIGN_DECISIONS,
} = require('./verdictRules');

function ruleFor(category) {
  const rule = VERDICT_RULES.find(r => r.category === category);
  if (!rule) throw new Error(`No VERDICT_RULES entry for category "${category}"`);
  return rule;
}

// ════════════════════════════════════════════════════════════════════════
// A. Structural integrity
// ════════════════════════════════════════════════════════════════════════

describe('A. Structural integrity', () => {
  const EXPECTED_CATEGORIES = [
    'trans_fats', 'seed_oils', 'conventional_crops', 'bioengineering',
    'natural_flavors', 'additives', 'glyphosate_heavy', 'gluten_grains',
    'conventional_eggs', 'conventional_meat', 'conventional_dairy',
    'fortified_vitamins', 'natural_colorants', 'olive_oil_adulteration',
  ];

  test('table has exactly 14 rows', () => {
    expect(VERDICT_RULES).toHaveLength(14);
  });

  test('every expected category is present, and no unexpected category exists', () => {
    const actual = VERDICT_RULES.map(r => r.category).sort();
    expect(actual).toEqual([...EXPECTED_CATEGORIES].sort());
  });

  test('no duplicate category names', () => {
    const names = VERDICT_RULES.map(r => r.category);
    expect(new Set(names).size).toBe(names.length);
  });

  test.each(EXPECTED_CATEGORIES)('%s has all required top-level fields', (category) => {
    const rule = ruleFor(category);
    expect(rule).toHaveProperty('isEngineCategory');
    expect(typeof rule.isEngineCategory).toBe('boolean');
    expect(Object.values(SEVERITY_RULE)).toContain(rule.severityRule);
    expect(typeof rule.severityDetail).toBe('string');
    expect(rule.severityDetail.length).toBeGreaterThan(0);
    expect(rule.level1).toBeDefined();
    expect(rule.level2).toBeDefined();
    expect(Array.isArray(rule.clearance)).toBe(true);
    expect(rule.rejectFlagGate).toBeDefined();
    expect(Object.values(GATE_REQUIREMENT)).toContain(rule.rejectFlagGate.required);
    expect(Object.values(SCOPE)).toContain(rule.scope);
    expect(typeof rule.notes).toBe('string');
  });

  test('every level2 row declares divergesFromLiveScanJs as a boolean, and provides a reason iff true', () => {
    for (const rule of VERDICT_RULES) {
      expect(typeof rule.level2.divergesFromLiveScanJs).toBe('boolean');
      if (rule.level2.divergesFromLiveScanJs) {
        expect(typeof rule.level2.divergenceReason).toBe('string');
        expect(rule.level2.divergenceReason.length).toBeGreaterThan(0);
      } else {
        expect(rule.level2.divergenceReason).toBeUndefined();
      }
    }
  });

  test('the 9 engine-emitted categories and 5 scan.js-injected categories are correctly split', () => {
    const engineCategories = VERDICT_RULES.filter(r => r.isEngineCategory).map(r => r.category).sort();
    const injectedCategories = VERDICT_RULES.filter(r => !r.isEngineCategory).map(r => r.category).sort();

    expect(engineCategories).toEqual([
      'additives', 'bioengineering', 'conventional_crops', 'conventional_eggs',
      'glyphosate_heavy', 'gluten_grains', 'natural_flavors', 'seed_oils', 'trans_fats',
    ].sort());

    expect(injectedCategories).toEqual([
      'conventional_dairy', 'conventional_meat', 'fortified_vitamins',
      'natural_colorants', 'olive_oil_adulteration',
    ].sort());
  });

  test('only the three organic-path-only categories use SCOPE.ORGANIC_PATH_ONLY', () => {
    const scoped = VERDICT_RULES.filter(r => r.scope === SCOPE.ORGANIC_PATH_ONLY).map(r => r.category).sort();
    expect(scoped).toEqual(['fortified_vitamins', 'natural_colorants', 'olive_oil_adulteration'].sort());
  });
});

// ════════════════════════════════════════════════════════════════════════
// B. Severity rule shape — per Stage 2's line-by-line read of rulesEngine.js
// ════════════════════════════════════════════════════════════════════════

describe('B. Severity rule shape', () => {
  test('trans_fats and additives are HARDCODED_REJECT (never level-aware)', () => {
    expect(ruleFor('trans_fats').severityRule).toBe(SEVERITY_RULE.HARDCODED_REJECT);
    expect(ruleFor('additives').severityRule).toBe(SEVERITY_RULE.HARDCODED_REJECT);
  });

  test('seed_oils, conventional_crops, bioengineering, natural_flavors, conventional_eggs are LEVEL_AWARE (severityFor)', () => {
    for (const category of ['seed_oils', 'conventional_crops', 'bioengineering', 'natural_flavors', 'conventional_eggs']) {
      expect(ruleFor(category).severityRule).toBe(SEVERITY_RULE.LEVEL_AWARE);
    }
  });

  test('glyphosate_heavy is INLINE_CUSTOM — the only category with this shape', () => {
    expect(ruleFor('glyphosate_heavy').severityRule).toBe(SEVERITY_RULE.INLINE_CUSTOM);
    const inlineCustomRows = VERDICT_RULES.filter(r => r.severityRule === SEVERITY_RULE.INLINE_CUSTOM);
    expect(inlineCustomRows).toHaveLength(1);
    expect(inlineCustomRows[0].category).toBe('glyphosate_heavy');
  });

  test('gluten_grains and the three organic-path-only categories are HARDCODED_CAUTION', () => {
    for (const category of ['gluten_grains', 'fortified_vitamins', 'natural_colorants', 'olive_oil_adulteration']) {
      expect(ruleFor(category).severityRule).toBe(SEVERITY_RULE.HARDCODED_CAUTION);
    }
  });

  test('conventional_meat and conventional_dairy are INJECTED (not engine categories)', () => {
    expect(ruleFor('conventional_meat').severityRule).toBe(SEVERITY_RULE.INJECTED);
    expect(ruleFor('conventional_dairy').severityRule).toBe(SEVERITY_RULE.INJECTED);
    expect(ruleFor('conventional_meat').isEngineCategory).toBe(false);
    expect(ruleFor('conventional_dairy').isEngineCategory).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════
// C. Level 1 behavior — per Stage 2 ground truth
// ════════════════════════════════════════════════════════════════════════

describe('C. Level 1 behavior', () => {
  test('trans_fats and additives are reject/red at L1 — no L1 softening', () => {
    expect(ruleFor('trans_fats').level1).toMatchObject({ severity: 'reject', verdictImpact: 'red' });
    expect(ruleFor('additives').level1).toMatchObject({ severity: 'reject', verdictImpact: 'red' });
  });

  test('seed_oils, conventional_crops, bioengineering, natural_flavors, conventional_eggs are caution/yellow at L1', () => {
    for (const category of ['seed_oils', 'conventional_crops', 'bioengineering', 'natural_flavors', 'conventional_eggs']) {
      expect(ruleFor(category).level1).toMatchObject({ severity: 'caution', verdictImpact: 'yellow' });
    }
  });

  test('glyphosate_heavy is ALWAYS caution/yellow at L1, regardless of certification', () => {
    const rule = ruleFor('glyphosate_heavy');
    expect(rule.level1.severity).toBe('caution');
    expect(rule.level1.verdictImpact).toBe('yellow');
    expect(rule.level1.notes.toLowerCase()).toContain('regardless of any certification');
  });

  test('gluten_grains is caution-severity but a no-op (invisible) at L1', () => {
    expect(ruleFor('gluten_grains').level1).toMatchObject({ severity: 'caution', verdictImpact: 'no-op' });
  });

  test('the three organic-path-only categories do not exist at L1', () => {
    for (const category of ['fortified_vitamins', 'natural_colorants', 'olive_oil_adulteration']) {
      expect(ruleFor(category).level1).toMatchObject({ severity: 'none', verdictImpact: 'not-applicable' });
    }
  });

  test('conventional_meat and conventional_dairy only ever upgrade green to yellow at L1, never force red', () => {
    expect(ruleFor('conventional_meat').level1.verdictImpact).toBe('yellow-upgrade-only');
    expect(ruleFor('conventional_dairy').level1.verdictImpact).toBe('yellow-upgrade-only');
  });
});

// ════════════════════════════════════════════════════════════════════════
// D. Level 2 behavior — including the CORRECTED rows (#1, #2, #4)
// ════════════════════════════════════════════════════════════════════════

describe('D. Level 2 behavior', () => {
  test('trans_fats, seed_oils, natural_flavors, additives are reject/red at L2 and are the instant-red tier', () => {
    for (const category of ['trans_fats', 'seed_oils', 'natural_flavors', 'additives']) {
      expect(ruleFor(category).level2).toMatchObject({ severity: 'reject', verdictImpact: 'red' });
    }
    expect(CROSS_CUTTING_RULES.instantRedPriorityTier.categories.sort()).toEqual(
      ['trans_fats', 'seed_oils', 'natural_flavors', 'additives'].sort()
    );
  });

  test('glyphosate_heavy is reject/red at L2 unless the glyphosate-free label downgrades it to caution', () => {
    const rule = ruleFor('glyphosate_heavy');
    expect(rule.level2.severity).toBe('reject-or-caution');
    const downgrade = rule.clearance.find(c => c.mechanism === 'glyphosate-free-label');
    expect(downgrade).toBeDefined();
    expect(downgrade.effect).toBe('severity-downgrade');
  });

  test('gluten_grains is a no-op (invisible) at L2, identically to L1 — not a disagreement', () => {
    const rule = ruleFor('gluten_grains');
    expect(rule.level2).toMatchObject({ severity: 'caution', verdictImpact: 'no-op' });
    expect(rule.level2.divergesFromLiveScanJs).toBe(false);
  });

  test('CORRECTION #1 — bioengineering row diverges from live scan.js and gains organic clearance', () => {
    const rule = ruleFor('bioengineering');
    expect(rule.level2.divergesFromLiveScanJs).toBe(true);
    expect(rule.level2.divergenceReason).toMatch(/Node 4/);
    const organicClearance = rule.clearance.find(c => c.mechanism === 'usda-organic-label');
    expect(organicClearance).toBeDefined();
    expect(organicClearance.effect).toBe('full-clearance');
    // Not just documented — the reject-flag gate is no longer required as a result.
    expect(rule.rejectFlagGate.required).toBe(GATE_REQUIREMENT.NOT_REQUIRED);
  });

  test('CORRECTION #1 — today\'s live rulesEngine.js truly has no such clearance (sanity check against the real engine)', () => {
    // This does not import scan.js/rulesEngine.js as a dependency of verdictRules.js
    // (which stays standalone) — it's a one-off cross-check confirming the divergence
    // this test file documents is real, not stale.
    const { analyzeIngredients } = require('./rulesEngine');
    const result = analyzeIngredients('Bioengineered ingredient, salt, water.', ['usda-organic'], 2);
    const bioFlag = result.flags.find(f => f.category === 'bioengineering');
    expect(bioFlag).toBeDefined(); // live engine still flags this — confirms the table's correction is a real behavior change, not already-fixed
    expect(bioFlag.severity).toBe('reject');
  });

  test('CORRECTION #2 — conventional_meat row diverges from live scan.js for game meat, now a no-op like L1', () => {
    const rule = ruleFor('conventional_meat');
    expect(rule.level2.divergesFromLiveScanJs).toBe(true);
    expect(rule.level2.divergenceReason).toMatch(/Node 6/);
    const gameMeatClearance = rule.clearance.find(c => c.mechanism === 'game-meat-category');
    expect(gameMeatClearance).toBeDefined();
    expect(gameMeatClearance.effect).toBe('no-op');
  });

  test('CORRECTION #2 — the wild-caught path (already correct in live code) keeps its required gate; the game-meat path (corrected) needs none', () => {
    const rule = ruleFor('conventional_meat');
    // The category-level gate requirement documents that the wild-caught no-op path
    // still needs a gate; the notes explain why the game-meat no-op path does not.
    expect(rule.rejectFlagGate.required).toBe(GATE_REQUIREMENT.REQUIRED);
    expect(rule.rejectFlagGate.notes).toMatch(/wild-caught-signal no-op path specifically/);
    expect(rule.rejectFlagGate.notes).toMatch(/NOT required for the game-meat-category no-op path/);
  });

  test('CORRECTION #4 — conventional_eggs takes priority over conventional_meat at both levels', () => {
    const eggs = ruleFor('conventional_eggs');
    const meat = ruleFor('conventional_meat');

    expect(eggs.priorityRelativeTo).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'conventional_meat', relation: 'takes-priority-over', appliesAtLevels: [1, 2] }),
      ])
    );
    expect(meat.priorityRelativeTo).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'conventional_eggs', relation: 'yields-priority-to', appliesAtLevels: [1, 2] }),
      ])
    );
  });

  test('CORRECTION #4 — conventional_eggs row documents the divergence from live Node 8/8b ordering', () => {
    const rule = ruleFor('conventional_eggs');
    expect(rule.level2.divergesFromLiveScanJs).toBe(true);
    expect(rule.level2.divergenceReason).toMatch(/Node 8/);
    expect(rule.level2.divergenceReason).toMatch(/Node 8b/);
  });

  test('every category NOT part of a #1/#2/#4 correction declares divergesFromLiveScanJs: false', () => {
    const correctedCategories = new Set(['bioengineering', 'conventional_meat', 'conventional_eggs']);
    for (const rule of VERDICT_RULES) {
      if (!correctedCategories.has(rule.category)) {
        expect(rule.level2.divergesFromLiveScanJs).toBe(false);
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// E. Clearance mechanisms
// ════════════════════════════════════════════════════════════════════════

describe('E. Clearance mechanisms', () => {
  test('conventional_crops is cleared by usda-organic, non-gmo-project-verified, AND organic prefix', () => {
    const mechanisms = ruleFor('conventional_crops').clearance.map(c => c.mechanism);
    expect(mechanisms).toEqual(expect.arrayContaining([
      'usda-organic-label', 'non-gmo-project-verified-label', 'organic-ingredient-prefix',
    ]));
  });

  test('DISCREPANCY #3 — conventional_eggs is cleared by usda-organic and prefix, but NOT non-gmo-project-verified (intentional)', () => {
    const rule = ruleFor('conventional_eggs');
    const nonGmoEntry = rule.clearance.find(c => c.mechanism === 'non-gmo-project-verified-label');
    expect(nonGmoEntry).toBeDefined();
    expect(nonGmoEntry.effect).toBe('INTENTIONALLY-NOT-CLEARED');

    const organicEntry = rule.clearance.find(c => c.mechanism === 'usda-organic-label');
    expect(organicEntry.effect).toBe('full-clearance');
  });

  test('DISCREPANCY #3 — the design decisions log carries the crop-genetics-vs-hen-feed reasoning', () => {
    const decision = DESIGN_DECISIONS.intentionalEggsNonGmoExclusion;
    expect(decision.discrepancy).toBe('#3');
    expect(decision.kind).toBe('intentional_no_fix');
    expect(decision.reasoning).toMatch(/crop-genetics certification/);
    expect(decision.reasoning).toMatch(/hen feed/);
    expect(decision.appliedToLiveCode).toBe(false);
  });

  test('glyphosate_heavy distinguishes full-clearance (organic/prefix) from severity-downgrade (glyphosate-free)', () => {
    const rule = ruleFor('glyphosate_heavy');
    const effects = rule.clearance.map(c => c.effect);
    expect(effects).toEqual(expect.arrayContaining(['full-clearance', 'severity-downgrade']));
    // Exactly one downgrade-only mechanism, and it must be glyphosate-free.
    const downgrades = rule.clearance.filter(c => c.effect === 'severity-downgrade');
    expect(downgrades).toHaveLength(1);
    expect(downgrades[0].mechanism).toBe('glyphosate-free-label');
  });

  test('gluten_grains has no clearance mechanism of any kind', () => {
    expect(ruleFor('gluten_grains').clearance).toEqual([{
      mechanism: 'none', effect: 'no-clearance',
      notes: expect.stringContaining('organic-immune'),
    }]);
  });

  test('trans_fats, seed_oils, natural_flavors, additives have zero clearance mechanisms', () => {
    for (const category of ['trans_fats', 'seed_oils', 'natural_flavors', 'additives']) {
      const rule = ruleFor(category);
      expect(rule.clearance.every(c => c.effect === 'no-clearance' || c.effect === undefined)).toBe(true);
    }
  });

  test('the three organic-path-only categories have no separate clearance concept (scope IS the clearance)', () => {
    for (const category of ['fortified_vitamins', 'natural_colorants', 'olive_oil_adulteration']) {
      const rule = ruleFor(category);
      expect(rule.clearance).toHaveLength(1);
      expect(rule.clearance[0].effect).toBe('not-applicable');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// F. Reject-flag-gate requirements
// ════════════════════════════════════════════════════════════════════════

describe('F. Reject-flag-gate requirements', () => {
  test('only glyphosate_heavy and conventional_meat require a reject-flag gate', () => {
    const gated = VERDICT_RULES
      .filter(r => r.rejectFlagGate.required === GATE_REQUIREMENT.REQUIRED)
      .map(r => r.category)
      .sort();
    expect(gated).toEqual(['conventional_meat', 'glyphosate_heavy'].sort());
  });

  test('categories that only ever set red never require a gate (nothing to discard)', () => {
    for (const category of ['trans_fats', 'seed_oils', 'conventional_crops', 'natural_flavors', 'additives', 'conventional_eggs']) {
      expect(ruleFor(category).rejectFlagGate.required).toBe(GATE_REQUIREMENT.NOT_REQUIRED);
    }
  });

  test('categories that only ever upgrade or no-op never require a gate (structurally safe)', () => {
    expect(ruleFor('conventional_dairy').rejectFlagGate.required).toBe(GATE_REQUIREMENT.NOT_REQUIRED);
  });

  test('gluten_grains and the three organic-path-only categories mark the gate as not applicable (never reject-severity)', () => {
    for (const category of ['gluten_grains', 'fortified_vitamins', 'natural_colorants', 'olive_oil_adulteration']) {
      expect(ruleFor(category).rejectFlagGate.required).toBe(GATE_REQUIREMENT.NOT_APPLICABLE);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// G. Scope
// ════════════════════════════════════════════════════════════════════════

describe('G. Scope', () => {
  test('all engine categories and conventional_meat/conventional_dairy are GLOBAL scope', () => {
    const globalCategories = VERDICT_RULES.filter(r => r.scope === SCOPE.GLOBAL).map(r => r.category);
    expect(globalCategories).toHaveLength(11);
    expect(globalCategories).not.toEqual(expect.arrayContaining(['fortified_vitamins', 'natural_colorants', 'olive_oil_adulteration']));
  });

  test('fortified_vitamins, natural_colorants, olive_oil_adulteration are mutually exclusive by documented priority order', () => {
    // Encoded via each row's notes describing "first/second/third of three" — asserting the
    // documentation is present and internally consistent (first < second < third).
    expect(ruleFor('fortified_vitamins').level2.notes).toMatch(/first of three/);
    expect(ruleFor('natural_colorants').level2.notes).toMatch(/second of three/);
    expect(ruleFor('olive_oil_adulteration').level2.notes).toMatch(/third and last of three/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// H. Cross-cutting rules
// ════════════════════════════════════════════════════════════════════════

describe('H. Cross-cutting rules', () => {
  test('all 7 expected cross-cutting rules are present', () => {
    expect(Object.keys(CROSS_CUTTING_RULES).sort()).toEqual([
      'certUnconfirmedRule', 'glutenStripMechanism', 'inconclusiveVerdictRule',
      'instantRedPriorityTier', 'oliveCaveatSideEffect', 'pureWaterRule', 'sharedInputSignals',
    ].sort());
  });

  test('certUnconfirmedRule and pureWaterRule are coded level-unconditional but practically L2-only', () => {
    for (const rule of [CROSS_CUTTING_RULES.certUnconfirmedRule, CROSS_CUTTING_RULES.pureWaterRule]) {
      expect(rule.codedAtLevels).toEqual([1, 2]);
      expect(rule.practicallyEffectiveAtLevels).toEqual([2]);
    }
  });

  test('inconclusiveVerdictRule applies identically at both levels (no asymmetry)', () => {
    expect(CROSS_CUTTING_RULES.inconclusiveVerdictRule.appliesAtLevels).toEqual([1, 2]);
  });

  test('oliveCaveatSideEffect is tied to olive_oil_adulteration and is not a flags[] entry', () => {
    expect(CROSS_CUTTING_RULES.oliveCaveatSideEffect.tiedToCategory).toBe('olive_oil_adulteration');
    expect(CROSS_CUTTING_RULES.oliveCaveatSideEffect.description).toMatch(/not a flags\[\] entry/);
  });

  test('sharedInputSignals lists all 6 signals documented in the Stage 2 report', () => {
    expect(CROSS_CUTTING_RULES.sharedInputSignals.signals.sort()).toEqual([
      'isMeat', 'isMeatCategory', 'isMeatIngredient', 'detectWildCaught', 'isSeafoodProduct', 'isGameMeatProduct',
    ].sort());
  });

  test('glutenStripMechanism applies at both levels — the stripping operation itself is symmetric', () => {
    expect(CROSS_CUTTING_RULES.glutenStripMechanism.appliesAtLevels).toEqual([1, 2]);
  });
});

// ════════════════════════════════════════════════════════════════════════
// I. Design decisions log
// ════════════════════════════════════════════════════════════════════════

describe('I. Design decisions log', () => {
  test('all 5 Stage 2 discrepancy decisions are present and correctly numbered', () => {
    const byDiscrepancy = Object.values(DESIGN_DECISIONS).map(d => d.discrepancy).sort();
    expect(byDiscrepancy).toEqual(['#1', '#2', '#3', '#4', '#6'].sort());
  });

  test('decisions #1, #2, #4 are corrections; #3 is an intentional non-fix; #6 is not carried forward', () => {
    expect(DESIGN_DECISIONS.correctedBioengineeringOrganicClearance.kind).toBe('correction');
    expect(DESIGN_DECISIONS.correctedGameMeatNoOpAtL2.kind).toBe('correction');
    expect(DESIGN_DECISIONS.correctedEggsPriorityOverGenericMeatInjection.kind).toBe('correction');
    expect(DESIGN_DECISIONS.intentionalEggsNonGmoExclusion.kind).toBe('intentional_no_fix');
    expect(DESIGN_DECISIONS.deadCodePostTreeConventionalCropsStrip.kind).toBe('not_carried_forward');
  });

  test('every decision is explicitly marked as NOT applied to live code — this table is isolated', () => {
    for (const decision of Object.values(DESIGN_DECISIONS)) {
      expect(decision.appliedToLiveCode).toBe(false);
    }
  });

  test('DISCREPANCY #6 — dead-code note references the specific old scan.js mechanism, for whoever retires it later', () => {
    const decision = DESIGN_DECISIONS.deadCodePostTreeConventionalCropsStrip;
    expect(decision.whatItWas).toMatch(/conventional_crops/);
    expect(decision.whatItWas).toMatch(/organic/);
    expect(decision.actionItem).toMatch(/double-check/);
  });

  test('DISCREPANCY #6 — the dead-code rule is documented only in DESIGN_DECISIONS, not as a VERDICT_RULES row or a clearance entry', () => {
    // Per Stage 3 instructions: "do not carry this into the table at all."
    const conventionalCrops = ruleFor('conventional_crops');
    const mentionsPostTreeStrip = JSON.stringify(conventionalCrops).toLowerCase().includes('post-tree');
    expect(mentionsPostTreeStrip).toBe(false);
  });

  test('decision descriptions cross-reference the correct VERDICT_RULES rows', () => {
    expect(DESIGN_DECISIONS.correctedBioengineeringOrganicClearance.tableEncodesInstead).toMatch(/bioengineering/);
    expect(DESIGN_DECISIONS.correctedGameMeatNoOpAtL2.tableEncodesInstead).toMatch(/conventional_meat/);
    expect(DESIGN_DECISIONS.intentionalEggsNonGmoExclusion.tableEncodesInstead).toMatch(/conventional_eggs/);
    expect(DESIGN_DECISIONS.correctedEggsPriorityOverGenericMeatInjection.tableEncodesInstead).toMatch(/conventional_eggs/);
    expect(DESIGN_DECISIONS.correctedEggsPriorityOverGenericMeatInjection.tableEncodesInstead).toMatch(/conventional_meat/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// J. Isolation — this file must not be reachable from live production code
// ════════════════════════════════════════════════════════════════════════

describe('J. Isolation from live code', () => {
  test('pages/api/scan.js does not import lib/verdictRules', () => {
    const fs = require('fs');
    const path = require('path');
    const scanJsSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'scan.js'), 'utf8');
    expect(scanJsSource).not.toMatch(/verdictRules/);
  });

  test('lib/rulesEngine.js does not import lib/verdictRules', () => {
    const fs = require('fs');
    const path = require('path');
    const engineSource = fs.readFileSync(path.join(__dirname, 'rulesEngine.js'), 'utf8');
    expect(engineSource).not.toMatch(/verdictRules/);
  });
});
