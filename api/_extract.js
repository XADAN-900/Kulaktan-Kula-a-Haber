// api/_extract.js
// Kaynak haber sayfasını çekip ana metnini / görselini / meta bilgilerini çıkaran
// ortak yardımcı. Hem api/rss.js (liste aşamasında kaynağı doğrulamak için) hem de
// api/article.js (detay sayfasında tam metni göstermek için) bunu kullanır.
//
// Metin çıkarımı için Mozilla'nın Firefox Reader View'da kullandığı açık kaynak
// "Readability" kütüphanesi (@mozilla/readability + jsdom), görsel/başlık/yazar/tarih
// için ise açık kaynak "metascraper" kullanılıyor. İkisi de kendi sunucumuzda
// çalışıyor — üçüncü taraf bir servise istek atılmıyor, sadece çekilen HTML
// yerel olarak işleniyor.

const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const metascraper = require('metascraper')([
  require('metascraper-image')(),
  require('metascraper-title')(),
  require('metascraper-publisher')(),
  require('metascraper-date')(),
  require('metascraper-author')(),
]);

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

// Readability'nin temizlediği makale HTML'inden (junk menü/reklam zaten elenmiş
// durumda) paragrafları düz metin olarak çıkarır.
function paragraphsFromContent(contentHtml) {
  if (!contentHtml) return [];
  const matches = contentHtml.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
  const paragraphs = [];
  const seen = new Set();
  for (const m of matches) {
    let text = m.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    text = decodeEntities(text);
    if (text.length < 40) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    paragraphs.push(text);
  }
  return paragraphs;
}

// Sunucudan (SSRF'e karşı) yerel/özel ağ adreslerine istek atılmasını engelle.
function isBlockedHostname(hostname) {
  const h = (hostname || '').toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1') return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  return false;
}

// Bir haber linkini sunucu tarafında çeker, Readability ile ana metni ve
// metascraper ile görsel/başlık/yazar/tarih bilgisini çıkarır.
// Başarısız olursa (ağ hatası, zaman aşımı, SSRF engeli, makale metni
// bulunamaması, ya da Google News yönlendirmesinin gerçek kaynağa
// ulaşmaması) null döner — çağıran taraf bu durumda haberi "kaynak
// çekilemedi" sayıp göstermemeli.
async function fetchArticle(link, timeoutMs) {
  if (!link) return null;
  let parsed;
  try {
    parsed = new URL(link);
  } catch (e) {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (isBlockedHostname(parsed.hostname)) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 8000);
    const pageRes = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KulaktanKulagaBot/1.0)' },
    });
    clearTimeout(timer);
    if (!pageRes.ok) return null;

    const finalUrl = pageRes.url || parsed.toString();
    let finalHost = '';
    try { finalHost = new URL(finalUrl).hostname.replace(/^www\./, ''); } catch (e) { /* yok say */ }

    // Google News linki gerçek kaynağa yönlenmediyse (hâlâ google.com'daysak)
    // bu bir "kaynak" değildir — çekilemedi say.
    if (finalHost.endsWith('google.com')) return null;

    const html = await pageRes.text();

    let readabilityArticle = null;
    try {
      const dom = new JSDOM(html, { url: finalUrl });
      readabilityArticle = new Readability(dom.window.document).parse();
    } catch (e) {
      readabilityArticle = null; // parse edilemeyen/bozuk sayfa
    }

    const paragraphs = readabilityArticle ? paragraphsFromContent(readabilityArticle.content) : [];
    if (paragraphs.length === 0) return null; // ana metin çıkarılamadı — kaynak sayılmaz

    let meta = {};
    try {
      meta = await metascraper({ html, url: finalUrl });
    } catch (e) {
      meta = {};
    }

    return {
      title: (readabilityArticle && readabilityArticle.title) || meta.title || null,
      image: meta.image || null,
      paragraphs: paragraphs.slice(0, 60),
      source: (meta.publisher && String(meta.publisher).trim()) || finalHost,
      sourceUrl: finalUrl,
      author: meta.author || (readabilityArticle && readabilityArticle.byline) || null,
      publishedDate: meta.date || null,
    };
  } catch (e) {
    return null;
  }
}

module.exports = { fetchArticle, isBlockedHostname };
