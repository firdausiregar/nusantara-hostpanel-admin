'use strict';

const MIN_PASSWORD_CHARS = 14;
const MAX_PASSWORD_BYTES = 72; // bcrypt input limit

function validatePassword(value) {
  const password = String(value || '');
  const bytes = Buffer.byteLength(password, 'utf8');
  if (Array.from(password).length < MIN_PASSWORD_CHARS) {
    throw new Error(`Password minimal ${MIN_PASSWORD_CHARS} karakter.`);
  }
  if (bytes > MAX_PASSWORD_BYTES) {
    throw new Error(`Password maksimal ${MAX_PASSWORD_BYTES} byte karena batas bcrypt.`);
  }
  if (/\u0000/.test(password)) throw new Error('Password mengandung karakter yang tidak didukung.');
  return password;
}

module.exports = { validatePassword, MIN_PASSWORD_CHARS, MAX_PASSWORD_BYTES };
