/**
 * ChoreMatrix Phone Normalization & Country Calling Code Utilities
 *
 * Requirements:
 * 1. Maintainable country/calling-code dataset with default: India (+91).
 * 2. Country calling-code selector + national phone-number input.
 * 3. Normalizes national number before submission (accepts spaces, hyphens, parentheses).
 * 4. Constructs international phone number (+<dialCode><nationalDigits>) only at submission time.
 * 5. Safely prevents/strips duplicate country codes (e.g. +91 entered into national field when +91 is selected).
 * 6. Preserves backend contract (10-15 digits E.164 without non-digits for gateway).
 */

export interface CountryCallingCode {
  code: string;       // ISO 3166-1 alpha-2 (e.g. 'IN')
  name: string;       // Display name (e.g. 'India')
  dialCode: string;   // Dial code with plus (e.g. '+91')
  digits: string;     // Dial code digits only (e.g. '91')
  placeholder: string;// Sample national number
  minNationalDigits: number;
  maxNationalDigits: number;
}

export const COUNTRIES: CountryCallingCode[] = [
  { code: 'IN', name: 'India', dialCode: '+91', digits: '91', placeholder: '7001240613', minNationalDigits: 10, maxNationalDigits: 10 },
  { code: 'US', name: 'United States', dialCode: '+1', digits: '1', placeholder: '2025550143', minNationalDigits: 10, maxNationalDigits: 10 },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44', digits: '44', placeholder: '7911123456', minNationalDigits: 9, maxNationalDigits: 10 },
  { code: 'CA', name: 'Canada', dialCode: '+1', digits: '1', placeholder: '4165550199', minNationalDigits: 10, maxNationalDigits: 10 },
  { code: 'AU', name: 'Australia', dialCode: '+61', digits: '61', placeholder: '412345678', minNationalDigits: 9, maxNationalDigits: 9 },
  { code: 'DE', name: 'Germany', dialCode: '+49', digits: '49', placeholder: '15123456789', minNationalDigits: 10, maxNationalDigits: 11 },
  { code: 'FR', name: 'France', dialCode: '+33', digits: '33', placeholder: '612345678', minNationalDigits: 9, maxNationalDigits: 9 },
  { code: 'SG', name: 'Singapore', dialCode: '+65', digits: '65', placeholder: '81234567', minNationalDigits: 8, maxNationalDigits: 8 },
  { code: 'AE', name: 'United Arab Emirates', dialCode: '+971', digits: '971', placeholder: '501234567', minNationalDigits: 9, maxNationalDigits: 9 },
  { code: 'NZ', name: 'New Zealand', dialCode: '+64', digits: '64', placeholder: '211234567', minNationalDigits: 8, maxNationalDigits: 10 },
  { code: 'JP', name: 'Japan', dialCode: '+81', digits: '81', placeholder: '9012345678', minNationalDigits: 10, maxNationalDigits: 10 },
  { code: 'BR', name: 'Brazil', dialCode: '+55', digits: '55', placeholder: '11987654321', minNationalDigits: 10, maxNationalDigits: 11 },
  { code: 'ZA', name: 'South Africa', dialCode: '+27', digits: '27', placeholder: '711234567', minNationalDigits: 9, maxNationalDigits: 9 },
  { code: 'IE', name: 'Ireland', dialCode: '+353', digits: '353', placeholder: '851234567', minNationalDigits: 9, maxNationalDigits: 9 }
];

export const DEFAULT_COUNTRY = COUNTRIES[0]; // India (+91)

/**
 * Resolves a CountryCallingCode definition by ISO code or dial code.
 */
export function getCountryByCode(codeOrDial?: string | null): CountryCallingCode {
  if (!codeOrDial) return DEFAULT_COUNTRY;
  const clean = codeOrDial.trim().toUpperCase();
  const cleanDial = clean.startsWith('+') ? clean : `+${clean.replace(/\D/g, '')}`;

  const found = COUNTRIES.find(
    c => c.code === clean || c.dialCode === cleanDial || c.digits === clean.replace(/\D/g, '')
  );
  return found || DEFAULT_COUNTRY;
}

