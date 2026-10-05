import { Track } from '../types';

const INV_INSTANCES = [
  'https://inv.tux.pizza',
  'https://yewtu.be',
  'https://vid.puffyan.us',
];

function formatDuration(sec: number): string {
  if (!sec || !isFinite(sec) || sec === 0) return '—';
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  const s = Math.floor(sec%60);
  if (h>0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function parsePipedDuration(s: number | string): number {
  const n = Number(s);
  return isFinite(n) ? n : 0;
}
function ytMaxRes(id: string): string { return `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`; }
function pickLargestThumb(thumbs: any[] | undefined, id: string): string {
  if (Array.isArray(thumbs) && thumbs.length) {
    let best = thumbs[0];
    for (const t of thumbs) if ((Number(t.width) || 0) > (Number(best.width) || 0)) best = t;
    if (best?.url) {
      let u = String(best.url);
      if (u.includes('/vi/')) u = u.replace(/hqdefault|mqdefault|sddefault|hq720/g, 'maxresdefault');
      // for yt3 thumbs, try upscale
      if (u.includes('=w')) u = u.replace(/=w\d+-h\d+/, '=w1080-h1080').replace(/=w\d+/, '=w1080');
      return u;
    }
  }
  return ytMaxRes(id);
}

export async function searchYouTube(q: string): Promise<Track[]> {
  const query = q.trim();
  if (!query) return [];

  // If query is a YouTube URL or 11-char ID, return single track via oEmbed
  const vidMatch = query.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|\/v\/|\/live\/)([a-zA-Z0-9_-]{11})|^[a-zA-Z0-9_-]{11}$/);
  const directId = /^[a-zA-Z0-9_-]{11}$/.test(query) ? query : vidMatch?.[1];
  if (directId) {
    try {
      const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${directId}&format=json`);
      if (r.ok) {
        const j = await r.json();
        let thumb = String(j.thumbnail_url || '');
        if (thumb.includes('/vi/')) thumb = thumb.replace(/hqdefault|mqdefault|sddefault|hq720/g, 'maxresdefault');
        if (!thumb) thumb = ytMaxRes(directId);
        return [{ id: directId, title: j.title || `YouTube Video (${directId})`, author: j.author_name || 'YouTube', thumbnail: thumb, duration: '—', durationSeconds: 0, url: `https://www.youtube.com/watch?v=${directId}` }];
      }
    } catch {}
    return [{ id: directId, title: `YouTube Video (${directId})`, author: 'YouTube', thumbnail: ytMaxRes(directId), duration: '—', durationSeconds: 0, url: `https://www.youtube.com/watch?v=${directId}` }];
  }

  // 0) Try YTMusic API first (best for music, playlists, with suggestions) - via Wave YTMusic backend
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 6000);
    const ytmRes = await fetch(`/api/ytmusic/search?q=${encodeURIComponent(query)}&filter=songs`, { signal: controller.signal, headers: { Accept: 'application/json' } });
    clearTimeout(t);
    if (ytmRes.ok) {
      const ytmData = await ytmRes.json();
      if (Array.isArray(ytmData) && ytmData.length) {
        const ytmTracks: Track[] = ytmData.map((v:any)=>{
          const id = String(v.videoId || v.id || '');
          const dur = Number(v.duration ?? 0);
          return {
            id,
            title: String(v.name || v.title || 'Unknown'),
            author: String(v.artist?.name || v.author || 'YouTube'),
            thumbnail: pickLargestThumb(v.thumbnails, id) || String(v.thumbnail || ytMaxRes(id)),
            duration: formatDuration(dur),
            durationSeconds: dur,
            url: `https://www.youtube.com/watch?v=${id}`,
            source: 'ytmusic',
          } as Track;
        }).filter(t=> t.id && /^[a-zA-Z0-9_-]{11}$/.test(t.id));
        if (ytmTracks.length) return ytmTracks.slice(0,12);
      }
    }
  } catch (e) { console.warn('[Wave Player] YTMusic search failed', e); }

  // 0b) Try Wave backend search (yt-dlp fallback) - try relative proxy first
  const waveBackends = [
    '/api/search',
    'http://localhost:8000/api/search',
    'http://127.0.0.1:8000/api/search',
    'http://localhost:3000/api/search',
    'http://127.0.0.1:3000/api/search',
  ];
  for (const base of waveBackends) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${base}?q=${encodeURIComponent(query)}&limit=12`, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
      clearTimeout(t);
      if (!res.ok) continue;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) continue;
      const tracks: Track[] = data.map((v: any) => {
        const tid = String(v.id || v.videoId || v.video_id || '');
        let thumb = String(v.thumbnailUrl || v.thumbnail || '');
        if (thumb.includes('/vi/')) thumb = thumb.replace(/hqdefault|mqdefault|sddefault|hq720/g, 'maxresdefault');
        if (!thumb) thumb = ytMaxRes(tid);
        else if (Array.isArray(v.thumbnails)) thumb = pickLargestThumb(v.thumbnails, tid);
        return {
        id: tid,
        title: String(v.title || 'Unknown'),
        author: String(v.author || v.uploader || 'YouTube'),
        thumbnail: thumb,
        duration: formatDuration(Number(v.durationSeconds ?? v.lengthSeconds ?? v.duration ?? 0)),
        durationSeconds: Number(v.durationSeconds ?? v.lengthSeconds ?? v.duration ?? 0),
        url: String(v.url || `https://www.youtube.com/watch?v=${v.id || v.videoId}`),
      };
      }).filter(t => t.id && /^[a-zA-Z0-9_-]{11}$/.test(t.id));
      if (tracks.length) return tracks;
    } catch (e) {
      console.warn('[Wave Player] Wave backend search failed', e);
      continue;
    }
  }

  // 1) Try Invidious search (try multiple instances)
  for (const base of INV_INSTANCES) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video`, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
      clearTimeout(t);
      if (!res.ok) continue;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) continue;
      const tracks: Track[] = data.slice(0, 12).map((v: any) => {
        const tid = String(v.videoId || v.video_id || '');
        return {
        id: tid,
        title: String(v.title || 'Unknown'),
        author: String(v.author || v.authorName || 'YouTube'),
        thumbnail: pickLargestThumb(v.videoThumbnails, tid) || String(v.thumbnail || ytMaxRes(tid)),
        duration: formatDuration(Number(v.lengthSeconds || v.duration || 0)),
        durationSeconds: Number(v.lengthSeconds || 0),
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
      };
      }).filter(t => t.id && /^[a-zA-Z0-9_-]{11}$/.test(t.id));
      if (tracks.length) return tracks;
    } catch (e) {
      console.warn('[Wave Player] Invidious failed', e);
      continue;
    }
  }

  // 2) Try Piped API (pipedapi.kavin.rocks)
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(`https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(query)}&filter=videos`, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
    clearTimeout(t);
    if (res.ok) {
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      if (items.length) {
        const tracks: Track[] = items.slice(0, 12).map((v: any) => {
          const url: string = String(v.url || '');
          const id = url.match(/v=([a-zA-Z0-9_-]{11})/)?.[1] || String(v.videoId || '').slice(0,11);
          return {
            id,
            title: String(v.title || 'Unknown'),
            author: String(v.uploaderName || v.author || 'YouTube'),
            thumbnail: (()=>{ let u=String(v.thumbnail||''); if(u.includes('/vi/')) u=u.replace(/hqdefault|mqdefault|sddefault|hq720/g,'maxresdefault'); return u || ytMaxRes(id); })(),
            duration: formatDuration(parsePipedDuration(v.duration)),
            durationSeconds: parsePipedDuration(v.duration),
            url: `https://www.youtube.com/watch?v=${id}`,
          };
        }).filter((t: Track) => t.id && /^[a-zA-Z0-9_-]{11}$/.test(t.id));
        if (tracks.length) return tracks;
      }
    }
  } catch (e) {
    console.warn('[Wave Player] Piped failed', e);
  }

  // 3) Try yt.lemnoslife (noKey)
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(`https://yt.lemnoslife.com/noKey/search?part=snippet&q=${encodeURIComponent(query)}`, { signal: controller.signal });
    clearTimeout(t);
    if (res.ok) {
      const data = await res.json();
      const items = data?.items || [];
      if (Array.isArray(items) && items.length) {
        const tracks: Track[] = items.slice(0, 12).map((v: any) => {
          const id = String(v.id?.videoId || v.id || '').slice(0,11);
          const snippet = v.snippet || {};
          return {
            id,
            title: String(snippet.title || 'Unknown'),
            author: String(snippet.channelTitle || 'YouTube'),
            thumbnail: (()=>{ let u=String(snippet.thumbnails?.maxres?.url || snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || ''); if(u.includes('/vi/')) u=u.replace(/hqdefault|mqdefault|sddefault|hq720/g,'maxresdefault'); return u || ytMaxRes(id); })(),
            duration: '—',
            durationSeconds: 0,
            url: `https://www.youtube.com/watch?v=${id}`,
          };
        }).filter((t: Track) => t.id && /^[a-zA-Z0-9_-]{11}$/.test(t.id));
        if (tracks.length) return tracks;
      }
    }
  } catch (e) {
    console.warn('[Wave Player] lemnoslife failed', e);
  }

  // No results from any provider — return empty so UI can show No content message
  return [];
}
