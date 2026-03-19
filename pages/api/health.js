'use strict';

/**
 * GET /api/health
 *
 * Lightweight diagnostic endpoint. Returns:
 *   status       — always "ok" if the route loads
 *   nodeVersion  — confirms Node 18+ is running (required for native fetch)
 *   hasFetch     — true if global fetch is available (false = Node 16 bug)
 *   rulesEngine  — "ok" if rulesEngine.js imports without error, else the error message
 *   timestamp    — UTC ISO string
 */
module.exports = function handler(req, res) {
  let rulesEngineStatus;
  try {
    const { analyzeIngredients } = require('../../lib/rulesEngine');
    // Quick smoke-test: null input should return unverified cleanly
    const result = analyzeIngredients(null);
    rulesEngineStatus = result.verdict === 'unverified' ? 'ok' : 'unexpected verdict: ' + result.verdict;
  } catch (err) {
    rulesEngineStatus = 'ERROR: ' + err.message;
  }

  return res.status(200).json({
    status:       'ok',
    nodeVersion:  process.version,
    hasFetch:     typeof fetch !== 'undefined',
    rulesEngine:  rulesEngineStatus,
    timestamp:    new Date().toISOString(),
  });
};
