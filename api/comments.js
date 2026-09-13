// api/comments.js
// Haber yorumlarını herkese görünecek şekilde kalıcı olarak saklar (Vercel Blob).
// GET  /api/comments?link=<haber linki>   -> o habere ait yorumları döner
// POST /api/comments  { link, name, text } -> yeni yorum ekler (herkes yazabilir)

const { readJson, writeJson } = require('./_store');

function commentsPath(link) {
  return 'comments/' + encodeURIComponent(link) + '.json';
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const { link } = req.query || {};
      if (!link || typeof link !== 'string') {
        res.status(400).json({ error: 'link parametresi gerekli.' });
        return;
      }
      const list = await readJson(commentsPath(link), []);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ comments: list });
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
      const comment = {
        name: name.trim().slice(0, 60),
        text: text.trim().slice(0, 2000),
        ts: Date.now(),
      };
      const path = commentsPath(link);
      const list = await readJson(path, []);
      list.push(comment);
      // Liste sınırsız büyümesin.
      const trimmed = list.length > 500 ? list.slice(list.length - 500) : list;
      await writeJson(path, trimmed);
      res.status(200).json({ ok: true, comment });
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
