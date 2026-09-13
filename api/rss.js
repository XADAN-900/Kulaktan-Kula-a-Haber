// api/rss.js
// RSS feed'i sunucu tarafında çeker (server-to-server istek CORS'a tabi değildir).
// Böylece rss2json/allorigins/codetabs gibi kararsız üçüncü parti proxy'lere ihtiyaç kalmaz.
// Kullanım: /api/rss?url=<encodeURIComponent(feed_url)>
//
// ÖNEMLİ: Google News RSS her öğe için sadece başlık/özet/link verir; gerçek habere
// yönlendiren link çoğu zaman şifreli bir Google yönlendirmesidir. Burada feed'deki
// HER öğenin kaynak sayfası sunucu tarafında ayrıca çekilip tam metin paragrafları
// çıkarılır (bkz. _extract.js). Kaynağı herhangi bir sebeple çekilemeyen
// (zaman aşımı, 404/500, yönlendirme gerçek siteye ulaşmadıysa, sayfadan metin
// çıkarılamadıysa vb.) haberler sonuçtan tamamen elenir — yarım/kaynaksız haber
// listeye hiç girmez.

const { fetchArticle } = require('./_extract');

const ALLOWED_HOSTS = ['news.google.com'];

// Doğrulama için tek bir öğeye ayrılan azami süre. Feed'deki öğeler paralel
// işlendiği için toplam süre bunun toplamı değil, en yavaş isteğin süresidir.
const PER_ITEM_TIMEOUT_MS = 6000;
// Feed'den en fazla kaç öğe doğrulanacak (bir kısmı kaynağı çekilemediği için
// elenebileceğinden, sunulacak habere yetecek kadar payla çekiyoruz).
const MAX_ITEMS_TO_CHECK = 30;

function unescapeXml(str) {
  return (str || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function extractTag(itemXml, tag) {
  const m = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1] : '';
}

function extractAttr(itemXml, tag, attr) {
  const m = itemXml.match(new RegExp(`<${tag}[^>]*\\b${attr}=["']([^"']+)["'][^>]*/?>`, 'i'));
  return m ? m[1] : '';
}

function parseRssItems(xml) {
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  return blocks.map((block) => ({
    title: unescapeXml(extractTag(block, 'title')),
    link: unescapeXml(extractTag(block, 'link')),
    pubDate: unescapeXml(extractTag(block, 'pubDate')),
    description: unescapeXml(extractTag(block, 'description')),
    author: '',
    // Bazı feed'ler görseli media:content / media:thumbnail / enclosure ile verir.
    // Google News RSS bunları vermiyor; o durumda kaynak sayfadan çekilen og:image kullanılır.
    thumbnail:
      extractAttr(block, 'media:content', 'url') ||
      extractAttr(block, 'media:thumbnail', 'url') ||
      extractAttr(block, 'enclosure', 'url') ||
      '',
  })).filter((item) => item.title);
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Sadece GET desteklenir.' });
    return;
  }

  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url parametresi gerekli.' });
    return;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    res.status(400).json({ error: 'Geçersiz url.' });
    return;
  }

  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    res.status(403).json({ error: 'Bu domain için istek yapılamaz.' });
    return;
  }

  try {
    const feedRes = await fetch(parsed.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KulaktanKulagaBot/1.0)' },
    });
    if (!feedRes.ok) {
      res.status(502).json({ error: 'Kaynak feed şu anda yanıt vermiyor.' });
      return;
    }
    const xml = await feedRes.text();
    const rawItems = parseRssItems(xml);
    if (rawItems.length === 0) {
      res.status(502).json({ error: 'Feed boş döndü.' });
      return;
    }

    // Her öğenin kaynağını paralel olarak çek ve doğrula; kaynağı çekilemeyenleri
    // (tam metin çıkarılamayan, zaman aşımına uğrayan, hataya düşen) tamamen ele.
    const candidates = rawItems.slice(0, MAX_ITEMS_TO_CHECK);
    const settled = await Promise.allSettled(
      candidates.map((item) => fetchArticle(item.link, PER_ITEM_TIMEOUT_MS))
    );

    const items = [];
    settled.forEach((result, idx) => {
      if (result.status !== 'fulfilled' || !result.value) return; // kaynak çekilemedi — atla
      const article = result.value;
      const item = candidates[idx];
      items.push({
        title: item.title,
        link: article.sourceUrl || item.link,
        pubDate: article.publishedDate || item.pubDate,
        description: item.description,
        author: article.author || '',
        thumbnail: item.thumbnail || article.image || '',
        // Kaynak sayfadan çekilen tam metin ve gerçek kaynak adı — istemci bunu
        // tekrar /api/article çağırmadan doğrudan kullanabilir.
        fullText: article.paragraphs,
        source: article.source,
      });
    });

    if (items.length === 0) {
      res.status(502).json({ error: 'Bu kategorideki haberlerin hiçbirinin kaynağı şu anda çekilemedi.' });
      return;
    }

    // Tarayıcı kısa süre cache'lesin, gereksiz tekrar istekleri azalsın.
    res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=300');
    res.status(200).json({ items });
  } catch (err) {
    console.error('RSS fetch hatası:', err);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
};