export interface PhoneNormalizationResult {
  isValid: boolean;
  countryCode: string;       // e.g. '+91'
  nationalNumber: string;    // e.g. '7001240613'
  e164: string;              // e.g. '+917001240613'
  gatewayDigits: string;     // e.g. '917001240613' (clean digits for Cashfree customer_phone)
  error?: string;
}

/**
 * Normalizes user phone input:
 * - Accepts normal human formatting: spaces, hyphens, parentheses, leading plus.
 * - Safely strips duplicate country calling code if user accidentally enters it in the national field.
 * - Constructs the final E.164 phone number (+<dialCode><nationalDigits>).
 * - Validates length according to country rules and Cashfree 10-15 digit gateway limits.
 *
 * Example:
 *   Country: '+91'
 *   Input: '7001240613'
 *   Result: '+917001240613'
 *
 * Duplicate prevention:
 *   Country: '+91'
 *   Input: '+917001240613' or '+91 700-124-0613' or '917001240613'
 *   Result: '+917001240613' (NEVER +91+917001240613 or +91917001240613)
 */
export function normalizePhoneNumber(
  countryInput: string | CountryCallingCode,
  nationalInput: string | null | undefined
): PhoneNormalizationResult {
  const country = typeof countryInput === 'string' ? getCountryByCode(countryInput) : (countryInput || DEFAULT_COUNTRY);
  const raw = String(nationalInput || '').trim();

  if (!raw) {
    return {
      isValid: false,
      countryCode: country.dialCode,
      nationalNumber: '',
      e164: '',
      gatewayDigits: '',
      error: 'Please enter your mobile number.'
    };
  }

  // 1. Strip all leading pluses and clean non-digit characters
  let cleanDigits = raw.replace(/\D/g, '');

  if (!cleanDigits) {
    return {
      isValid: false,
      countryCode: country.dialCode,
      nationalNumber: '',
      e164: '',
      gatewayDigits: '',
      error: 'Mobile number must contain digits only.'
    };
  }

  // 2. Prevent duplicate country code:
  // If the user typed '+91...' or '91...', cleanDigits begins with country.digits (e.g. '91').
  // Check if stripping country.digits leaves a valid national number.
  if (cleanDigits.startsWith(country.digits)) {
    const withoutPrefix = cleanDigits.slice(country.digits.length);
    // If the remainder satisfies or is close to the expected national length, treat it as a duplicate prefix
    if (withoutPrefix.length >= country.minNationalDigits - 1) {
      cleanDigits = withoutPrefix;
    }
  }

  // 3. Strip optional single leading trunk '0' (e.g. 07001240613 -> 7001240613)
  if (cleanDigits.startsWith('0') && cleanDigits.length > country.minNationalDigits) {
    cleanDigits = cleanDigits.replace(/^0+/, '');
  }

  // 4. Validate national number length for selected country
  if (cleanDigits.length < country.minNationalDigits) {
    return {
      isValid: false,
      countryCode: country.dialCode,
      nationalNumber: cleanDigits,
      e164: `${country.dialCode}${cleanDigits}`,
      gatewayDigits: `${country.digits}${cleanDigits}`,
      error: `Mobile number is too short for ${country.name} (minimum ${country.minNationalDigits} digits required).`
    };
  }

  if (cleanDigits.length > country.maxNationalDigits + 3) {
    return {
      isValid: false,
      countryCode: country.dialCode,
      nationalNumber: cleanDigits,
      e164: `${country.dialCode}${cleanDigits}`,
      gatewayDigits: `${country.digits}${cleanDigits}`,
      error: `Mobile number is too long for ${country.name}.`
    };
  }

  // 5. Construct international E.164 and gateway digits
  const e164 = `${country.dialCode}${cleanDigits}`;
  const gatewayDigits = `${country.digits}${cleanDigits}`;

  // 6. Cashfree gateway requires total digits between 10 and 15
  if (gatewayDigits.length < 10 || gatewayDigits.length > 15) {
    return {
      isValid: false,
      countryCode: country.dialCode,
      nationalNumber: cleanDigits,
      e164,
      gatewayDigits,
      error: 'International mobile number must be between 10 and 15 digits for mandate authorization.'
    };
  }

  return {
    isValid: true,
    countryCode: country.dialCode,
    nationalNumber: cleanDigits,
    e164,
    gatewayDigits
  };
}
