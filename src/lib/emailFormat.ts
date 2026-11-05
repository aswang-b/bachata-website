// The one check for "is this an email address?" on the server: no spaces or
// list separators, an @, a dot in the domain, and no longer than any real one.
export const MAX_EMAIL_LENGTH = 200;
const EMAIL_RE = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]+$/;

export const isEmailAddress = (value: string) => value.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(value);
