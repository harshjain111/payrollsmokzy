import { describe, expect, it } from 'vitest';
import { normalizePhone, phoneToEmail } from './phone';

describe('normalizePhone', () => {
  it('keeps a plain 10-digit number', () => {
    expect(normalizePhone('9876543210')).toBe('9876543210');
  });

  it('strips +91 country code and formatting from autofill', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('9876543210');
    expect(normalizePhone('919876543210')).toBe('9876543210');
  });

  it('strips a leading trunk zero', () => {
    expect(normalizePhone('098765 43210')).toBe('9876543210');
  });

  it('leaves other lengths as digits only', () => {
    expect(normalizePhone('12345')).toBe('12345');
    expect(normalizePhone('+1 (415) 555-0100')).toBe('14155550100');
  });
});

describe('phoneToEmail', () => {
  it('builds the pseudo-email from digits', () => {
    expect(phoneToEmail('98765-43210')).toBe('9876543210@phone.smokzy.internal');
  });
});
