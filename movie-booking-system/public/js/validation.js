/**
 * Browser-side mirror of config/validation.js.
 *
 * Gives instant feedback as the user types. The server runs the same rules
 * again and is the authority — this exists so nobody fills in a whole form
 * only to be told the password is too short.
 */

const DOMAIN_TYPOS = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com', 'gmaill.com': 'gmail.com', 'gnail.com': 'gmail.com',
  'gmail.cm': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.om': 'gmail.com',
  'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahoo.co': 'yahoo.com',
  'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmil.com': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com',
  'rediffmail.co': 'rediffmail.com', 'protonmai.com': 'protonmail.com',
};

const DISPOSABLE = new Set([
  'mailinator.com', 'tempmail.com', 'temp-mail.org', 'guerrillamail.com',
  '10minutemail.com', 'throwawaymail.com', 'yopmail.com', 'trashmail.com',
  'sharklasers.com', 'getnada.com', 'maildrop.cc', 'fakeinbox.com',
  'dispostable.com', 'mailnesia.com', 'tempinbox.com', 'emailondeck.com',
  'moakt.com', 'mohmal.com', 'harakirimail.com', 'spam4.me',
]);

const WEAK = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty123', 'qwertyuiop', 'abc12345', 'admin123', 'iloveyou', 'welcome1',
  'letmein1', 'football1', 'monkey123', 'sunshine1', 'princess1', 'passw0rd',
  'cinecloud', 'cinecloud1', 'movie123', 'booking123', 'test1234', 'asdf1234',
  'india123', 'krishna123', 'sairam123',
]);

const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}$/;

export function checkName(value) {
  const name = String(value || '').trim();
  if (!name) return { valid: false, error: 'Enter your name' };
  if (name.length < 2) return { valid: false, error: 'That name looks too short' };
  if (name.length > 60) return { valid: false, error: 'That name is too long' };
  if (!/[a-zA-Z]/.test(name)) return { valid: false, error: 'A name needs at least one letter' };
  return { valid: true };
}

export function checkEmail(value) {
  const email = String(value || '').trim().toLowerCase();

  if (!email) return { valid: false, error: 'Enter your email address' };
  if (!email.includes('@')) return { valid: false, error: 'An email address needs an @ sign' };
  if ((email.match(/@/g) || []).length > 1) {
    return { valid: false, error: 'An email address can only contain one @' };
  }

  const [local, domain] = email.split('@');
  if (!local) return { valid: false, error: 'Add the part before the @' };
  if (!domain) return { valid: false, error: 'Add the part after the @, e.g. gmail.com' };
  if (!domain.includes('.')) {
    return { valid: false, error: `"${domain}" is not a complete domain — did you mean ${domain}.com?` };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { valid: false, error: 'That does not look like a valid email address' };
  }
  if (DOMAIN_TYPOS[domain]) {
    return {
      valid: false,
      error: `Did you mean ${local}@${DOMAIN_TYPOS[domain]}?`,
      suggestion: `${local}@${DOMAIN_TYPOS[domain]}`,
    };
  }
  if (DISPOSABLE.has(domain)) {
    return { valid: false, error: 'Temporary email addresses are not accepted' };
  }
  return { valid: true, domain };
}

export function checkPassword(password, { email = '', name = '' } = {}) {
  const pw = String(password || '');
  const checks = {
    length: pw.length >= 8,
    letter: /[a-zA-Z]/.test(pw),
    number: /\d/.test(pw),
    symbol: /[^a-zA-Z0-9]/.test(pw),
    mixedCase: /[a-z]/.test(pw) && /[A-Z]/.test(pw),
  };

  let score = 0;
  if (checks.length) score++;
  if (pw.length >= 12) score++;
  if (checks.letter && checks.number) score++;
  if (checks.symbol) score++;
  if (checks.mixedCase) score++;
  score = Math.min(score, 4);

  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'];
  const base = { score, label: labels[score], checks };

  if (!pw) return { ...base, valid: false, error: 'Choose a password' };
  if (!checks.length) return { ...base, valid: false, error: 'Use at least 8 characters' };
  if (!checks.letter) return { ...base, valid: false, error: 'Include at least one letter' };
  if (!checks.number) return { ...base, valid: false, error: 'Include at least one number' };

  if (WEAK.has(pw.toLowerCase())) {
    return { ...base, valid: false, score: 0, label: labels[0], error: 'That password is too common' };
  }
  if (/^(.)\1+$/.test(pw)) {
    return { ...base, valid: false, score: 0, label: labels[0], error: 'A password cannot be one repeated character' };
  }
  if (/^(?:0123456789|1234567890|abcdefgh|qwertyui)/i.test(pw)) {
    return { ...base, valid: false, score: 0, label: labels[0], error: 'Avoid keyboard or number sequences' };
  }

  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && pw.toLowerCase().includes(local)) {
    return { ...base, valid: false, error: 'Your password should not contain your email address' };
  }
  const n = String(name).trim().toLowerCase();
  if (n.length >= 4 && pw.toLowerCase().includes(n)) {
    return { ...base, valid: false, error: 'Your password should not contain your name' };
  }

  return { ...base, valid: true };
}

/** Debounce, so the live email check doesn't fire on every keystroke. */
export function debounce(fn, ms = 500) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
