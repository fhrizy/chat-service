export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a visitor name.
 * Trims the name first, then checks length is between 1 and 50 characters.
 */
export function validateVisitorName(name: string): ValidationResult {
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return { valid: false, error: 'Name is required' };
  }

  if (trimmed.length > 50) {
    return { valid: false, error: 'Name must be 50 characters or less' };
  }

  return { valid: true };
}

/**
 * Validates an email address.
 * Checks against a standard email pattern: local@domain.tld
 * where local is non-empty, domain is non-empty, and tld is at least 2 chars.
 */
export function validateEmail(email: string): ValidationResult {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Invalid email format' };
  }

  return { valid: true };
}

/**
 * Validates message content.
 * Checks content length is between 1 and maxLength characters.
 */
export function validateMessageContent(
  content: string,
  maxLength: number
): ValidationResult {
  if (content.length === 0) {
    return { valid: false, error: 'Message content is required' };
  }

  if (content.length > maxLength) {
    return {
      valid: false,
      error: `Message must be ${maxLength} characters or less`,
    };
  }

  return { valid: true };
}
