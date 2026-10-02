import React, { useEffect, useState, useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { extractPalette, DEFAULT_PALETTE, type ArtworkPalette } from '../../services/artworkPalette';
import { settingsStore } from '../../services/settingsStore';

interface ArtworkBackgroundProps {
  thumbnail?: string | null;
  enabled?: boolean;
}

export const ArtworkBackground: React.FC<ArtworkBackgroundProps> = ({
  thumbnail,
  enabled = true,
}) => {
  const [palette, setPalette] = useState<ArtworkPalette>(DEFAULT_PALETTE);
  const [glassEnabled, setGlassEnabled] = useState(() => settingsStore.get().glassEnabled);
  const [glassIntensity, setGlassIntensity] = useState(() => settingsStore.get().glassIntensity);
  const [dynamicColors, setDynamicColors] = useState(() => settingsStore.get().dynamicColors);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const unsub = settingsStore.subscribe(() => {
      const s = settingsStore.get();
      setGlassEnabled(s.glassEnabled);
      setGlassIntensity(s.glassIntensity);
      setDynamicColors(s.dynamicColors);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let active = true;
    if (!thumbnail || !dynamicColors) {
      setPalette(DEFAULT_PALETTE);
      return;
    }

    extractPalette(thumbnail)
      .then((p) => {
        if (active) setPalette(p);
      })
      .catch(() => {
        if (active) setPalette(DEFAULT_PALETTE);
      });

    return () => {
      active = false;
    };
  }, [thumbnail, dynamicColors]);

  const blurAmount = useMemo(() => {
    if (!glassEnabled) return 64;
    return Math.round(48 + (glassIntensity / 100) * 32);
  }, [glassEnabled, glassIntensity]);

  const overlayBg = useMemo(() => {
    if (!glassEnabled) return 'rgba(0, 0, 0, 0.76)';
    const alpha = (0.78 - (glassIntensity / 100) * 0.18).toFixed(2);
    return `rgba(0, 0, 0, ${alpha})`;
  }, [glassEnabled, glassIntensity]);

  if (!enabled) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 -z-20 overflow-hidden select-none"
      aria-hidden="true"
    >
      {/* 1. Dynamic cover artwork blur layer */}
      {thumbnail && (
        <motion.div
          key={thumbnail}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 1.08 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-0"
        >
          <img
            src={thumbnail}
            alt=""
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover scale-125"
            style={{
              filter: `blur(${blurAmount}px) saturate(140%)`,
              opacity: glassEnabled ? 0.24 : 0.16,
              transform: 'translate3d(0, 0, 0)',
            }}
          />
        </motion.div>
      )}

      {/* 2. Color gradient orbs derived from palette */}
      {dynamicColors && thumbnail && (
        <motion.div
          animate={{
            backgroundColor: palette.primary,
          }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
          className="absolute -top-32 -left-20 h-[360px] w-[360px] sm:h-[500px] sm:w-[500px] rounded-full blur-[140px] opacity-15"
        />
      )}

      {/* 3. Dark contrast overlay for guaranteed text legibility */}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: overlayBg,
        }}
      />

      {/* 4. Smooth vignette & bottom depth gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/80" />
    </div>
  );
};
