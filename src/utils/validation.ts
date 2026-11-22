export interface CustomerFormInput {
  customerName: string;
  customerEmail: string;
  countryCode: string;
  customerPhone: string;
}

export function validateCustomerDetails(input: CustomerFormInput): Record<string, string> {
  const errors: Record<string, string> = {};
  const nameTrimmed = input.customerName.trim();
  const emailTrimmed = input.customerEmail.trim();
  const phoneDigits = input.customerPhone.replace(/[^\d]/g, '');

  if (nameTrimmed.length < 2 || nameTrimmed.length > 80) {
    errors.customerName = 'Customer full name is required (2 to 80 characters).';
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed) || emailTrimmed.length > 120) {
    errors.customerEmail = 'Please enter a valid email address.';
  }

  if (input.countryCode === '+92') {
    let local = phoneDigits;
    if (local.startsWith('92') && local.length === 12) local = local.slice(2);
    else if (local.startsWith('0') && local.length === 11) local = local.slice(1);
    if (!/^3\d{9}$/.test(local)) {
      errors.customerPhone =
        'Enter a valid Pakistani mobile number (e.g., 300 1234567 or 0300 1234567).';
    }
  } else if (phoneDigits.length < 7 || phoneDigits.length > 15) {
    errors.customerPhone = 'Enter a valid mobile number (7 to 15 digits).';
  }

  return errors;
}

export function validateInquiryForm(name: string, phone: string, message: string): string | null {
  if (name.trim().length < 2) {
    return 'Please enter your full name.';
  }
  if (!/^[+\d\s()-]{7,20}$/.test(phone.trim())) {
    return 'Please enter a valid phone or WhatsApp number.';
  }
  if (message.trim().length < 5) {
    return 'Please enter a short message about your inquiry.';
  }
  return null;
}
