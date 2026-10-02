import type { Track } from '../types';
import { matchSongs } from './recommendation/songMatcher';
import { youtubeVideoIdOf, filterNewTracks } from './playlistModel';
import {
  addVideoToYoutubePlaylist,
  createYoutubePlaylist,
  isInsufficientScope,
} from './youtubePlaylists';
import { createLocalPlaylist, getLocalPlaylists, saveLocalPlaylists } from './libraryStore';
import { notifyLibraryChanged } from './accountSync';
import { buildImportPreview, buildWavePlaylist, type ImportPreview, type ItemMatch, type YoutubeItem } from './youtubeImport';

/**
 * Playlist Experience 2.0 — explicit import / export workflows.
 *
 * No automatic two-way sync: every transfer builds a preview first, the
 * user confirms (including per-possible-match choices), then execution
 * runs and reports per-track truth (never pretends success).
 */

export type TransferTier = 'matched' | 'possible' | 'unmatched';

export interface ExportCandidate {
  track: Track;
  videoId: string | null;
  tier: TransferTier;
  confidence: number;
  reason: string;
}

export interface ExportPreview {
  matched: ExportCandidate[];
  possible: ExportCandidate[];
  unmatched: ExportCandidate[];
}

export interface ExportResult {
  playlistId: string | null;
  added: number;
  failed: { trackId: string; title: string }[];
  skipped: number;
  insufficientScope: boolean;
}

/**
 * Wave → YouTube preview. Pure (no I/O): tracks carrying a usable YouTube
 * videoId are `matched`; tracks with real title+artist but no videoId are
 * `possible` (user decides — never auto-added); the rest are `unmatched`.
 * Matching priority (source ID → ISRC → title+artist+album+duration+version)
 * lives in matchSongs; title alone never matches.
 */
export function buildExportPreview(tracks: Track[]): ExportPreview {
  const matched: ExportCandidate[] = [];
  const possible: ExportCandidate[] = [];
  const unmatched: ExportCandidate[] = [];
  for (const track of tracks || []) {
    if (!track?.id) continue;
    const videoId = youtubeVideoIdOf(track);
    if (videoId) {
      matched.push({ track, videoId, tier: 'matched', confidence: 1, reason: 'YouTube video id' });
      continue;
    }
    const hasIdentity = !!(
      track.isrc ||
      (String(track.title || '').trim() && String(track.author || '').trim())
    );
    if (hasIdentity) {
      possible.push({ track, videoId: null, tier: 'possible', confidence: 0.5, reason: 'No YouTube video id — confirm manually' });
    } else {
      unmatched.push({ track, videoId: null, tier: 'unmatched', confidence: 0, reason: 'Not enough metadata to export' });
    }
  }
  return { matched, possible, unmatched };
}

/**
 * Execute an explicit Wave → YouTube export. Creates the playlist, then
 * adds ONLY user-confirmed matched videoIds one by one. Read-only sessions
 * surface `insufficientScope` without creating anything.
 */
export async function executeExport(
  source: { title: string; description?: string; privacyStatus?: 'private' | 'public' | 'unlisted' },
  confirmed: ExportCandidate[],
  onProgress?: (added: number, total: number) => void,
): Promise<ExportResult> {
  const withId = confirmed.filter((c) => c.videoId);
  let playlistId: string | null = null;
  try {
    const created = await createYoutubePlaylist({
      title: source.title,
      description: source.description || '',
      privacyStatus: source.privacyStatus || 'private',
    });
    playlistId = created.sourceId || null;
  } catch (e) {
    if (isInsufficientScope(e)) {
      return { playlistId: null, added: 0, failed: [], skipped: confirmed.length, insufficientScope: true };
    }
    return {
      playlistId: null,
      added: 0,
      failed: confirmed.map((c) => ({ trackId: c.track.id, title: c.track.title })),
      skipped: 0,
      insufficientScope: false,
    };
  }
  // Playlist created but id missing → report honestly, add nothing.
  if (!playlistId) {
    return { playlistId: null, added: 0, failed: withId.map((c) => ({ trackId: c.track.id, title: c.track.title })), skipped: confirmed.length - withId.length, insufficientScope: false };
  }
  let added = 0;
  const failed: { trackId: string; title: string }[] = [];
  for (const c of withId) {
    try {
      const r = await addVideoToYoutubePlaylist(playlistId, c.videoId!);
      if (r.ok) added++;
      else failed.push({ trackId: c.track.id, title: c.track.title });
    } catch (e) {
      if (isInsufficientScope(e)) {
        return { playlistId, added, failed, skipped: withId.length - added - failed.length, insufficientScope: true };
      }
      failed.push({ trackId: c.track.id, title: c.track.title });
    }
    onProgress?.(added + failed.length, withId.length);
  }
  if (added > 0) {
    try {
      notifyLibraryChanged();
    } catch { /* refresh signal is best-effort */ }
  }
  return { playlistId, added, failed, skipped: confirmed.length - withId.length, insufficientScope: false };
}

