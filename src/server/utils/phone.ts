export interface NormalizedPhoneResult {
  valid: boolean;
  formatted: string;
  error?: string;
}

export function normalizePhone(countryCode: string, rawPhone: string): NormalizedPhoneResult {
  const digits = rawPhone.replace(/[^\d]/g, '');
  if (countryCode === '+92') {
    let local = digits;
    if (local.startsWith('92') && local.length === 12) {
      local = local.slice(2);
    } else if (local.startsWith('0') && local.length === 11) {
      local = local.slice(1);
    }
    if (!/^3\d{9}$/.test(local)) {
      return {
        valid: false,
        formatted: '',
        error: 'Enter a valid Pakistani mobile number (e.g., 300 1234567 or 0300 1234567).',
      };
    }
    return {
      valid: true,
      formatted: `+92 ${local.slice(0, 3)} ${local.slice(3)}`,
    };
  }

  if (digits.length < 7 || digits.length > 15) {
    return {
      valid: false,
      formatted: '',
      error: 'Enter a valid phone number (7 to 15 digits).',
    };
  }
  return {
    valid: true,
    formatted: `${countryCode} ${digits}`,
  };
}
