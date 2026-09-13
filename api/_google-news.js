// api/_google-news.js
// Google News RSS, gerçek habere düz bir HTTP 302 ile yönlendirmiyor — link
// (news.google.com/rss/articles/<base64>) Google'ın kendi "interstitial" sayfasına
// çıkıyor ve gerçek adres JavaScript ile çözülüyor. Bu modül, o sayfadaki gizli
// imza/zaman damgasını okuyup Google'ın dahili "batchexecute" uç noktasına sorup
// gerçek yayıncı adresini elde eden (yaygın bilinen, açık kaynak scraper'ların da
// kullandığı) yöntemi uygular. Google bunu değiştirirse bu fonksiyon null döner —
// o haber "kaynak çekilemedi" sayılıp elenir, site çökmez.

function getBase64FromLink(link) {
  try {
    const u = new URL(link);
    if (!u.hostname.endsWith('google.com')) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    const prev = parts[parts.length - 2];
    if ((prev === 'articles' || prev === 'read') && last) return last;
    return null;
  } catch (e) {
    return null;
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Google News linkindeki gerçek yayıncı adresini çözer. Başarısız olursa null döner.
async function resolveGoogleNewsLink(link, timeoutMs) {
  const base64Str = getBase64FromLink(link);
  if (!base64Str) return null;
  const perStepTimeout = Math.max(2500, Math.floor((timeoutMs || 9000) / 3));

  try {
    // 1) Interstitial sayfayı çek, imza (data-n-a-sg) ve zaman damgasını (data-n-a-ts) oku.
    const pageRes = await fetchWithTimeout(link, { headers: { 'User-Agent': UA } }, perStepTimeout);
    if (!pageRes.ok) return null;
    const html = await pageRes.text();

    const div = html.match(/<c-wiz[^>]*>\s*<div[^>]*data-n-a-sg="([^"]+)"[^>]*data-n-a-ts="([^"]+)"/)
      || html.match(/<c-wiz[^>]*>\s*<div[^>]*data-n-a-ts="([^"]+)"[^>]*data-n-a-sg="([^"]+)"/);
    if (!div) return null;

    let signature, timestamp;
    if (html.indexOf('data-n-a-sg="') < html.indexOf('data-n-a-ts="')) {
      signature = div[1]; timestamp = div[2];
    } else {
      timestamp = div[1]; signature = div[2];
    }
    if (!signature || !timestamp) return null;

    // 2) Google'ın dahili batchexecute uç noktasına sorup gerçek adresi al.
    const innerPayload = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${base64Str}",${timestamp},"${signature}"]`;
    const fReq = JSON.stringify([[["Fbv4je", innerPayload, null, "generic"]]]);

    const decodeRes = await fetchWithTimeout(
      'https://news.google.com/_/DotsSplashUi/data/batchexecute',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': UA,
        },
        body: 'f.req=' + encodeURIComponent(fReq),
      },
      perStepTimeout
    );
    if (!decodeRes.ok) return null;
    const text = await decodeRes.text();

    const chunks = text.split('\n\n');
    if (chunks.length < 2) return null;
    const parsedOuter = JSON.parse(chunks[1]);
    const trimmed = parsedOuter.slice(0, -2);
    const inner = JSON.parse(trimmed[0][2]);
    const decodedUrl = inner[1];
    if (typeof decodedUrl !== 'string' || !/^https?:\/\//.test(decodedUrl)) return null;
    return decodedUrl;
  } catch (e) {
    return null;
  }
}

module.exports = { resolveGoogleNewsLink };
