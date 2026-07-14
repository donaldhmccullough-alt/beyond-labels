'use strict';

/**
 * __tests__/components/AccountPendingDeletionModal.test.js
 *
 * Direct unit tests of formatScheduledDate(), exported from
 * AccountPendingDeletionModal.jsx — same no-rendering-infra reasoning as
 * DeleteAccountModal.jsx/isDeleteReady.
 */

const { formatScheduledDate } = require('../../components/shared/AccountPendingDeletionModal');

describe('formatScheduledDate()', () => {
  test('a valid ISO timestamp formats as a human-readable long date', () => {
    expect(formatScheduledDate('2026-07-28T00:00:00.000Z')).toBe('July 28, 2026');
  });

  test('null → empty string, not "Invalid Date"', () => {
    expect(formatScheduledDate(null)).toBe('');
  });

  test('undefined → empty string', () => {
    expect(formatScheduledDate(undefined)).toBe('');
  });

  test('empty string → empty string', () => {
    expect(formatScheduledDate('')).toBe('');
  });

  test('a garbage, unparseable string → empty string, not "Invalid Date"', () => {
    expect(formatScheduledDate('not-a-date')).toBe('');
  });
});
