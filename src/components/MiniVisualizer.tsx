import { useEffect, useState } from 'react';

export const MiniVisualizer: React.FC<{ playing: boolean }> = ({ playing }) => {
  const [bars, setBars] = useState<number[]>(() => [4, 8, 12, 6]);
  useEffect(() => {
    if (!playing) { setBars([4, 4, 4, 4]); return; }
    const id = setInterval(() => {
      setBars([
        4 + Math.random() * 12,
        6 + Math.random() * 14,
        8 + Math.random() * 16,
        4 + Math.random() * 12,
      ]);
    }, 110);
    return () => clearInterval(id);
  }, [playing]);
  return (
    <div className="flex items-end gap-[2px] h-3.5 px-1 py-0.5" aria-hidden>
      {bars.map((h, i) => (
        <span
          key={i}
          className="w-[2.5px] rounded-full bg-gradient-to-t from-white/70 via-white to-white transition-all duration-100 ease-out shadow-[0_0_6px_rgba(255,255,255,0.4)]"
          style={{ height: `${h}px`, opacity: playing ? 1 : 0.25 }}
        />
      ))}
    </div>
  );
};
