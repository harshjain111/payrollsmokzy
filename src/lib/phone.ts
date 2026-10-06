/**
 * Login phone helpers.
 *
 * Accounts are created with a 10-digit Indian mobile number and signed in via
 * a pseudo-email derived from it. Browser/password-manager autofill often
 * supplies "+91 98765 43210" or "098765 43210", which used to become
 * "919876543210" and fail with "Invalid phone number or password".
 */

/** Keep digits only. */
export const digitsOnly = (value: string) => value.replace(/\D/g, '');

/**
 * Normalise a phone number to the 10-digit form used for logins:
 * strips non-digits, then drops a leading "91" country code (12 digits) or a
 * leading trunk "0" (11 digits). Anything else is returned as digits only.
 */
export const normalizePhone = (value: string) => {
  const digits = digitsOnly(value);
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
};

/** Pseudo-email used as the Supabase auth identifier for a phone login. */
export const phoneToEmail = (phone: string) => `${digitsOnly(phone)}@phone.smokzy.internal`;
