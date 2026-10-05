import { useState } from 'react';
import type { ImgHTMLAttributes } from 'react';
import { hqArtworkUrl } from '../services/artworkQuality';

const WAVE_ARTWORK = '/icon-512.png';

/** Artwork that cannot leave a broken-image box in the player. Always loads the highest-quality variant. */
export function ArtworkImage({
  src,
  fallbackSrc,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & { src?: string; fallbackSrc?: string }) {
  const [failed, setFailed] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const primary = hqArtworkUrl(src) || hqArtworkUrl(fallbackSrc) || WAVE_ARTWORK;
  fallbackSrc = hqArtworkUrl(fallbackSrc);
  const current = failed && !fallbackFailed && fallbackSrc && fallbackSrc !== primary
    ? fallbackSrc
    : failed || fallbackFailed ? WAVE_ARTWORK : primary;
  return (
    <img
      {...props}
      src={current}
      onError={(event) => {
        if (!failed) setFailed(true);
        else setFallbackFailed(true);
        props.onError?.(event);
      }}
    />
  );
}
