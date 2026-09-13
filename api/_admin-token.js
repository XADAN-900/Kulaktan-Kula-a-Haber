// api/_admin-token.js
// Admin girişinden sonra verilen, imzalı ve süresi dolan bir token üretir/doğrular.
// Sunucu hiçbir oturumu hafızada tutmaz (serverless), bu yüzden token'ın kendisi
// imza + son kullanma tarihini taşır (JWT'ye benzer, minimal bir yaklaşım).

const crypto = require('crypto');

function secret() {
  // ADMIN_TOKEN_SECRET tanımlıysa onu, yoksa ADMIN_PASS'i imzalama anahtarı olarak kullan.
  return process.env.ADMIN_TOKEN_SECRET || process.env.ADMIN_PASS || 'admin123';
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function issueAdminToken(username, ttlMs = 12 * 60 * 60 * 1000) {
  const payload = base64url(JSON.stringify({ u: username, exp: Date.now() + ttlMs }));
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyAdminToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  } catch (e) {
    return false;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof data.exp === 'number' && data.exp > Date.now();
  } catch (e) {
    return false;
  }
}

function getBearerToken(req) {
  const header = req.headers && req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return '';
  return header.slice(7).trim();
}

module.exports = { issueAdminToken, verifyAdminToken, getBearerToken };
