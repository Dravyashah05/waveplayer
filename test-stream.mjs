import CryptoJS from 'crypto-js';

function decryptMediaUrl(encryptedMediaUrl) {
  if (!encryptedMediaUrl) return [];
  try {
    const key = CryptoJS.enc.Utf8.parse('38346591');
    const cipherParams = CryptoJS.lib.CipherParams.create({
      ciphertext: CryptoJS.enc.Base64.parse(encryptedMediaUrl),
    });
    const decrypted = CryptoJS.DES.decrypt(
      cipherParams,
      key,
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
    );
    const decryptedLink = decrypted.toString(CryptoJS.enc.Utf8);
    if (!decryptedLink || !decryptedLink.startsWith('http')) return [];

    const qualities = [
      { id: '_320', bitrate: 320, quality: '320kbps' },
      { id: '_160', bitrate: 160, quality: '160kbps' },
      { id: '_96', bitrate: 96, quality: '96kbps' },
      { id: '_48', bitrate: 48, quality: '48kbps' },
    ];

    return qualities.map((q) => ({
      quality: q.quality,
      bitrate: q.bitrate,
      url: decryptedLink.replace('_96', q.id),
    }));
  } catch (err) {
    return [];
  }
}

function cleanTitle(raw) {
  return raw
    .replace(/\s*[\(\[](official\s*(music\s*)?(video|audio|lyric\s*video|visualizer|video\s*hd)|audio|lyrics|music video|m\/?v|mv|hd|4k|remastered|prod\.[^\)\]]+|ft\.[^\)\]]+|feat\.[^\)\]]+)[\)\]]/gi, '')
    .replace(/\b(official\s*(music\s*)?(video|audio)|m\/?v|mv|hd|4k|remastered|lyrics?|visualizer)\b/gi, '')
    .replace(/\s*-\s*topic/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSimple(str) {
  return str
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveVideo(videoId) {
  try {
    const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (!oembedRes.ok) return null;
    const oembed = await oembedRes.json();
    const rawTitle = oembed.title || '';
    const rawAuthor = oembed.author_name || '';

    // Handle "Artist - Title" format in video titles
    let searchTitle = rawTitle;
    let searchArtist = rawAuthor;
    if (rawTitle.includes(' - ')) {
      const parts = rawTitle.split(' - ');
      searchArtist = parts[0];
      searchTitle = parts.slice(1).join(' - ');
    }

    const cleanedTitle = cleanTitle(searchTitle);
    const cleanedArtist = cleanTitle(searchArtist);

    const queries = [
      `${cleanedTitle} ${cleanedArtist}`.trim(),
      cleanedTitle,
      rawTitle.replace(/\s*[\(\[].*?[\)\]]/g, '').trim(),
    ];

    const targetTitleNorm = normalizeSimple(cleanedTitle);

    for (const q of queries) {
      if (!q) continue;
      const res = await fetch(`https://www.jiosaavn.com/api.php?__call=search.getResults&q=${encodeURIComponent(q)}&p=1&n=8&_format=json&_marker=0&api_version=4&ctx=web6dot0`);
      if (!res.ok) continue;
      const data = await res.json();
      const results = data.results || [];

      for (const r of results) {
        const rTitleNorm = normalizeSimple(r.title || r.song || '');
        const titleMatch = rTitleNorm.includes(targetTitleNorm) ||
          targetTitleNorm.includes(rTitleNorm) ||
          targetTitleNorm.split(' ').filter(w => w.length > 3 && rTitleNorm.includes(w)).length >= 1;

        if (titleMatch) {
          const songRes = await fetch(`https://www.jiosaavn.com/api.php?__call=song.getDetails&pids=${r.id}&_format=json&_marker=0&api_version=4&ctx=web6dot0`);
          const songData = await songRes.json();
          const songObj = songData[r.id] || songData?.songs?.[0];
          const encUrl = songObj?.more_info?.encrypted_media_url || songObj?.encrypted_media_url;
          if (encUrl) {
            const streams = decryptMediaUrl(encUrl);
            const bestStream = streams.find(s => s.quality === '320kbps') || streams[0];
            if (bestStream?.url) {
              return {
                videoId,
                streamUrl: bestStream.url,
                mimeType: 'audio/mp4; codecs="mp4a.40.2"',
                bitrate: bestStream.bitrate * 1000,
                title: oembed.title,
                matchedTitle: r.title,
                source: 'saavn',
              };
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('Error resolving:', e.message);
  }
  return null;
}

async function run() {
  const ids = [
    'Lx-AaYQMc84', // Why I Get Married?
    'kJQP7kiw5Fk', // Despacito
    'fJ9rUzIMcZQ', // Michael Jackson
    '9bZkp7q19f0', // PSY - GANGNAM STYLE
    'JGwWNGJdvx8', // Ed Sheeran - Shape of You
    'OPf0YbXqDm0', // Mark Ronson - Uptown Funk
  ];

  for (const id of ids) {
    const res = await resolveVideo(id);
    console.log(`Video ${id} ->`, res ? `SUCCESS: "${res.matchedTitle}" (320kbps AAC, stream: ${res.streamUrl.slice(0, 60)}...)` : 'FAILED');
  }
}

run();
