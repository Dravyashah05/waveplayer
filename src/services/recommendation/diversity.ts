import type { Track } from '../../types';
import { matchSongs } from './songMatcher';

export function diversify<T extends Track>(items: T[], limit: number, artistCap = 2, albumCap = 2): T[] {
  const selected: T[] = [];
  const artists = new Map<string, number>();
  const albums = new Map<string, number>();
  const artistOf = (track: Track) => (track.author || '').split(/,| feat\.? | ft\.? | & /i)[0].trim().toLowerCase();
  const albumOf = (track: Track) => (track.albumId || track.albumName || '').trim().toLowerCase();
  for (const item of items) {
    if (selected.some((prior) => matchSongs(prior, item).isMatch)) continue;
    const artist = artistOf(item); const album = albumOf(item);
    if ((artists.get(artist) || 0) >= artistCap || (album && (albums.get(album) || 0) >= albumCap)) continue;
    selected.push(item);
    if (artist) artists.set(artist, (artists.get(artist) || 0) + 1);
    if (album) albums.set(album, (albums.get(album) || 0) + 1);
    if (selected.length >= limit) return selected;
  }
  return selected;
}
