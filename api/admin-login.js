// api/admin-login.js
// Yönetici girişini kontrol eder. Kullanıcı adı/şifre tarayıcıya asla gömülmez;
// Vercel > Settings > Environment Variables kısmından ADMIN_USER ve ADMIN_PASS
// olarak tanımla. Tanımlanmazsa (sadece test için) admin / admin123 kullanılır —
// CANLIYA ALMADAN ÖNCE MUTLAKA KENDİ DEĞERLERİNİ TANIMLA.
//
// Başarılı girişte imzalı bir token döner; bu token /api/news üzerinde haber
// ekleme/silme gibi yönetici işlemlerini yetkilendirmek için kullanılır.

const { issueAdminToken } = require('./_admin-token');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Sadece POST desteklenir.' });
    return;
  }

  const { username, password } = req.body || {};
  const ADMIN_USER = process.env.ADMIN_USER || 'admin';
  const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

  if (typeof username === 'string' && typeof password === 'string' &&
      username === ADMIN_USER && password === ADMIN_PASS) {
    res.status(200).json({ ok: true, token: issueAdminToken(username) });
  } else {
    res.status(401).json({ ok: false, error: 'Kullanıcı adı veya şifre hatalı.' });
  }
};
