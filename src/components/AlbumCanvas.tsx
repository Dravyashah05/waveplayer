import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { settingsStore } from '../services/settingsStore';

// Subtle animated artwork layer for Now Playing: slow zoom + drift + gradient
// wash. GPU-cheap (transform/opacity only), gated by the appearance setting
// and prefers-reduced-motion. Static artwork when disabled.

interface Props {
  artwork: string;
  title: string;
  accent?: string;
}

export const AlbumCanvas: React.FC<Props> = ({ artwork, title, accent }) => {
  const reduceMotion = useReducedMotion();
  const [enabled, setEnabled] = useState(() => settingsStore.get().animatedCanvas);

  useEffect(() => {
    const unsub = settingsStore.subscribe(() => setEnabled(settingsStore.get().animatedCanvas));
    return () => {
      unsub();
    };
  }, []);

  if (!artwork) return null;
  if (!enabled || reduceMotion || settingsStore.get().reduceMotion) {
    return (
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <img src={artwork} alt="" className="h-full w-full object-cover opacity-30 blur-[60px] scale-110" loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/20" />
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <motion.img
        src={artwork}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover opacity-35 blur-[60px]"
        initial={{ scale: 1.12 }}
        animate={{ scale: [1.12, 1.22, 1.12], x: [0, -8, 0], y: [0, 6, 0] }}
        transition={{ duration: 36, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute inset-0"
        style={{ background: `radial-gradient(60% 50% at 50% 110%, ${accent || 'rgba(245,158,11,0.16)'}, transparent 70%)` }}
        animate={{ opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/20" />
    </div>
  );
};
