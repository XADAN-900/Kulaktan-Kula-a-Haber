// api/comments.js
// Haber yorumlarını herkese görünecek şekilde kalıcı olarak saklar (Vercel Blob).
// GET    /api/comments?link=<haber linki>              -> o habere ait yorumları döner (herkese açık, ownerToken içermez)
// GET    /api/comments                      (admin)    -> tüm haberlerdeki tüm yorumları döner (moderasyon için)
// POST   /api/comments  { link, name, text }            -> yeni yorum ekler (herkes yazabilir), cevapta bir kerelik ownerToken döner
// PUT    /api/comments  { link, id, text, ownerToken }   -> yorumu YAZAN kişi kendi tarayıcısında sakladığı token ile düzenler
// PUT    /api/comments  { link, id, text }  (admin)      -> admin, Authorization: Bearer <token> ile herhangi bir yorumu düzenler
// DELETE /api/comments?link=...&id=...&ownerToken=...   -> yorumu YAZAN kişi kendi tarayıcısında sakladığı token ile siler
// DELETE /api/comments?link=...&id=...      (admin)     -> admin, Authorization: Bearer <token> ile herhangi bir yorumu siler
// DELETE /api/comments?link=...&all=true    (admin)     -> admin, bir habere ait TÜM yorumları tek seferde siler

const crypto = require('crypto');
const { readJson, writeJson, listPathnames } = require('./_store');
const { verifyAdminToken, getBearerToken } = require('./_admin-token');

const PREFIX = 'comments/';

function commentsPath(link) {
  return PREFIX + encodeURIComponent(link) + '.json';
}
function linkFromPath(pathname) {
  const inner = pathname.slice(PREFIX.length, -'.json'.length);
  try { return decodeURIComponent(inner); } catch (e) { return inner; }
}
function makeId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}
function makeOwnerToken() {
  return crypto.randomBytes(16).toString('base64url');
}
function hashOwnerToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
// Herkese açık cevaplarda ownerHash asla dışarı sızmasın.
function publicComment(c) {
  const { ownerHash, ...rest } = c;
  return rest;
}
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
// Bir yorum üzerinde işlem yapma yetkisi var mı? Admin her zaman yetkili;
// admin değilse doğru ownerToken şart.
function canModify(comment, isAdmin, ownerToken) {
  if (isAdmin) return true;
  return !!ownerToken && typeof ownerToken === 'string' &&
    safeEqual(hashOwnerToken(ownerToken), comment.ownerHash || '');
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const { link } = req.query || {};

      if (link && typeof link === 'string') {
        // Herkese açık: tek bir habere ait yorumlar. ownerHash asla dışarı verilmez.
        const list = await readJson(commentsPath(link), []);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({ comments: list.map(publicComment) });
        return;
      }

      // link verilmediyse: sadece admin, tüm yorumları moderasyon için görebilir.
      if (!verifyAdminToken(getBearerToken(req))) {
        res.status(401).json({ error: 'Yetkisiz. Lütfen tekrar giriş yap.' });
        return;
      }
      const pathnames = await listPathnames(PREFIX);
      const all = [];
      for (const pathname of pathnames) {
        const link2 = linkFromPath(pathname);
        const items = await readJson(pathname, []);
        for (const c of items) all.push({ ...publicComment(c), link: link2 });
      }
      all.sort((a, b) => b.ts - a.ts);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ comments: all });
      return;
    }

    if (req.method === 'POST') {
      const { link, name, text } = req.body || {};
      if (!link || typeof link !== 'string' ||
          !name || typeof name !== 'string' || !name.trim() ||
          !text || typeof text !== 'string' || !text.trim()) {
        res.status(400).json({ error: 'link, name ve text alanları zorunlu.' });
        return;
      }
      const ownerToken = makeOwnerToken();
      const comment = {
        id: makeId(),
        name: name.trim().slice(0, 60),
        text: text.trim().slice(0, 2000),
        ts: Date.now(),
        ownerHash: hashOwnerToken(ownerToken),
      };
      const path = commentsPath(link);
      const list = await readJson(path, []);
      list.push(comment);
      // Liste sınırsız büyümesin.
      const trimmed = list.length > 500 ? list.slice(list.length - 500) : list;
      await writeJson(path, trimmed);
      // ownerToken SADECE bu cevapta, bir kere döner. İstemci bunu localStorage'da
      // saklayıp ileride "kendi yorumunu sil" için kullanır; sunucu bunu bir daha göstermez.
      res.status(200).json({ ok: true, comment: publicComment(comment), ownerToken });
      return;
    }

    if (req.method === 'PUT') {
      const { link, id, text, ownerToken } = req.body || {};
      if (!link || typeof link !== 'string' || !id ||
          !text || typeof text !== 'string' || !text.trim()) {
        res.status(400).json({ error: 'link, id ve text alanları zorunlu.' });
        return;
      }
      const isAdmin = verifyAdminToken(getBearerToken(req));
      const path = commentsPath(link);
      const list = await readJson(path, []);
      const idx = list.findIndex((c) => c.id === id);
      if (idx === -1) {
        res.status(404).json({ error: 'Yorum bulunamadı.' });
        return;
      }
      if (!canModify(list[idx], isAdmin, ownerToken)) {
        res.status(401).json({ error: 'Bu yorumu düzenleme yetkin yok.' });
        return;
      }
      list[idx] = {
        ...list[idx],
        text: text.trim().slice(0, 2000),
        editedAt: Date.now(),
      };
      await writeJson(path, list);
      res.status(200).json({ ok: true, comment: publicComment(list[idx]) });
      return;
    }

    if (req.method === 'DELETE') {
      const { link, id, ownerToken, all } = req.query || {};
      if (!link) {
        res.status(400).json({ error: 'link parametresi gerekli.' });
        return;
      }
      const isAdmin = verifyAdminToken(getBearerToken(req));

      if (all === 'true') {
        // Bir habere ait tüm yorumları tek seferde temizle — sadece admin.
        if (!isAdmin) {
          res.status(401).json({ error: 'Yetkisiz. Lütfen tekrar giriş yap.' });
          return;
        }
        await writeJson(commentsPath(link), []);
        res.status(200).json({ ok: true });
        return;
      }

      if (!id) {
        res.status(400).json({ error: 'id parametresi gerekli.' });
        return;
      }
      const path = commentsPath(link);
      const list = await readJson(path, []);
      const target = list.find((c) => c.id === id);
      if (!target) {
        // Zaten yok / silinmiş sayılabilir.
        res.status(200).json({ ok: true });
        return;
      }
      if (!canModify(target, isAdmin, ownerToken)) {
        res.status(401).json({ error: 'Bu yorumu silme yetkin yok.' });
        return;
      }
      const next = list.filter((c) => c.id !== id);
      await writeJson(path, next);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Desteklenmeyen metod.' });
  } catch (err) {
    console.error('comments api hatası:', err);
    if (err.message === 'BLOB_NOT_CONFIGURED') {
      res.status(500).json({ error: 'Sunucu depolaması henüz bağlanmamış. Vercel > Storage kısmından bir Blob deposu oluşturup projeye bağlaman gerekiyor.' });
      return;
    }
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
};
