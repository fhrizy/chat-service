import * as fc from 'fast-check';
import {
  validateVisitorName,
  validateEmail,
  validateMessageContent,
} from '../../utils/validation';

/**
 * Feature: live-chat, Property 2: Whitespace-only name rejection
 * Validates: Requirements 2.3
 *
 * For any string composed entirely of whitespace characters (spaces, tabs, newlines),
 * submitting it as a visitor name SHALL be rejected with a validation error.
 */
describe('Feature: live-chat, Property 2: Whitespace-only name rejection', () => {
  it('should reject any whitespace-only string as a visitor name', () => {
    const whitespaceOnlyArb = fc
      .array(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 50 })
      .map((arr) => arr.join(''));

    fc.assert(
      fc.property(whitespaceOnlyArb, (whitespaceStr: string) => {
        const result = validateVisitorName(whitespaceStr);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: live-chat, Property 3: Email validation round-trip
 * Validates: Requirements 2.4
 *
 * For any string that does NOT match the pattern local@domain.tld
 * (where local is non-empty, domain is non-empty, and tld is at least 2 characters),
 * the email validation function SHALL return invalid.
 * For any string that DOES match this pattern, validation SHALL return valid.
 */
describe('Feature: live-chat, Property 3: Email validation round-trip', () => {
  it('should reject strings without @ symbol', () => {
    // Generate non-empty strings that do NOT contain '@'
    const noAtArb = fc
      .string({ minLength: 1, maxLength: 100 })
      .filter((s) => !s.includes('@'));

    fc.assert(
      fc.property(noAtArb, (invalidEmail: string) => {
        const result = validateEmail(invalidEmail);
        expect(result.valid).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('should reject strings with @ but missing proper domain.tld structure', () => {
    // Generate "local@domain" without a dot in the domain part
    const localPartArb = fc.stringMatching(/^[^\s@]+$/).filter((s) => s.length >= 1);
    const domainNoDotArb = fc.stringMatching(/^[^\s@.]+$/).filter((s) => s.length >= 1);

    const noDotTldArb = fc
      .tuple(localPartArb, domainNoDotArb)
      .map(([local, domain]) => `${local}@${domain}`);

    fc.assert(
      fc.property(noDotTldArb, (invalidEmail: string) => {
        const result = validateEmail(invalidEmail);
        expect(result.valid).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('should accept valid-pattern emails (non-empty local + @ + non-empty domain + . + tld >= 2 chars)', () => {
    // Generate valid emails: local@domain.tld
    const localPartArb = fc.stringMatching(/^[^\s@]+$/).filter((s) => s.length >= 1 && s.length <= 64);
    const domainPartArb = fc.stringMatching(/^[^\s@.]+$/).filter((s) => s.length >= 1 && s.length <= 63);
    const tldArb = fc.stringMatching(/^[^\s@.]+$/).filter((s) => s.length >= 2 && s.length <= 10);

    const validEmailArb = fc
      .tuple(localPartArb, domainPartArb, tldArb)
      .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

    fc.assert(
      fc.property(validEmailArb, (validEmail: string) => {
        const result = validateEmail(validEmail);
        expect(result.valid).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: live-chat, Property 7: Invalid message length rejection
 * Validates: Requirements 3.8
 *
 * For any string of length 0 (empty) or length greater than 2000 characters,
 * attempting to send it as a visitor message SHALL be rejected with a validation error.
 */
describe('Feature: live-chat, Property 7: Invalid message length rejection', () => {
  it('should reject empty string as message content', () => {
    const result = validateMessageContent('', 2000);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should reject any string longer than 2000 characters', () => {
    // Generate strings with length > 2000
    const longStringArb = fc.string({ minLength: 2001, maxLength: 5000 });

    fc.assert(
      fc.property(longStringArb, (longStr: string) => {
        const result = validateMessageContent(longStr, 2000);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      }),
      { numRuns: 100 }
    );
  });
});