// ---------------------------------------------------------------------------
// YouTube → Wave import (wraps the existing canonical youtubeImport flow)
// ---------------------------------------------------------------------------

export interface WaveImportDecision {
  /** Possible-match item indexes the user explicitly accepted. */
  acceptedPossible: Set<number>;
  /** Whether to keep tracks that found no match (as YouTube fallbacks). */
  includeUnmatched: boolean;
}

export function applyImportDecisions(
  preview: ImportPreview,
  decision: WaveImportDecision,
): ItemMatch[] {
  const out: ItemMatch[] = [...preview.matched];
  preview.possible.forEach((m) => {
    if (decision.acceptedPossible.has(m.position)) out.push(m);
  });
  if (decision.includeUnmatched) out.push(...preview.unmatched);
  return out.sort((a, b) => a.position - b.position);
}

/**
 * Build a Wave playlist from YouTube items + user decisions. Reuses the
 * canonical matcher (source ID → ISRC → title+artist+album+duration+version,
 * version-aware so Original/Remix/Live/Acoustic/Cover stay distinct) and the
 * existing dedupe (canonical id + videoId, order-preserving). Never
 * requires every track to match: unmatched survive as YouTube fallbacks
 * only when the user opts in.
 */
export async function previewYoutubeImport(
  items: YoutubeItem[],
  onProgress?: (p: { loaded: number; total: number }) => void,
): Promise<ImportPreview> {
  return buildImportPreview(items, onProgress as any);
}

export function createWavePlaylistFromMatches(
  meta: { id: string; title: string; description?: string; thumbnail?: string },
  matches: ItemMatch[],
): { id: string; title: string; added: number } {
  const existing = getLocalPlaylists().find((p) => p.id === `LOCAL_YT_${meta.id}`) || null;
  const merged = buildWavePlaylist(meta, matches, existing);
  const all = getLocalPlaylists();
  const idx = all.findIndex((p) => p.id === merged.id);
  const cleanSongs = (merged.songs || []).filter((t: Track) => t && typeof t.id === 'string');
  if (idx >= 0) {
    // Merge without blindly duplicating: canonical identity wins, imported
    // order preserved for genuinely new tracks.
    const { fresh } = filterNewTracks(cleanSongs, all[idx].songs || []);
    all[idx] = { ...all[idx], ...merged, songs: [...(all[idx].songs || []), ...fresh] };
    saveLocalPlaylists(all);
    return { id: merged.id, title: merged.title, added: fresh.length };
  }
  const created = createLocalPlaylist(merged.title, merged.description || '', []);
  const next = getLocalPlaylists();
  const target = next.find((p) => p.id === created.id);
  if (target) {
    // createLocalPlaylist generated a fresh id; rename payload onto it while
    // keeping Wave ownership + import provenance.
    target.songs = cleanSongs;
    (target as any).source = 'youtube';
    (target as any).sourcePlaylistId = meta.id;
    (target as any).youtubePlaylistId = meta.id;
    target.thumbnail = merged.thumbnail || target.thumbnail;
    target.updatedAt = new Date().toISOString();
    saveLocalPlaylists(next);
  }
  return { id: created.id, title: merged.title, added: cleanSongs.length };
}

/** Version-strict duplicate check for the transfer test surface. */
export function transfersAreDuplicates(a: Track, b: Track): boolean {
  try {
    return matchSongs(a, b).isMatch;
  } catch {
    return a?.id === b?.id;
  }
}
