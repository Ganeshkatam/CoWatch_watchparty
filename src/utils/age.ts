/**
 * AGE-002: Deterministic Client-Side Age Calculation & Eligibility Utility
 *
 * Requirements:
 * - Calendar-date based, not millisecond approximation.
 * - Handles birthday boundaries correctly (eligible on 18th birthday; ineligible day before).
 * - Rejects invalid dates and impossible calendar dates.
 * - Rejects future dates.
 * - Handles leap-day birthdays deterministically.
 * - Does not depend on browser locale formatting.
 * - Zero server or database dependencies.
 */

export const MINIMUM_SIGNUP_AGE = 18;

export interface AgeValidationResult {
  valid: boolean;
  age?: number;
  isEligible: boolean;
  error?: string;
}

/**
 * Calculates a person's age from their date of birth relative to a reference date.
 * Strictly string-only: expects normalized 'YYYY-MM-DD' from <input type="date">.
 *
 * @param dateOfBirth - The user's birth date as a normalized 'YYYY-MM-DD' string.
 * @param referenceDate - The reference date (defaults to current date).
 * @returns AgeValidationResult with validity, calculated age, eligibility flag, and optional error message.
 */
export function calculateAge(
  dateOfBirth: string | null | undefined,
  referenceDate: Date = new Date()
): AgeValidationResult {
  if (!dateOfBirth || typeof dateOfBirth !== "string") {
    return {
      valid: false,
      isEligible: false,
      error: "Please enter your date of birth.",
    };
  }

  const trimmed = dateOfBirth.trim();
  if (!trimmed) {
    return {
      valid: false,
      isEligible: false,
      error: "Please enter your date of birth.",
    };
  }

  const parts = trimmed.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    return {
      valid: false,
      isEligible: false,
      error: "Invalid date of birth format. Please use YYYY-MM-DD.",
    };
  }

  const [birthYear, birthMonth, birthDay] = parts;

  // Check month range
  if (birthMonth < 1 || birthMonth > 12) {
    return {
      valid: false,
      isEligible: false,
      error: "Invalid calendar month in date of birth.",
    };
  }

  // Verify calendar day validity against month (e.g., prevent Feb 30 or Nov 31)
  const testDate = new Date(birthYear, birthMonth - 1, birthDay);
  if (
    testDate.getFullYear() !== birthYear ||
    testDate.getMonth() !== birthMonth - 1 ||
    testDate.getDate() !== birthDay
  ) {
    return {
      valid: false,
      isEligible: false,
      error: "Invalid calendar date.",
    };
  }

  // Reasonable year sanity check
  if (birthYear < 1900) {
    return {
      valid: false,
      isEligible: false,
      error: "Please enter a valid year of birth.",
    };
  }

  const refYear = referenceDate.getFullYear();
  const refMonth = referenceDate.getMonth() + 1; // 1-12
  const refDay = referenceDate.getDate();

  // Future date check
  if (
    birthYear > refYear ||
    (birthYear === refYear && birthMonth > refMonth) ||
    (birthYear === refYear && birthMonth === refMonth && birthDay > refDay)
  ) {
    return {
      valid: false,
      isEligible: false,
      error: "Date of birth cannot be in the future.",
    };
  }

  // Calendar-based age calculation
  let age = refYear - birthYear;
  const hasHadBirthdayThisYear =
    refMonth > birthMonth ||
    (refMonth === birthMonth && refDay >= birthDay);

  if (!hasHadBirthdayThisYear) {
    age -= 1;
  }

  if (age < 0) {
    return {
      valid: false,
      isEligible: false,
      error: "Date of birth cannot be in the future.",
    };
  }

  if (age < MINIMUM_SIGNUP_AGE) {
    return {
      valid: true,
      age,
      isEligible: false,
      error: `You must be at least ${MINIMUM_SIGNUP_AGE} years of age to create an account.`,
    };
  }

  return {
    valid: true,
    age,
    isEligible: true,
  };
}
