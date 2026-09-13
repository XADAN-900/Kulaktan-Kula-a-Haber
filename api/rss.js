// api/rss.js
// RSS feed'i sunucu tarafında çeker (server-to-server istek CORS'a tabi değildir).
// Böylece rss2json/allorigins/codetabs gibi kararsız üçüncü parti proxy'lere ihtiyaç kalmaz.
// Kullanım: /api/rss?url=<encodeURIComponent(feed_url)>

const ALLOWED_HOSTS = ['news.google.com'];

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
    // Google News RSS bunları vermiyor; o durumda aşağıda kaynak sayfadan og:image çekilir.
    thumbnail:
      extractAttr(block, 'media:content', 'url') ||
      extractAttr(block, 'media:thumbnail', 'url') ||
      extractAttr(block, 'enclosure', 'url') ||
      '',
  })).filter((item) => item.title);
}

// Google News RSS öğelerinde görsel bulunmuyor. Kaynak makale sayfasını kısa bir
// süre limitiyle çekip og:image / twitter:image meta etiketinden görsel URL'si alıyoruz.
async function fetchOgImage(link) {
  if (!link) return '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const pageRes = await fetch(link, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KulaktanKulagaBot/1.0)' },
    });
    clearTimeout(timer);
    if (!pageRes.ok) return '';

    // Google News linkleri şifreli bir yönlendirmedir; sunucudan yapılan bu istek
    // (tarayıcıdaki gibi JS çalıştırmadığı için) gerçek kaynağa ulaşamayabilir ve
    // Google'ın kendi haber uygulaması sayfası/ikonu döner. Yönlendirme gerçek siteye
    // gitmediyse (hâlâ google.com'daysak) o görseli KULLANMA — yanlış/aynı logo olur.
    let finalHost = '';
    try { finalHost = new URL(pageRes.url).hostname; } catch (e) { /* yok say */ }
    if (finalHost.endsWith('google.com')) return '';

    const html = await pageRes.text();
    const m =
      html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i) ||
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    return m ? m[1] : '';
  } catch (e) {
    return '';
  }
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
    const items = parseRssItems(xml);
    if (items.length === 0) {
      res.status(502).json({ error: 'Feed boş döndü.' });
      return;
    }
    // Görseli feed'den gelmeyen haberler için kaynak sayfadan og:image dene (paralel, sınırlı süreli).
    await Promise.allSettled(
      items.slice(0, 18).map(async (item) => {
        if (!item.thumbnail) {
          item.thumbnail = await fetchOgImage(item.link);
        }
      })
    );
    // Tarayıcı kısa süre cache'lesin, gereksiz tekrar istekleri azalsın.
    res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=300');
    res.status(200).json({ items });
  } catch (err) {
    console.error('RSS fetch hatası:', err);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
};
