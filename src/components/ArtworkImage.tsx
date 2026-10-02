import { useState } from 'react';
import type { ImgHTMLAttributes } from 'react';

const WAVE_ARTWORK = '/icon-512.png';

/** Artwork that cannot leave a broken-image box in the player. */
export function ArtworkImage({
  src,
  fallbackSrc,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & { src?: string; fallbackSrc?: string }) {
  const [failed, setFailed] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const primary = src || fallbackSrc || WAVE_ARTWORK;
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
