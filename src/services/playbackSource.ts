export type ResolutionRoute = 'provided-audio' | 'saavn' | 'youtube';

export function resolutionRoute(track: { id: string; source?: string; streamUrl?: string }): ResolutionRoute {
  if (track.streamUrl) return 'provided-audio';
  if (track.source === 'saavn' || !/^[a-zA-Z0-9_-]{11}$/.test(track.id)) return 'saavn';
  return 'youtube';
}
