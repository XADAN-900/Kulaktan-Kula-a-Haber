// api/news.js
// Admin panelinden eklenen haberleri herkese görünecek şekilde kalıcı olarak saklar.
// GET    /api/news                    -> herkes okuyabilir, tüm manuel haberleri döner
// POST   /api/news   {...haber}       -> sadece admin, yeni haber ekler (Authorization: Bearer <token>)
// PUT    /api/news   {id, ...haber}   -> sadece admin, var olan haberi düzenler
// DELETE /api/news?id=...             -> sadece admin, haberi siler

const { readJson, writeJson } = require('./_store');
const { verifyAdminToken, getBearerToken } = require('./_admin-token');

const NEWS_PATH = 'manual-news.json';

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const list = await readJson(NEWS_PATH, []);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ news: list });
      return;
    }

    // POST ve DELETE sadece admin için.
    if (!verifyAdminToken(getBearerToken(req))) {
      res.status(401).json({ error: 'Yetkisiz. Lütfen tekrar giriş yap.' });
      return;
    }

    if (req.method === 'POST') {
      const { cat, title, dek, image, author, link } = req.body || {};
      if (!title || !String(title).trim() || !dek || !String(dek).trim()) {
        res.status(400).json({ error: 'Başlık ve özet alanları zorunlu.' });
        return;
      }
      const item = {
        id: 'manuel-' + Date.now(),
        cat: cat || 'gundem',
        title: String(title).trim().slice(0, 200),
        dek: String(dek).trim().slice(0, 600),
        image: image ? String(image).trim() : null,
        author: (author && String(author).trim()) || 'Yönetici',
        link: (link && String(link).trim()) || '#',
        pubDate: new Date().toISOString(),
      };
      const list = await readJson(NEWS_PATH, []);
      list.unshift(item);
      await writeJson(NEWS_PATH, list);
      res.status(200).json({ ok: true, item });
      return;
    }

    if (req.method === 'PUT') {
      const { id, cat, title, dek, image, author, link } = req.body || {};
      if (!id) {
        res.status(400).json({ error: 'id alanı zorunlu.' });
        return;
      }
      if (!title || !String(title).trim() || !dek || !String(dek).trim()) {
        res.status(400).json({ error: 'Başlık ve özet alanları zorunlu.' });
        return;
      }
      const list = await readJson(NEWS_PATH, []);
      const idx = list.findIndex((n) => n.id === id);
      if (idx === -1) {
        res.status(404).json({ error: 'Haber bulunamadı.' });
        return;
      }
      list[idx] = {
        ...list[idx],
        cat: cat || list[idx].cat,
        title: String(title).trim().slice(0, 200),
        dek: String(dek).trim().slice(0, 600),
        image: image ? String(image).trim() : null,
        author: (author && String(author).trim()) || list[idx].author,
        link: (link && String(link).trim()) || list[idx].link,
      };
      await writeJson(NEWS_PATH, list);
      res.status(200).json({ ok: true, item: list[idx] });
      return;
    }

    if (req.method === 'DELETE') {
      const { id } = req.query || {};
      if (!id) {
        res.status(400).json({ error: 'id parametresi gerekli.' });
        return;
      }
      const list = await readJson(NEWS_PATH, []);
      const next = list.filter((n) => n.id !== id);
      await writeJson(NEWS_PATH, next);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Desteklenmeyen metod.' });
  } catch (err) {
    console.error('news api hatası:', err);
    if (err.message === 'BLOB_NOT_CONFIGURED') {
      res.status(500).json({ error: 'Sunucu depolaması henüz bağlanmamış. Vercel > Storage kısmından bir Blob deposu oluşturup projeye bağlaman gerekiyor.' });
      return;
    }
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
};
