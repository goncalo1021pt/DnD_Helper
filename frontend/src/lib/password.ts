// Client-side password strength, purely advisory — the server enforces the
// real policy (length floor + a large common-password blocklist). This gives
// the registrant live feedback while they type.

const COMMON = new Set([
  "password",
  "password1",
  "password123",
  "123456789",
  "12345678",
  "1234567890",
  "qwerty",
  "qwerty123",
  "iloveyou",
  "abc123",
  "letmein",
  "admin",
  "welcome",
  "monkey",
  "dragon",
]);

export interface PwStrength {
  /** 0 empty · 1 rejected · 2 fair · 3 good · 4 strong */
  score: number;
  label: string;
  /** whether it would clear the client-side floor (advisory) */
  ok: boolean;
}

export function passwordStrength(pw: string, avoid: string[] = []): PwStrength {
  if (!pw) return { score: 0, label: "", ok: false };
  const lower = pw.toLowerCase();
  if (pw.length < 10) return { score: 1, label: "Too short — 10+ characters", ok: false };
  if (COMMON.has(lower)) return { score: 1, label: "Too common", ok: false };
  if (avoid.some((a) => a && lower === a.toLowerCase()))
    return { score: 1, label: "Don't reuse your name or email", ok: false };
  if (/^(.)\1+$/.test(pw)) return { score: 1, label: "Too simple", ok: false };

  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/[0-9]/.test(pw)) classes++;
  if (/[^a-zA-Z0-9]/.test(pw)) classes++;

  let score = 2;
  if (pw.length >= 14 && classes >= 2) score = 3;
  if (pw.length >= 16 && classes >= 3) score = 4;
  const label = score >= 4 ? "Strong" : score === 3 ? "Good" : "Fair";
  return { score, label, ok: true };
}
