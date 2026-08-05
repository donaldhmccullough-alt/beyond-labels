'use strict';

/**
 * __tests__/components/ScannerScreen.test.js
 *
 * Direct unit tests of isNetworkError() and createProcessBarcodeHandler(),
 * both exported from ScannerScreen.jsx — this project has no React
 * rendering test infrastructure (jest.config.js sets testEnvironment:
 * 'node', no @testing-library/react; same situation as
 * ConcernCard.jsx/getFallbackSummary, SwapsScreen.jsx/FLAG_CATEGORY_MAP, and
 * lib/scanHistory.js's createHistoryTapHandler), so the actual
 * <ScannerScreen> component is never rendered here — only the extracted
 * logic is tested directly, by calling the factory with mock refs/setters
 * exactly as the real component would supply them.
 *
 * Context: processBarcode() had no guard against a second scan starting
 * while a previous one was still awaiting fetch('/api/scan'). Navigating
 * away (unmounting ScannerScreen) or resubmitting the manual-entry form
 * left the first request running server-side (real Anthropic call, real
 * scan_cache write) with its resolution still calling onScanResult — owned
 * by the parent app/page.jsx, not the unmounted ScannerScreen — which could
 * silently navigate the user to the Verdict screen for a product they'd
 * already moved past. See CLAUDE.md for the full investigation and the fix
 * this closes.
 *
 * The "manual-entry submit button is disabled while a scan is in flight"
 * requirement is tested by asserting setScanning(true)/(false) are called
 * at the right times — that's the state the real JSX binds
 * disabled={scanning} to (components/scanner/ScannerScreen.jsx), so
 * asserting on the setter calls is the closest equivalent to asserting on
 * the rendered button without a rendering harness.
 */

const {
  isNetworkError,
  createProcessBarcodeHandler,
  SCAN_BUTTON_WIDTH,
} = require('../../components/scanner/ScannerScreen');

jest.mock('../../lib/userProfile', () => ({
  getScanUsage: jest.fn(() => ({ scanCount: 0, resetDate: '2026-07' })),
  incrementScan: jest.fn(),
  getScanHistory: jest.fn(() => []),
  addScanToHistory: jest.fn(),
  incrementTotalScan: jest.fn(),
}));

jest.mock('../../lib/auth', () => ({
  logScanToSupabase: jest.fn(async () => true),
  getSupabaseScanCountThisMonth: jest.fn(async () => 0),
  getSupabaseScanHistory: jest.fn(async () => []),
}));

jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

const Sentry = require('@sentry/nextjs');

describe('isNetworkError()', () => {
  test('a TypeError with the Chrome-style "Failed to fetch" message is a network error', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
  });

  test('a TypeError with the Firefox-style "NetworkError..." message is a network error', () => {
    expect(isNetworkError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true);
  });

  test('a bare TypeError with no message is still a network error (classification is by type, not message text)', () => {
    expect(isNetworkError(new TypeError())).toBe(true);
  });

  test('a SyntaxError (e.g. res.json() failing on a malformed body) is NOT a network error', () => {
    expect(isNetworkError(new SyntaxError('Unexpected token < in JSON at position 0'))).toBe(false);
  });

  test('a plain Error (e.g. a thrown Supabase error) is NOT a network error', () => {
    expect(isNetworkError(new Error('some other failure'))).toBe(false);
  });

  test('undefined is NOT a network error (defensive — should not throw)', () => {
    expect(isNetworkError(undefined)).toBe(false);
  });

  test('a string is NOT a network error (defensive — should not throw)', () => {
    expect(isNetworkError('Failed to fetch')).toBe(false);
  });

  test('null is NOT a network error (defensive — should not throw)', () => {
    expect(isNetworkError(null)).toBe(false);
  });
});

