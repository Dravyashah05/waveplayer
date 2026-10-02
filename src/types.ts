export interface Track {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
  duration: string;
  durationSeconds: number;
  url: string;
  streamUrl?: string;           // Direct 320kbps / high-quality audio URL (AAC / MP4 / MP3)
  downloadUrl?: string;         // Direct download URL for offline listening (320kbps)
  qualities?: { quality: string; url: string }[];
  albumId?: string;
  albumName?: string;
  type?: 'SONG' | 'VIDEO';
  hasLyrics?: boolean;
  lyricsId?: string;
  source?: 'saavn' | 'ytmusic' | 'youtube' | 'local' | 'custom';
  year?: string | number | null;
  language?: string;
  copyright?: string;
  label?: string;
  explicit?: boolean;
  playCount?: number;
  isrc?: string;
  identity?: MusicIdentity;
  artists?: {
    primary?: { id?: string; name: string; role?: string; image?: string; type?: string }[];
    featured?: { id?: string; name: string; role?: string; image?: string; type?: string }[];
    all?: { id?: string; name: string; role?: string; image?: string; type?: string }[];
  };
}

export type MusicVersionType = 'original' | 'remix' | 'live' | 'acoustic' | 'cover' | 'instrumental' | 'lofi' | 'slowed' | 'sped_up' | 'unknown';
export interface MusicIdentity {
  canonicalId: string;
  normalizedTitle: string;
  normalizedArtist: string;
  normalizedAlbum?: string;
  youtubeId?: string;
  saavnId?: string;
  isrc?: string;
  duration?: number;
  year?: number;
  language?: string;
  versionType: MusicVersionType;
}

export interface Playlist {
  playlistId: string;
  name: string;
  author: string;
  thumbnails: { url: string; width: number; height: number }[];
  videoCount?: number;
  type: 'PLAYLIST';
  description?: string;
  language?: string;
  source?: 'saavn' | 'ytmusic';
  tracks?: Track[];
}

export interface Album {
  albumId: string;
  playlistId: string;
  name: string;
  artist: { artistId: string | null; name: string };
  year: number | null;
  thumbnails: { url: string; width: number; height: number }[];
  type: 'ALBUM';
  description?: string;
  language?: string;
  songCount?: number;
  source?: 'saavn' | 'ytmusic';
  tracks?: Track[];
}

export interface SearchArtist {
  artistId: string;
  name: string;
  thumbnails: { url: string; width: number; height: number }[];
  type: 'ARTIST';
  role?: string;
  description?: string;
  source?: 'saavn' | 'ytmusic';
}

export type SearchFilter = 'all' | 'songs' | 'videos' | 'albums' | 'playlists' | 'artists';

export interface PlayerState {
  current: Track | null;
  queue: Track[];
  index: number;
  isPlaying: boolean;
  volume: number;
  shuffle: boolean;
  repeat: 'off' | 'one' | 'all';
}
