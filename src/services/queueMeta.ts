import type { Track } from '../types';

/**
 * Queue 2.0 — per-item provenance metadata (sidecar, never a second queue).
 *
 * playerStore remains the single queue/index/shuffle/repeat source of truth
 * and playerEngine remains the sole audio owner. This module only describes
 * WHERE each queued item came from so the UI can label sections ("Radio",
 * "Playlist • Chill Mix") and listening analytics can use the context later.
 * The Track object itself is never duplicated — metadata rides alongside.
 */

export type QueueAddedBy =
  | 'user'
  | 'playlist'
  | 'album'
  | 'artist'
  | 'radio'
  | 'recommendation'
  | 'autoplay'
  | 'search';

export interface QueueItemMeta {
  queueItemId: string;
  addedBy: QueueAddedBy;
  /** Human context, e.g. playlist/album name or "track-radio". */
  context?: string;
  source?: string;
  playlistId?: string;
  albumId?: string;
  radioSessionId?: string;
  seedTrackId?: string;
  seedTitle?: string;
  addedAt: number;
}

export type QueueMetaInput = Partial<
  Pick<
    QueueItemMeta,
    'addedBy' | 'context' | 'source' | 'playlistId' | 'albumId' | 'radioSessionId' | 'seedTrackId' | 'seedTitle'
  >
>;

let uidCounter = 0;
export function newQueueItemId(): string {
  uidCounter += 1;
  return `q_${Date.now().toString(36)}_${uidCounter.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function defaultMeta(input?: QueueMetaInput): QueueItemMeta {
  return {
    queueItemId: newQueueItemId(),
    addedBy: input?.addedBy || 'user',
    context: input?.context,
    source: input?.source,
    playlistId: input?.playlistId,
    albumId: input?.albumId,
    radioSessionId: input?.radioSessionId,
    seedTrackId: input?.seedTrackId,
    seedTitle: input?.seedTitle,
    addedAt: Date.now(),
  };
}

export function isMetaLike(v: unknown): v is QueueItemMeta {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as QueueItemMeta).queueItemId === 'string' &&
    typeof (v as QueueItemMeta).addedBy === 'string'
  );
}

/** Short provenance label for queue rows, e.g. "Playlist • Chill Mix". Never scores. */
export function describeSource(meta: QueueItemMeta | null | undefined): string | null {
  if (!meta) return null;
  if (meta.addedBy === 'radio' || meta.addedBy === 'autoplay') return null; // radio rows use the radio badge instead
  const ctx = (meta.context || '').trim();
  switch (meta.addedBy) {
    case 'playlist':
      return ctx ? `Playlist • ${ctx}` : 'Playlist';
    case 'album':
      return ctx ? `Album • ${ctx}` : 'Album';
    case 'artist':
      return ctx ? `Artist • ${ctx}` : 'Artist';
    case 'recommendation':
      return ctx ? `Recommended • ${ctx}` : 'Recommended';
    case 'search':
      return 'Search';
    default:
      return null;
  }
}

/** Radio "because" line, e.g. `Because of "Tum Hi Ho"`. Null when unknown. */
export function radioReason(meta: QueueItemMeta | null | undefined): string | null {
  if (!meta) return null;
  if (meta.addedBy !== 'radio' && meta.addedBy !== 'autoplay') return null;
  if (meta.seedTitle) return `Because of “${meta.seedTitle}”`;
  if (meta.context) return `From ${meta.context}`;
  return 'Radio';
}

// ---------------------------------------------------------------------------
// Smart shuffle order (Fisher–Yates + variety repair, current track first)
// ---------------------------------------------------------------------------

function artistOf(t: Track): string {
  return ((t.author || '').split(',')[0]?.trim() || '').toLowerCase();
}
function albumOf(t: Track): string {
  return (t.albumName || '').trim().toLowerCase();
}

/**
 * Build a playback order over queue indices: current index first, then a
 * shuffled tail repaired so the same artist/album never clusters back to
 * back when avoidable. Pure + deterministic-safe (Math.random only).
 * Never mutates the queue — the store keeps queue order, this is only the
 * playback pointer sequence (existing architecture preserved).
 */
export function buildShuffleOrder(tracks: Track[], currentIndex: number): number[] {
  const n = tracks.length;
  if (!n) return [];
  const cur = currentIndex >= 0 && currentIndex < n ? currentIndex : 0;
  const rest: number[] = [];
  for (let i = 0; i < n; i++) if (i !== cur) rest.push(i);
  // Fisher–Yates (unbiased, unlike the previous sort-by-random).
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  // Greedy repair: place each candidate after the last placed one, preferring
  // a different artist (then different album). Bounded retries, best effort.
  const out: number[] = [cur];
  const pool = [...rest];
  while (pool.length) {
    const prev = tracks[out[out.length - 1]];
    const prevArtist = artistOf(prev);
    const prevAlbum = albumOf(prev);
    let pick = 0;
    const diffArtist = pool.findIndex((idx) => artistOf(tracks[idx]) !== prevArtist);
    if (diffArtist >= 0) {
      const diffAlbum = pool.findIndex(
        (idx) => artistOf(tracks[idx]) !== prevArtist && albumOf(tracks[idx]) !== prevAlbum,
      );
      pick = diffAlbum >= 0 ? diffAlbum : diffArtist;
    }
    out.push(pool.splice(pick, 1)[0]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts (pure matcher — the hook lives separately)
// ---------------------------------------------------------------------------

export type ShortcutAction = 'toggle' | 'next' | 'prev' | 'seekBack' | 'seekFwd';

const SEEK_STEP_SECONDS = 10;

/**
 * Match a keydown to a transport action. Returns null inside editable
 * elements (inputs, textareas, selects, contentEditable) and for modified
 * keys (except plain Space). Pure — tested without a DOM.
 */
export function matchShortcut(e: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  targetTag?: string;
  isContentEditable?: boolean;
}): ShortcutAction | null {
  const tag = (e.targetTag || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.isContentEditable) return null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key) {
    case ' ':
    case 'k':
    case 'K':
      return 'toggle';
    case 'ArrowLeft':
      return 'seekBack';
    case 'ArrowRight':
      return 'seekFwd';
    case 'n':
    case 'N':
      return 'next';
    case 'p':
    case 'P':
      return 'prev';
    default:
      return null;
  }
}

export function shortcutSeekDelta(action: 'seekBack' | 'seekFwd'): number {
  return action === 'seekBack' ? -SEEK_STEP_SECONDS : SEEK_STEP_SECONDS;
}