describe('SCAN_BUTTON_WIDTH — scan/stop-scanning CTA narrowed from full-width', () => {
  // The button was previously full-width (`calc(100% - 32px)`), making it
  // easy to mis-hit. Narrowed to a fixed percentage, horizontally centered
  // via `margin: '16px auto 0'` in the real JSX. Exported as a plain constant
  // specifically so this is testable at all without a rendering harness.

  test('is set to 78%, not full-width', () => {
    expect(SCAN_BUTTON_WIDTH).toBe('78%');
  });

  test('is comfortably within the 75-80% target range', () => {
    const pct = parseFloat(SCAN_BUTTON_WIDTH);
    expect(pct).toBeGreaterThanOrEqual(75);
    expect(pct).toBeLessThanOrEqual(80);
  });

  test('is no longer the old full-width calc() expression', () => {
    expect(SCAN_BUTTON_WIDTH).not.toBe('calc(100% - 32px)');
    expect(SCAN_BUTTON_WIDTH).not.toBe('100%');
  });
});

describe('createProcessBarcodeHandler() — in-flight scan race condition fix', () => {
  const OFFLINE_MESSAGE = '📶 No internet connection — check your connection and try again.';
  const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

  function makeAbortError() {
    const err = new Error('The operation was aborted.');
    err.name = 'AbortError';
    return err;
  }

  // A fetch() stand-in that mirrors real abort semantics: each call gets a
  // response spec from `responses`, in call order. A spec of 'hang' never
  // resolves on its own (simulating a slow/never-returning request) but
  // does reject with a real AbortError the instant its own signal aborts —
  // exactly what a real fetch() does. Any other spec resolves on the next
  // microtask tick with { json: async () => spec }.
  function makeMockFetch(responses) {
    let callIndex = 0;
    return jest.fn((url, opts) => {
      const spec = responses[callIndex++];
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(makeAbortError());
        if (opts.signal.aborted) { onAbort(); return; }
        opts.signal.addEventListener('abort', onAbort);
        if (spec === 'hang') return;
        Promise.resolve().then(() => {
          opts.signal.removeEventListener('abort', onAbort);
          resolve({ json: async () => spec });
        });
      });
    });
  }

  function makeDeps(overrides = {}) {
    return {
      scanInFlightRef: { current: false },
      currentScanAbortRef: { current: null },
      setScanError: jest.fn(),
      setScanning: jest.fn(),
      setScanUsage: jest.fn(),
      setHistory: jest.fn(),
      user: null,
      userLevel: 2,
      onScanResult: jest.fn(),
      ...overrides,
    };
  }

  afterEach(() => {
    jest.clearAllMocks();
    delete global.fetch;
  });

  test('a normal single scan calls onScanResult with the fetched data (baseline, no race)', async () => {
    const deps = makeDeps();
    global.fetch = makeMockFetch([{ verdict: 'green', barcode: '111', productName: 'Plain Water', found: true }]);
    const processBarcode = createProcessBarcodeHandler(deps);

    await processBarcode('111');

    expect(deps.onScanResult).toHaveBeenCalledTimes(1);
    expect(deps.onScanResult).toHaveBeenCalledWith(expect.objectContaining({ barcode: '111', productName: 'Plain Water' }));
    expect(deps.setScanning).toHaveBeenCalledWith(true);
    expect(deps.setScanning).toHaveBeenLastCalledWith(false);
  });

  test('rapid double-scan: only the second scan\'s result reaches onScanResult', async () => {
    const deps = makeDeps();
    // First call's fetch hangs until aborted; second call's fetch resolves normally.
    global.fetch = makeMockFetch([
      'hang',
      { verdict: 'red', barcode: '222', productName: 'Second Product', found: true },
    ]);
    const processBarcode = createProcessBarcodeHandler(deps);

    const first = processBarcode('111');
    const second = processBarcode('222');

    await Promise.all([first, second]);

    // The first request was superseded/aborted — it must never have called
    // onScanResult, and the only call that happened is for the second,
    // winning scan.
    expect(deps.onScanResult).toHaveBeenCalledTimes(1);
    expect(deps.onScanResult).toHaveBeenCalledWith(expect.objectContaining({ barcode: '222', productName: 'Second Product' }));
  });

  test('rapid double-scan: the stale (first) request never touches setScanUsage/setHistory either', async () => {
    const deps = makeDeps();
    global.fetch = makeMockFetch([
      'hang',
      { verdict: 'green', barcode: '222', productName: 'Second Product', found: true },
    ]);
    const processBarcode = createProcessBarcodeHandler(deps);

    await Promise.all([processBarcode('111'), processBarcode('222')]);

    // Anonymous (no user) path calls setScanUsage/setHistory exactly once —
    // for the winning second scan, not twice (once per attempted scan).
    expect(deps.setScanUsage).toHaveBeenCalledTimes(1);
    expect(deps.setHistory).toHaveBeenCalledTimes(1);
  });

  test('unmounting mid-request (simulated via the same abort the useEffect cleanup calls) prevents onScanResult from firing when the stale response arrives', async () => {
    const deps = makeDeps();
    global.fetch = makeMockFetch(['hang']);
    const processBarcode = createProcessBarcodeHandler(deps);

    const pending = processBarcode('111');

    // This is exactly what ScannerScreen's unmount-cleanup useEffect calls:
    // currentScanAbortRef.current?.abort()
    deps.currentScanAbortRef.current?.abort();

    await pending;

    expect(deps.onScanResult).not.toHaveBeenCalled();
    expect(deps.setScanUsage).not.toHaveBeenCalled();
    expect(deps.setHistory).not.toHaveBeenCalled();
  });

  test('an aborted request does not trigger the generic error-toast path (setScanError is only ever cleared to null, never set to a real message; Sentry is never called)', async () => {
    const deps = makeDeps();
    global.fetch = makeMockFetch(['hang']);
    const processBarcode = createProcessBarcodeHandler(deps);

    const pending = processBarcode('111');
    deps.currentScanAbortRef.current?.abort();
    await pending;

    // setScanError(null) at the top of every scan (clearing a stale error
    // banner before starting) is expected and unrelated to this guard —
    // what must never happen is setScanError being called with a real
    // message (OFFLINE_MESSAGE/GENERIC_ERROR_MESSAGE), which is what the
    // "error toast" actually is.
    expect(deps.setScanError).not.toHaveBeenCalledWith(OFFLINE_MESSAGE);
    expect(deps.setScanError).not.toHaveBeenCalledWith(GENERIC_ERROR_MESSAGE);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  test('a genuine (non-abort) thrown error still shows the generic error message and reports to Sentry — the AbortError carve-out does not swallow real failures', async () => {
    const deps = makeDeps();
    global.fetch = jest.fn(() => Promise.reject(new Error('ECONNRESET')));
    const processBarcode = createProcessBarcodeHandler(deps);

    await processBarcode('111');

    expect(deps.setScanError).toHaveBeenCalledWith(GENERIC_ERROR_MESSAGE);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(deps.onScanResult).not.toHaveBeenCalled();
    expect(deps.setScanning).toHaveBeenLastCalledWith(false);
  });

  test('a genuine network TypeError (offline) still shows the offline message, tagged at "warning" severity', async () => {
    const deps = makeDeps();
    global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const processBarcode = createProcessBarcodeHandler(deps);

    await processBarcode('111');

    expect(deps.setScanError).toHaveBeenCalledWith(OFFLINE_MESSAGE);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ level: 'warning', tags: expect.objectContaining({ errorType: 'offline' }) })
    );
  });

  test('setScanning(true) is set synchronously before the fetch resolves — this is what drives disabled={scanning} on the manual-entry submit button', async () => {
    const deps = makeDeps();
    global.fetch = makeMockFetch(['hang']);
    const processBarcode = createProcessBarcodeHandler(deps);

    const pending = processBarcode('111');

    // By the time processBarcode() has returned control (suspended at the
    // fetch await), setScanning(true) must already have fired synchronously.
    expect(deps.setScanning).toHaveBeenCalledWith(true);
    expect(deps.setScanning).not.toHaveBeenCalledWith(false);

    deps.currentScanAbortRef.current?.abort();
    await pending;

    // Cleared once the (aborted) request settles, via the finally block.
    expect(deps.setScanning).toHaveBeenCalledWith(false);
  });

  test('a re-entrant call in the exact same synchronous tick (before the first controller is even stored) is a no-op — the scanInFlightRef guard', async () => {
    const deps = makeDeps();
    // Simulate the same-tick re-entrancy window the ref guard exists for:
    // scanInFlightRef is already true when processBarcode is invoked.
    deps.scanInFlightRef.current = true;
    global.fetch = jest.fn();
    const processBarcode = createProcessBarcodeHandler(deps);

    await processBarcode('111');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(deps.setScanning).not.toHaveBeenCalled();
    expect(deps.onScanResult).not.toHaveBeenCalled();
  });
});
