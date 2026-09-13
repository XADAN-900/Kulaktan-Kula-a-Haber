// api/article.js
// Haber linkindeki SAYFAYI sunucu tarafında çekip ana metnini (paragrafları) çıkarır,
// böylece kullanıcı başka bir siteye yönlendirilmeden haberin tamamını bizim
// sayfamızda okuyabilir. Kullanım: /api/article?link=<encodeURIComponent(haber_linki)>
//
// ÖNEMLİ — TELİF/HUKUKİ UYARI:
// Bu uç nokta üçüncü taraf haber sitelerinin içeriğini olduğu gibi alıp kendi
// sitende gösterir. Birçok yayıncı bunu kullanım şartlarında açıkça yasaklar ve
// bu, telif hakkı ihlaline yol açabilir (özellikle kaynağa geri link/yönlendirme
// olmadan tam metin göstermek). Bunu canlıya almadan önce mutlaka kendi
// yayıncılarınla / bir hukukçuyla teyit et. Teknik olarak çalışsın diye
// yazıldı, hukuki riski ortadan kaldırmaz.

const { fetchArticle } = require('./_extract');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Sadece GET desteklenir.' });
    return;
  }

  const { link } = req.query || {};
  if (!link || typeof link !== 'string') {
    res.status(400).json({ error: 'link parametresi gerekli.' });
    return;
  }

  try {
    const data = await fetchArticle(link, 8000);
    if (!data) {
      res.status(502).json({ error: 'Haberin tam metni bu kaynaktan otomatik olarak çıkarılamadı.' });
      return;
    }
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
    res.status(200).json(data);
  } catch (err) {
    console.error('article fetch hatası:', err);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
};
