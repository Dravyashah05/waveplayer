// Shared types for the server recommendation core.
//
// BitChord-derived separations, implemented on Wave's own stack:
// - a CanonicalSong (work) is distinct from a Recording (version);
// - recommendations choose candidates, playerEngine plays resolved Tracks;
// - this core never touches playback, OAuth, or the DOM.

export type VersionType =
  | 'original' | 'remix' | 'live' | 'acoustic' | 'cover'
  | 'instrumental' | 'lofi' | 'slowed' | 'sped_up' | 'remastered';

/** Raw candidate pulled from a source (YouTube Music, trending, …). */
export interface Candidate {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  thumbnails?: string;
  duration?: number;
  year?: number;
  language?: string;
  isrc?: string;
  /** Why this candidate exists: 'upnext' | 'artist' | 'search' | 'trending' | 'home' … */
  relation: string;
  /** Rank signal from the source (0 = top). -1 when unknown. */
  sourceRank?: number;
}

/** Normalized, resolved track returned to clients (Wave Track-compatible). */
export interface ResolvedTrack {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
  duration: string;
  durationSeconds: number;
  url: string;
  source: 'ytmusic';
  type: 'SONG' | 'VIDEO';
  albumId?: string;
  albumName?: string;
  year?: number | null;
  language?: string;
  isrc?: string;
}

export interface TasteHints {
  artists: string[];
  languages: string[];
  excludeIds: string[];
}

export interface RankWeights {
  content: number;
  taste: number;
  artist: number;
  ytRelation: number;
  genre: number;
  language: number;
  popularity: number;
  freshness: number;
  discovery: number;
}

export const DEFAULT_WEIGHTS: RankWeights = {
  content: 0.2,
  taste: 0.2,
  artist: 0.15,
  ytRelation: 0.15,
  genre: 0.08,
  language: 0.06,
  popularity: 0.05,
  freshness: 0.04,
  discovery: 0.07,
};

export interface RankPenalties {
  recentPlay: number;
  skip: number;
  sameArtistRepeat: number;
}

export const DEFAULT_PENALTIES: RankPenalties = {
  recentPlay: 0.45,
  skip: 0.6,
  sameArtistRepeat: 0.12,
};

export interface ScoredCandidate {
  candidate: Candidate;
  score: number;
  reasons: string[];
}
