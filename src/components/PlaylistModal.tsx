import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ListMusic, Loader2 } from 'lucide-react';

export interface PlaylistModalValue {
  title: string;
  description: string;
  privacyStatus: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
}

interface PlaylistModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initial?: Partial<PlaylistModalValue>;
  busy?: boolean;
  serverError?: string | null;
  onClose: () => void;
  onSubmit: (value: PlaylistModalValue) => void;
}

const PRIVACY: Array<{ id: PlaylistModalValue['privacyStatus']; label: string; hint: string }> = [
  { id: 'PRIVATE', label: 'Private', hint: 'Only you' },
  { id: 'UNLISTED', label: 'Unlisted', hint: 'Link only' },
  { id: 'PUBLIC', label: 'Public', hint: 'Everyone' },
];

export const PlaylistModal: React.FC<PlaylistModalProps> = ({
  isOpen,
  mode,
  initial,
  busy,
  serverError,
  onClose,
  onSubmit,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [privacy, setPrivacy] = useState<PlaylistModalValue['privacyStatus']>('PRIVATE');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setTitle(initial?.title || '');
      setDescription(initial?.description || '');
      setPrivacy(initial?.privacyStatus || 'PRIVATE');
      setError('');
    }
  }, [isOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = title.trim();
    if (!name) {
      setError('Give your playlist a name.');
      return;
    }
    if (name.length > 150) {
      setError('Keep the name under 150 characters.');
      return;
    }
    onSubmit({ title: name, description: description.trim().slice(0, 5000), privacyStatus: privacy });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 backdrop-blur-md p-4 safe-bottom safe-top" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 10 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-[24px] border border-white/10 bg-[#121214]/95 shadow-[0_24px_64px_rgba(0,0,0,0.8)] backdrop-blur-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'create' ? 'Create playlist' : 'Edit playlist'}
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black">
              <ListMusic className="h-4 w-4" />
            </span>
            <h3 className="text-[15px] font-bold tracking-tight text-white">
              {mode === 'create' ? 'Create playlist' : 'Edit playlist'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/60 hover:bg-white/15 hover:text-white transition-colors"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label htmlFor="plm-title" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-white/50">
              Name
            </label>
            <input
              id="plm-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My Chill Mix"
              autoFocus
              maxLength={150}
              className="w-full rounded-xl bg-black/40 border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30"
            />
          </div>

          <div>
            <label htmlFor="plm-desc" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-white/50">
              Description <span className="font-medium normal-case text-white/30">(optional)</span>
            </label>
            <textarea
              id="plm-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this playlist for?"
              rows={2}
              maxLength={5000}
              className="w-full resize-none rounded-xl bg-black/40 border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30"
            />
          </div>

          <fieldset>
            <legend className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-white/50">Visibility</legend>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Visibility">
              {PRIVACY.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={privacy === p.id}
                  onClick={() => setPrivacy(p.id)}
                  className={`rounded-xl border px-2 py-2 text-center transition-all ${
                    privacy === p.id
                      ? 'border-white bg-white text-black shadow'
                      : 'border-white/10 bg-white/[0.04] text-white/70 hover:border-white/25 hover:text-white'
                  }`}
                >
                  <span className="block text-xs font-bold">{p.label}</span>
                  <span className={`block text-[10px] ${privacy === p.id ? 'text-black/60' : 'text-white/40'}`}>{p.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {(error || serverError) && (
            <p role="alert" className="text-xs font-medium text-rose-300">
              {error || serverError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={!!busy}
              className="rounded-full px-4 py-2 text-xs font-semibold text-white/60 hover:text-white disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !title.trim()}
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-xs font-bold text-black hover:bg-white/90 disabled:opacity-40 shadow-sm"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {mode === 'create' ? 'Create Playlist' : 'Save Changes'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};
