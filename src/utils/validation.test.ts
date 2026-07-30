import {
  validateVisitorName,
  validateEmail,
  validateMessageContent,
} from './validation';

describe('validateVisitorName', () => {
  it('should return valid for a normal name', () => {
    expect(validateVisitorName('John Doe')).toEqual({ valid: true });
  });

  it('should return valid for a name with leading/trailing whitespace (trimmed)', () => {
    expect(validateVisitorName('  Alice  ')).toEqual({ valid: true });
  });

  it('should return invalid for empty string', () => {
    expect(validateVisitorName('')).toEqual({
      valid: false,
      error: 'Name is required',
    });
  });

  it('should return invalid for whitespace-only string', () => {
    expect(validateVisitorName('   ')).toEqual({
      valid: false,
      error: 'Name is required',
    });
  });

  it('should return invalid for tabs and newlines only', () => {
    expect(validateVisitorName('\t\n')).toEqual({
      valid: false,
      error: 'Name is required',
    });
  });

  it('should return valid for exactly 50 characters after trim', () => {
    const name = 'a'.repeat(50);
    expect(validateVisitorName(name)).toEqual({ valid: true });
  });

  it('should return invalid for 51 characters after trim', () => {
    const name = 'a'.repeat(51);
    expect(validateVisitorName(name)).toEqual({
      valid: false,
      error: 'Name must be 50 characters or less',
    });
  });

  it('should return valid for single character name', () => {
    expect(validateVisitorName('A')).toEqual({ valid: true });
  });
});

describe('validateEmail', () => {
  it('should return valid for a standard email', () => {
    expect(validateEmail('user@example.com')).toEqual({ valid: true });
  });

  it('should return valid for email with subdomain', () => {
    expect(validateEmail('user@mail.example.com')).toEqual({ valid: true });
  });

  it('should return invalid for empty string', () => {
    expect(validateEmail('')).toEqual({
      valid: false,
      error: 'Invalid email format',
    });
  });

  it('should return invalid for missing @', () => {
    expect(validateEmail('userexample.com')).toEqual({
      valid: false,
      error: 'Invalid email format',
    });
  });

  it('should return invalid for missing domain', () => {
    expect(validateEmail('user@')).toEqual({
      valid: false,
      error: 'Invalid email format',
    });
  });

  it('should return invalid for missing local part', () => {
    expect(validateEmail('@example.com')).toEqual({
      valid: false,
      error: 'Invalid email format',
    });
  });

  it('should return invalid for TLD less than 2 chars', () => {
    expect(validateEmail('user@example.c')).toEqual({
      valid: false,
      error: 'Invalid email format',
    });
  });

  it('should return valid for TLD with exactly 2 chars', () => {
    expect(validateEmail('user@example.co')).toEqual({ valid: true });
  });

  it('should return invalid for email with spaces', () => {
    expect(validateEmail('user @example.com')).toEqual({
      valid: false,
      error: 'Invalid email format',
    });
  });
});

describe('validateMessageContent', () => {
  it('should return valid for normal content within limit', () => {
    expect(validateMessageContent('Hello!', 2000)).toEqual({ valid: true });
  });

  it('should return invalid for empty content', () => {
    expect(validateMessageContent('', 2000)).toEqual({
      valid: false,
      error: 'Message content is required',
    });
  });

  it('should return valid for content at exactly maxLength', () => {
    const content = 'x'.repeat(2000);
    expect(validateMessageContent(content, 2000)).toEqual({ valid: true });
  });

  it('should return invalid for content exceeding maxLength', () => {
    const content = 'x'.repeat(2001);
    expect(validateMessageContent(content, 2000)).toEqual({
      valid: false,
      error: 'Message must be 2000 characters or less',
    });
  });

  it('should respect custom maxLength', () => {
    const content = 'x'.repeat(1001);
    expect(validateMessageContent(content, 1000)).toEqual({
      valid: false,
      error: 'Message must be 1000 characters or less',
    });
  });

  it('should return valid for single character content', () => {
    expect(validateMessageContent('a', 2000)).toEqual({ valid: true });
  });
});
