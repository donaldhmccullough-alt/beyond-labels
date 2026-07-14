'use strict';

/**
 * __tests__/components/DeleteAccountModal.test.js
 *
 * Direct unit tests of isDeleteReady(), exported from DeleteAccountModal.jsx
 * — this project has no React rendering test infrastructure
 * (testEnvironment: 'node', no @testing-library/react), same reasoning as
 * ConcernCard.jsx/getFallbackSummary and SwapsScreen.jsx/FLAG_CATEGORY_MAP.
 *
 * Context: unlike ChangePasswordModal, account deletion needs to be hard to
 * trigger by accident — both a re-entered password AND a typed "DELETE"
 * confirmation are required before the submit button is even enabled.
 */

const { isDeleteReady } = require('../../components/profile/DeleteAccountModal');

describe('isDeleteReady()', () => {
  test('password present + exact "DELETE" confirmation → ready', () => {
    expect(isDeleteReady('hunter2', 'DELETE')).toBe(true);
  });

  test('password missing (empty string) → not ready, even with correct confirmation text', () => {
    expect(isDeleteReady('', 'DELETE')).toBe(false);
  });

  test('confirmation text missing (empty string) → not ready, even with a real password', () => {
    expect(isDeleteReady('hunter2', '')).toBe(false);
  });

  test('confirmation text wrong case ("delete") → not ready — exact, case-sensitive match required', () => {
    expect(isDeleteReady('hunter2', 'delete')).toBe(false);
  });

  test('confirmation text with extra whitespace ("DELETE ") → not ready — no trimming applied', () => {
    expect(isDeleteReady('hunter2', 'DELETE ')).toBe(false);
  });

  test('confirmation text is a substring/superstring of DELETE ("DELET", "DELETED") → not ready', () => {
    expect(isDeleteReady('hunter2', 'DELET')).toBe(false);
    expect(isDeleteReady('hunter2', 'DELETED')).toBe(false);
  });

  test('both missing → not ready', () => {
    expect(isDeleteReady('', '')).toBe(false);
  });

  test('password is falsy but non-empty-string (undefined/null) → not ready, does not throw', () => {
    expect(isDeleteReady(undefined, 'DELETE')).toBe(false);
    expect(isDeleteReady(null, 'DELETE')).toBe(false);
  });
});
