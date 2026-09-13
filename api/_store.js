// api/_store.js
// Yorumları ve admin panelinden eklenen haberleri Vercel'in KENDİ depolama
// servisi olan Vercel Blob üzerinde saklar. Upstash/Redis gibi ayrı bir yere
// üye olmaya gerek yok — hepsi Vercel proje panelinin içinden yapılıyor.
//
// KURULUM (tek seferlik, Vercel panelinde):
// 1) Projenin Vercel sayfasında "Storage" sekmesine gir.
// 2) "Create Database" (veya "Connect Store") -> "Blob" seç -> bir isim ver -> oluştur.
// 3) Açılan ekranda bu Blob deposunu projene bağla ("Connect Project").
//    Bu adımda BLOB_READ_WRITE_TOKEN ortam değişkeni otomatik olarak
//    Production + Preview ortamlarına eklenir; senin elle bir şey
//    kopyalamana gerek yok.
// 4) Projeyi yeniden deploy et (ya da otomatik tetiklenir).
//
// Bu değişken tanımlı olmadan (ör. henüz Blob bağlanmadıysa) yorumlar ve
// haberler kalıcı olmaz; API bu durumda anlaşılır bir hata döner.

const { put, get, list } = require('@vercel/blob');

function ensureConfigured() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('BLOB_NOT_CONFIGURED');
  }
}

async function streamToText(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

// pathname'de saklı JSON'u okur. Blob henüz hiç yazılmadıysa fallback döner.
// useCache:false ile CDN önbelleğini atlayıp her zaman en güncel veriyi okur.
async function readJson(pathname, fallback) {
  ensureConfigured();
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return fallback;
  try {
    return JSON.parse(await streamToText(result.stream));
  } catch (e) {
    return fallback;
  }
}

// pathname'e JSON'u tamamen üzerine yazar (aynı isimdeki blob'u değiştirir).
async function writeJson(pathname, data) {
  ensureConfigured();
  await put(pathname, JSON.stringify(data), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60, // Vercel Blob'un izin verdiği minimum süre
  });
}

// prefix ile başlayan tüm blob'ların pathname'lerini döner (ör. tüm yorum dosyaları).
async function listPathnames(prefix) {
  ensureConfigured();
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    for (const b of page.blobs) out.push(b.pathname);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

module.exports = { readJson, writeJson, listPathnames };
