// api/summarize.js
// Vercel bu dosyayı otomatik olarak /api/summarize adresinde çalıştırır.
// GROQ_API_KEY, Vercel panelinden (Settings > Environment Variables) eklenir;
// kod içine YAZILMAZ, process.env üzerinden okunur.

// llama-3.3-70b-versatile Groq tarafından devre dışı bırakıldı (Ağustos 2026).
// Groq'un önerdiği güncel modellerden biri kullanılıyor; istenirse Vercel'de
// GROQ_MODEL ortam değişkeniyle başka bir modele geçilebilir.
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Sadece POST desteklenir.' });
    return;
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    console.error('GROQ_API_KEY tanımlı değil. Vercel > Settings > Environment Variables kısmından ekle.');
    res.status(500).json({ error: 'Sunucu yapılandırma hatası.' });
    return;
  }

  const { title, description } = req.body || {};
  if (!title || typeof title !== 'string') {
    res.status(400).json({ error: 'title alanı zorunlu.' });
    return;
  }

  const safeTitle = title.slice(0, 400);
  const safeDescription = (description || '').slice(0, 1500);

  const prompt = `Aşağıda bir haberin başlığı ve RSS kaynağından gelen kısa açıklaması var. Bunlara dayanarak, SADECE verilen bilgiyi kullanarak (uydurma detay, sayı veya isim EKLEME), 2-3 kısa paragraflık akıcı bir haber özeti yaz. Kaynak metni birebir kopyalama, kendi cümlelerinle anlat. Türkçe yaz, gazetecilik diliyle ama sade.

Başlık: ${safeTitle}
Açıklama: ${safeDescription}

Sadece özeti yaz, başka açıklama ekleme.`;

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 900,
        temperature: 0.5,
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text().catch(() => '');
      console.error('Groq API hatası:', groqRes.status, errText);
      res.status(502).json({ error: 'Özet servisi şu anda yanıt vermiyor.' });
      return;
    }

    const data = await groqRes.json();
    let summary = data.choices?.[0]?.message?.content?.trim();
    if (!summary) {
      res.status(502).json({ error: 'Özet üretilemedi.' });
      return;
    }

    // Token limiti yüzünden cümle ortasında kesildiyse, yarım cümleyi göstermek yerine
    // son tam biten cümleye kadar kısalt (temiz görünsün).
    const finishReason = data.choices?.[0]?.finish_reason;
    if (finishReason === 'length') {
      const lastSentenceEnd = Math.max(
        summary.lastIndexOf('.'),
        summary.lastIndexOf('!'),
        summary.lastIndexOf('?')
      );
      if (lastSentenceEnd > 40) {
        summary = summary.slice(0, lastSentenceEnd + 1).trim();
      }
    }

    res.status(200).json({ summary });
  } catch (err) {
    console.error('Beklenmeyen hata:', err);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
};
