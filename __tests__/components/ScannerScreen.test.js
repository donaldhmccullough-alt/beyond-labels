'use strict';

/**
 * __tests__/components/ScannerScreen.test.js
 *
 * Direct unit tests of isNetworkError(), exported from ScannerScreen.jsx —
 * this project has no React rendering test infrastructure
 * (jest.config.js sets testEnvironment: 'node', no @testing-library/react;
 * same situation as ConcernCard.jsx/getFallbackSummary and
 * SwapsScreen.jsx/FLAG_CATEGORY_MAP), so the actual <ScannerScreen>
 * component is never rendered here — only the extracted network-error
 * classification logic is tested directly.
 *
 * Context: scanning with no internet connection previously showed the same
 * generic "Something went wrong. Please try again." message as any other
 * scan failure — unhelpful in a mobile, in-store, spotty-signal context.
 * isNetworkError(err) distinguishes a fetch()-level network failure (always
 * a TypeError per the Fetch spec) from a real HTTP error status (which
 * resolves normally, never throws) or a malformed JSON body (SyntaxError),
 * so processBarcode() can show a distinct, friendlier offline message
 * without misclassifying other real failure types.
 */

const { isNetworkError } = require('../../components/scanner/ScannerScreen');

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
