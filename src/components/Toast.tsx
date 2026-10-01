import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Info, AlertTriangle } from 'lucide-react';

export type Toast = { id: string; message: string; type?: 'success' | 'info' | 'error' };
let push: ((t: Toast) => void) | null = null;
export const toast = {
  success: (m: string) => push?.({ id: Math.random().toString(36).slice(2), message: m, type: 'success' }),
  info: (m: string) => push?.({ id: Math.random().toString(36).slice(2), message: m, type: 'info' }),
  error: (m: string) => push?.({ id: Math.random().toString(36).slice(2), message: m, type: 'error' }),
};

export const ToastViewport: React.FC = () => {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    push = (t) => {
      setItems((v) => [...v, t]);
      setTimeout(() => setItems((v) => v.filter((x) => x.id !== t.id)), 2600);
    };
    return () => { push = null; };
  }, []);
  return (
    <div className="fixed bottom-[96px] lg:bottom-6 left-1/2 -translate-x-1/2 z-[60] pointer-events-none flex flex-col items-center gap-2 w-full max-w-sm px-4 safe-bottom">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            className={`pointer-events-auto inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-[0_12px_40px_rgba(0,0,0,0.4)] backdrop-blur-xl ${
              t.type === 'success' ? 'bg-white text-neutral-900 border-white' : t.type === 'error' ? 'bg-rose-500 text-white border-rose-500' : 'bg-neutral-900 text-white border-white/[0.08] glass'
            }`}
          >
            {t.type === 'success' ? <Check className="h-4 w-4" /> : t.type === 'error' ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
