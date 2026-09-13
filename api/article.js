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

function stripTagBlocks(html, tags) {
  let out = html;
  for (const tag of tags) {
    out = out.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
  }
  return out;
}

function decodeEntities(str) {
  return (str || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const JUNK_PATTERN = /^(paylaş|share|abone ol|üye ol|çerez|cookie|reklam|advertisement|yorum yap|etiketler|ilgili haberler|kaynak:|©|tüm hakları saklıdır)/i;

function extractParagraphs(html) {
  const clean = stripTagBlocks(html, ['script', 'style', 'noscript', 'header', 'footer', 'nav', 'aside', 'form', 'iframe', 'figure']);
  const matches = clean.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
  const paragraphs = [];
  const seen = new Set();
  for (const m of matches) {
    let text = m.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    text = decodeEntities(text);
    if (text.length < 40) continue; // menü/etiket gibi kısa parçaları ele
    if (JUNK_PATTERN.test(text)) continue;
    if (seen.has(text)) continue; // aynı paragraf birden fazla yerde tekrar etmesin
    seen.add(text);
    paragraphs.push(text);
  }
  return paragraphs;
}

function extractMeta(html, prop) {
  const m =
    html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i')) ||
    html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${prop}["']`, 'i'));
  return m ? decodeEntities(m[1]) : '';
}

// Sunucudan (SSRF'e karşı) yerel/özel ağ adreslerine istek atılmasını engelle.
function isBlockedHostname(hostname) {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1') return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  return false;
}

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

  let parsed;
  try {
    parsed = new URL(link);
  } catch (e) {
    res.status(400).json({ error: 'Geçersiz link.' });
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    res.status(400).json({ error: 'Geçersiz protokol.' });
    return;
  }
  if (isBlockedHostname(parsed.hostname)) {
    res.status(403).json({ error: 'Bu adrese istek yapılamaz.' });
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const pageRes = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KulaktanKulagaBot/1.0)' },
    });
    clearTimeout(timer);
    if (!pageRes.ok) {
      res.status(502).json({ error: 'Kaynak sayfa şu anda yanıt vermiyor.' });
      return;
    }

    const finalUrl = pageRes.url || parsed.toString();
    let finalHost = '';
    try { finalHost = new URL(finalUrl).hostname.replace(/^www\./, ''); } catch (e) { /* yok say */ }

    const html = await pageRes.text();
    const paragraphs = extractParagraphs(html);
    if (paragraphs.length === 0) {
      res.status(502).json({ error: 'Haberin tam metni bu kaynaktan otomatik olarak çıkarılamadı.' });
      return;
    }

    const image =
      extractMeta(html, 'og:image:secure_url') ||
      extractMeta(html, 'og:image') ||
      extractMeta(html, 'twitter:image');
    const title = extractMeta(html, 'og:title');

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
    res.status(200).json({
      title: title || null,
      image: image || null,
      paragraphs: paragraphs.slice(0, 40),
      source: finalHost,
      sourceUrl: finalUrl,
    });
  } catch (err) {
    console.error('article fetch hatası:', err);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
};
