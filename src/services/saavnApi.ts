import CryptoJS from 'crypto-js';
import { Track, Album, Playlist, SearchArtist } from '../types';

const SAAVN_API_BASE = '/api/saavn';

export function unescapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/**
 * Decrypts JioSaavn DES-ECB encrypted media URL into direct 320kbps / 160kbps stream links
 */
export function decryptMediaUrl(encryptedMediaUrl: string): { quality: string; url: string }[] {
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
      { id: '_320', bitrate: '320kbps' },
      { id: '_160', bitrate: '160kbps' },
      { id: '_96', bitrate: '96kbps' },
      { id: '_48', bitrate: '48kbps' },
    ];

    return qualities.map((q) => ({
      quality: q.bitrate,
      url: decryptedLink.replace('_96', q.id),
    }));
  } catch (err) {
    console.warn('[SaavnApi] decrypt error:', err);
    return [];
  }
}

/**
 * Replaces low-res thumbnails with 500x500 HD artwork
 */
export function getHdImageUrl(url: string): string {
  if (!url) return '';
  return url
    .replace(/150x150|50x50/, '500x500')
    .replace(/^http:\/\//, 'https://');
}

export function formatDuration(sec: number): string {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/**
 * Normalizes raw JioSaavn song object into Wave Track model
 */
export function formatSaavnSong(song: any): Track {
  const enc = song.more_info?.encrypted_media_url || song.encrypted_media_url || '';
  const qualities = decryptMediaUrl(enc);
  const stream320 = qualities.find((q) => q.quality === '320kbps')?.url;
  const stream160 = qualities.find((q) => q.quality === '160kbps')?.url;
  const streamUrl = stream320 || stream160 || qualities[0]?.url || '';
  const durationSec = Number(song.more_info?.duration || song.duration || 0);

  const rawImage = song.image || song.more_info?.image || '';
  const thumbnail = getHdImageUrl(rawImage);

  const title = unescapeHtml(song.title || song.name || song.song || 'Unknown Track');
  const author = unescapeHtml(
    song.more_info?.primary_artists ||
    song.more_info?.singers ||
    song.more_info?.music ||
    song.subtitle ||
    song.primary_artists ||
    song.singers ||
    'Various Artists'
  );

  const albumName = unescapeHtml(song.more_info?.album || song.album || '');
  const albumId = song.more_info?.album_id || song.album_id || undefined;

  return {
    id: song.id,
    title,
    author,
    thumbnail,
    duration: formatDuration(durationSec),
    durationSeconds: durationSec,
    url: song.perma_url || (song.id ? `https://www.jiosaavn.com/song/_/${song.id}` : ''),
    streamUrl: streamUrl || undefined,
    downloadUrl: stream320 || streamUrl || undefined,
    qualities,
    albumId,
    albumName,
    type: 'SONG',
    source: 'saavn',
    hasLyrics: song.more_info?.has_lyrics === 'true' || song.has_lyrics === 'true',
    lyricsId: song.more_info?.lyrics_id || song.lyrics_id || undefined,
    year: song.year || song.more_info?.year || undefined,
    language: song.language || song.more_info?.language || undefined,
    copyright: unescapeHtml(song.more_info?.copyright_text || ''),
    label: unescapeHtml(song.more_info?.label || ''),
    explicit: song.explicit_content === '1',
    playCount: Number(song.play_count || song.more_info?.play_count || 0),
    isrc: song.more_info?.isrc || song.isrc || undefined,
  };
}

export function formatSaavnAlbum(album: any): Album {
  const rawImage = album.image || '';
  const hdImage = getHdImageUrl(rawImage);
  const name = unescapeHtml(album.title || album.name || '');
  const artistName = unescapeHtml(album.more_info?.music || album.music || album.artist || album.header_desc || 'Various Artists');

  return {
    albumId: album.id,
    playlistId: album.id,
    name,
    artist: {
      artistId: album.more_info?.artistMap?.primary_artists?.[0]?.id || null,
      name: artistName,
    },
    year: album.year ? Number(album.year) : album.more_info?.year ? Number(album.more_info.year) : null,
    thumbnails: [
      { url: hdImage, width: 500, height: 500 },
      { url: rawImage, width: 150, height: 150 },
    ],
    type: 'ALBUM',
    description: unescapeHtml(album.header_desc || album.description || ''),
    language: album.language || album.more_info?.language,
    songCount: album.more_info?.song_count ? Number(album.more_info.song_count) : undefined,
    source: 'saavn',
  };
}

export function formatSaavnPlaylist(playlist: any): Playlist {
  const rawImage = playlist.image || '';
  const hdImage = getHdImageUrl(rawImage);
  const name = unescapeHtml(playlist.title || playlist.name || '');
  const author = unescapeHtml(playlist.more_info?.firstname || playlist.subtitle || 'JioSaavn Editorial');

  return {
    playlistId: playlist.id,
    name,
    author,
    thumbnails: [
      { url: hdImage, width: 500, height: 500 },
      { url: rawImage, width: 150, height: 150 },
    ],
    videoCount: Number(playlist.more_info?.song_count || playlist.list_count || 0),
    type: 'PLAYLIST',
    description: unescapeHtml(playlist.header_desc || playlist.description || ''),
    language: playlist.more_info?.language || playlist.language,
    source: 'saavn',
  };
}

export function formatSaavnArtist(artist: any): SearchArtist {
  const rawImage = artist.image || '';
  const hdImage = getHdImageUrl(rawImage);
  const name = unescapeHtml(artist.title || artist.name || '');

  return {
    artistId: artist.id,
    name,
    thumbnails: [
      { url: hdImage, width: 500, height: 500 },
      { url: rawImage, width: 150, height: 150 },
    ],
    type: 'ARTIST',
    role: artist.role || artist.description || 'Artist',
    source: 'saavn',
  };
}

// Low-level fetch wrapper
async function callSaavnApi(endpoint: string, params: Record<string, string | number> = {}): Promise<any> {
  const url = new URL(SAAVN_API_BASE, window.location.origin);
  url.searchParams.append('__call', endpoint);
  url.searchParams.append('_format', 'json');
  url.searchParams.append('_marker', '0');
  url.searchParams.append('api_version', '4');
  url.searchParams.append('ctx', 'web6dot0');

  Object.entries(params).forEach(([key, val]) => {
    url.searchParams.append(key, String(val));
  });

  try {
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Saavn API failed: ${res.status}`);
    return await res.json();
  } catch (err) {
    // NOTE: no direct https://www.jiosaavn.com fallback here — JioSaavn sends
    // no CORS headers, so browser-direct calls always fail with ERR_FAILED and
    // just spam the console. Rely on the same-origin proxy; callers already
    // degrade gracefully (empty lists) on throw.
    throw err;
  }
}

/**
 * Searches songs on JioSaavn with direct 320kbps audio URLs
 */
export async function searchSaavnSongs(query: string, page = 1, limit = 20): Promise<{ total: number; tracks: Track[] }> {
  if (!query.trim()) return { total: 0, tracks: [] };
  try {
    const data = await callSaavnApi('search.getResults', {
      q: query.trim(),
      p: page,
      n: limit,
    });
    const results = data.results || [];
    const tracks = results.map(formatSaavnSong);
    return {
      total: Number(data.total || tracks.length),
      tracks,
    };
  } catch (err) {
    console.error('[SaavnApi] searchSaavnSongs error:', err);
    return { total: 0, tracks: [] };
  }
}

/**
 * Searches albums on JioSaavn
 */
export async function searchSaavnAlbums(query: string, page = 1, limit = 20): Promise<{ total: number; albums: Album[] }> {
  if (!query.trim()) return { total: 0, albums: [] };
  try {
    const data = await callSaavnApi('search.getAlbumResults', {
      q: query.trim(),
      p: page,
      n: limit,
    });
    const results = data.results || [];
    const albums = results.map(formatSaavnAlbum);
    return {
      total: Number(data.total || albums.length),
      albums,
    };
  } catch (err) {
    console.error('[SaavnApi] searchSaavnAlbums error:', err);
    return { total: 0, albums: [] };
  }
}

/**
 * Searches playlists on JioSaavn
 */
export async function searchSaavnPlaylists(query: string, page = 1, limit = 20): Promise<{ total: number; playlists: Playlist[] }> {
  if (!query.trim()) return { total: 0, playlists: [] };
  try {
    const data = await callSaavnApi('search.getPlaylistResults', {
      q: query.trim(),
      p: page,
      n: limit,
    });
    const results = data.results || [];
    const playlists = results.map(formatSaavnPlaylist);
    return {
      total: Number(data.total || playlists.length),
      playlists,
    };
  } catch (err) {
    console.error('[SaavnApi] searchSaavnPlaylists error:', err);
    return { total: 0, playlists: [] };
  }
}

/**
 * Searches artists on JioSaavn
 */
export async function searchSaavnArtists(query: string, page = 1, limit = 20): Promise<{ total: number; artists: SearchArtist[] }> {
  if (!query.trim()) return { total: 0, artists: [] };
  try {
    const data = await callSaavnApi('search.getArtistResults', {
      q: query.trim(),
      p: page,
      n: limit,
    });
    const results = data.results || [];
    const artists = results.map(formatSaavnArtist);
    return {
      total: Number(data.total || artists.length),
      artists,
    };
  } catch (err) {
    console.error('[SaavnApi] searchSaavnArtists error:', err);
    return { total: 0, artists: [] };
  }
}

/**
 * Fast search suggestions autocomplete
 */
export async function getSaavnSuggestions(query: string): Promise<string[]> {
  if (!query.trim()) return [];
  try {
    const data = await callSaavnApi('autocomplete.get', { query: query.trim() });
    const suggestions: string[] = [];
    if (data.topquery?.data) {
      data.topquery.data.forEach((item: any) => {
        if (item.title) suggestions.push(unescapeHtml(item.title));
      });
    }
    if (data.songs?.data) {
      data.songs.data.forEach((item: any) => {
        if (item.title && !suggestions.includes(unescapeHtml(item.title))) {
          suggestions.push(unescapeHtml(item.title));
        }
      });
    }
    if (data.albums?.data) {
      data.albums.data.forEach((item: any) => {
        if (item.title && !suggestions.includes(unescapeHtml(item.title))) {
          suggestions.push(unescapeHtml(item.title));
        }
      });
    }
    return suggestions.slice(0, 8);
  } catch (err) {
    console.warn('[SaavnApi] getSaavnSuggestions error:', err);
    return [];
  }
}

/**
 * Unified Search across all categories
 */
export async function searchSaavnAll(query: string): Promise<{
  tracks: Track[];
  albums: Album[];
  playlists: Playlist[];
  artists: SearchArtist[];
  topQuery?: any;
}> {
  if (!query.trim()) return { tracks: [], albums: [], playlists: [], artists: [] };
  try {
    const [songRes, albumRes, playlistRes, artistRes] = await Promise.all([
      searchSaavnSongs(query, 1, 15),
      searchSaavnAlbums(query, 1, 8),
      searchSaavnPlaylists(query, 1, 8),
      searchSaavnArtists(query, 1, 6),
    ]);

    return {
      tracks: songRes.tracks,
      albums: albumRes.albums,
      playlists: playlistRes.playlists,
      artists: artistRes.artists,
    };
  } catch (err) {
    console.error('[SaavnApi] searchSaavnAll error:', err);
    return { tracks: [], albums: [], playlists: [], artists: [] };
  }
}

/**
 * Gets song details with 320kbps audio link by song ID
 */
export async function getSaavnSongDetails(songId: string): Promise<Track | null> {
  if (!songId) return null;
  try {
    const data = await callSaavnApi('song.getDetails', { pids: songId });
    const rawSong = data[songId] || (data.songs && data.songs[0]) || (Array.isArray(data) && data[0]);
    if (!rawSong) return null;
    return formatSaavnSong(rawSong);
  } catch (err) {
    console.error('[SaavnApi] getSaavnSongDetails error:', err);
    return null;
  }
}

/**
 * Gets album details + full tracklist with 320kbps links
 */
export async function getSaavnAlbumDetails(albumId: string): Promise<{ album: Album; tracks: Track[] } | null> {
  if (!albumId) return null;
  try {
    const data = await callSaavnApi('content.getAlbumDetails', { albumid: albumId });
    if (!data || !data.title) return null;
    const album = formatSaavnAlbum(data);
    const tracks = (data.list || []).map(formatSaavnSong);
    return { album, tracks };
  } catch (err) {
    console.error('[SaavnApi] getSaavnAlbumDetails error:', err);
    return null;
  }
}

/**
 * Gets playlist details + full tracklist with 320kbps links
 */
export async function getSaavnPlaylistDetails(playlistId: string): Promise<{ playlist: Playlist; tracks: Track[] } | null> {
  if (!playlistId) return null;
  try {
    const data = await callSaavnApi('playlist.getDetails', { listid: playlistId });
    if (!data || !data.title) return null;
    const playlist = formatSaavnPlaylist(data);
    const tracks = (data.list || []).map(formatSaavnSong);
    return { playlist, tracks };
  } catch (err) {
    console.error('[SaavnApi] getSaavnPlaylistDetails error:', err);
    return null;
  }
}

/**
 * Gets artist details, top songs, and albums
 */
export async function getSaavnArtistDetails(artistId: string): Promise<{
  artist: SearchArtist;
  topSongs: Track[];
  topAlbums: Album[];
  bio?: string;
} | null> {
  if (!artistId) return null;
  try {
    const data = await callSaavnApi('artist.getArtistPageDetails', { artistId });
    if (!data || !data.name) return null;
    const artist = formatSaavnArtist(data);
    const topSongs = (data.topSongs || []).map(formatSaavnSong);
    const topAlbums = (data.topAlbums || []).map(formatSaavnAlbum);
    return {
      artist,
      topSongs,
      topAlbums,
      bio: unescapeHtml(data.bio || data.header_desc || ''),
    };
  } catch (err) {
    console.error('[SaavnApi] getSaavnArtistDetails error:', err);
    return null;
  }
}

/**
 * Gets official lyrics from JioSaavn
 */
export async function getSaavnLyrics(lyricsId: string): Promise<{ lyrics: string; snippet?: string } | null> {
  if (!lyricsId) return null;
  try {
    const data = await callSaavnApi('lyrics.getLyrics', { lyrics_id: lyricsId });
    if (!data || !data.lyrics) return null;
    return {
      lyrics: unescapeHtml(data.lyrics.replace(/<br\s*[\/]?>/gi, '\n')),
      snippet: unescapeHtml(data.snippet || ''),
    };
  } catch (err) {
    console.warn('[SaavnApi] getSaavnLyrics error:', err);
    return null;
  }
}

/**
 * Fetches JioSaavn Homepage Browse Modules (Trending, Top Playlists, New Albums, Charts)
 */
export async function getSaavnBrowseModules(): Promise<{
  trending: Track[];
  topPlaylists: Playlist[];
  newAlbums: Album[];
  charts: Playlist[];
}> {
  try {
    const data = await callSaavnApi('content.getBrowseModules');
    const trending: Track[] = (data.new_trending || []).map((item: any) => {
      if (item.type === 'song') return formatSaavnSong(item);
      return formatSaavnSong({
        ...item,
        more_info: {
          ...item.more_info,
          primary_artists: item.more_info?.music || item.subtitle,
        }
      });
    });

    const topPlaylists: Playlist[] = (data.top_playlists || []).map(formatSaavnPlaylist);
    const newAlbums: Album[] = (data.new_albums || []).map(formatSaavnAlbum);
    const charts: Playlist[] = (data.charts || []).map(formatSaavnPlaylist);

    return {
      trending,
      topPlaylists,
      newAlbums,
      charts,
    };
  } catch (err) {
    console.error('[SaavnApi] getSaavnBrowseModules error:', err);
    return {
      trending: [],
      topPlaylists: [],
      newAlbums: [],
      charts: [],
    };
  }
}

/**
 * Infinite Autoplay / Song Radio Recommendation Station
 */
export async function getSaavnSongRadio(songId: string): Promise<Track[]> {
  if (!songId) return [];
  try {
    const stationData = await callSaavnApi('webradio.createEntityStation', {
      entity_id: `["${songId}"]`,
      entity_type: 'queue',
    });
    const stationId = stationData?.stationid;
    if (!stationId) return [];

    const radioSongs = await callSaavnApi('webradio.getSong', {
      stationid: stationId,
      k: 20,
    });

    const songKeys = Object.keys(radioSongs || {}).filter((k) => !isNaN(Number(k)));
    const tracks = songKeys.map((k) => formatSaavnSong(radioSongs[k]?.song || radioSongs[k]));
    return tracks.filter((t) => t.id && t.title);
  } catch (err) {
    console.warn('[SaavnApi] getSaavnSongRadio error:', err);
    return [];
  }
}
