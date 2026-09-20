export const MIN_PASSWORD_LENGTH = 8;

export interface PasswordAssessment {
  /** 0 = unusable … 4 = strong */
  score: 0 | 1 | 2 | 3 | 4;
  label: "Too short" | "Weak" | "Fair" | "Good" | "Strong";
  ok: boolean;
  hints: string[];
}

const COMMON = new Set([
  "password",
  "12345678",
  "123456789",
  "qwertyui",
  "letmein1",
  "iloveyou",
  "admin123",
  "welcome1",
  "password1",
  "11111111",
]);

/**
 * Lightweight, offline password assessment. It never leaves the device and
 * is only a hint — the vault's security comes from the KDF, not from this.
 */
export function assessPassword(password: string): PasswordAssessment {
  const hints: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { score: 0, label: "Too short", ok: false, hints: [`Use at least ${MIN_PASSWORD_LENGTH} characters.`] };
  }
  if (COMMON.has(password.toLowerCase())) {
    return { score: 1, label: "Weak", ok: false, hints: ["This password is too common."] };
  }
  let variety = 0;
  if (/[a-z]/.test(password)) variety++;
  if (/[A-Z]/.test(password)) variety++;
  if (/\d/.test(password)) variety++;
  if (/[^A-Za-z0-9]/.test(password)) variety++;
  const unique = new Set(password).size;

  let score = 1;
  if (password.length >= 12) score++;
  if (variety >= 3) score++;
  if (password.length >= 16 && unique >= 8) score++;
  if (unique < 4) score = Math.min(score, 1);

  if (password.length < 12) hints.push("Longer passwords are stronger — aim for 12+ characters.");
  if (variety < 3) hints.push("Mix letters, numbers and symbols.");

  const clamped = Math.max(1, Math.min(4, score)) as 1 | 2 | 3 | 4;
  const label = (["Weak", "Fair", "Good", "Strong"] as const)[clamped - 1] ?? "Weak";
  return { score: clamped, label, ok: clamped >= 2, hints };
}
