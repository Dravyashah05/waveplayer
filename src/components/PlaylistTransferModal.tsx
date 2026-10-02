import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { X, Check, AlertTriangle, MinusCircle, Loader2, ArrowRight } from 'lucide-react';
import type { Track } from '../types';
import type { ExportPreview } from '../services/playlistTransfer';
import type { ImportPreview } from '../services/youtubeImport';
import { ArtworkImage } from './ArtworkImage';

interface Props {
  isOpen: boolean;
  mode: 'export' | 'import';
  title: string;
  exportPreview?: ExportPreview | null;
  importPreview?: ImportPreview | null;
  busy?: boolean;
  progress?: string;
  error?: string;
  onClose: () => void;
  /** Export: confirmed candidates (matched + user-accepted possible). */
  onConfirmExport?: (confirmedVideoIds: { track: Track; videoId: string }[]) => void;
  /** Import: accepted possible positions + unmatched opt-in. */
  onConfirmImport?: (acceptedPossible: Set<number>, includeUnmatched: boolean) => void;
}

/**
 * Playlist Experience 2.0 — explicit match preview.
 * Shows ✓ matched / ⚠ possible / × not-found with per-possible choice.
 * Nothing transfers until the user confirms; low-confidence matches are
 * never silently selected.
 */
export const PlaylistTransferModal: React.FC<Props> = ({
  isOpen, mode, title, exportPreview, importPreview, busy, progress, error, onClose,
  onConfirmExport, onConfirmImport,
}) => {
  const reduceMotion = useReducedMotion();
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [includeUnmatched, setIncludeUnmatched] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setAccepted(new Set());
      setIncludeUnmatched(false);
    }
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen || busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, busy, onClose]);

  const counts = useMemo(() => {
    if (mode === 'export' && exportPreview) {
      return {
        matched: exportPreview.matched.length,
        possible: exportPreview.possible.length,
        unmatched: exportPreview.unmatched.length,
      };
    }
    if (mode === 'import' && importPreview) {
      return {
        matched: importPreview.matched.length,
        possible: importPreview.possible.length,
        unmatched: importPreview.unmatched.length,
      };
    }
    return { matched: 0, possible: 0, unmatched: 0 };
  }, [mode, exportPreview, importPreview]);

  if (!isOpen) return null;

  const togglePossible = (pos: number) => {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(pos)) next.delete(pos);
      else next.add(pos);
      return next;
    });
  };

  const confirmExport = () => {
    if (!exportPreview) return;
    // Only tracks with a real video id are ever sent. Possible rows carry
    // no id, so accepting them cannot silently add a wrong video — they
    // are listed for transparency only.
    const confirmed = exportPreview.matched
      .filter((c) => c.videoId)
      .map((c) => ({ track: c.track, videoId: c.videoId! }));
    onConfirmExport?.(confirmed);
  };

  const confirmImport = () => {
    onConfirmImport?.(accepted, includeUnmatched);
  };

  const possibleRows =
    mode === 'export' && exportPreview
      ? exportPreview.possible.map((c) => ({
          key: hashStr(c.track.id),
          title: c.track.title,
          sub: `${c.track.author} • ${c.reason}`,
          thumb: c.track.thumbnail,
        }))
      : mode === 'import' && importPreview
        ? importPreview.possible.map((m) => ({
            key: m.position,
            title: m.title,
            sub: `${m.channelTitle} → ${m.matchedTrack?.title || 'candidate'} • ${m.reason}`,
            thumb: m.thumbnail,
          }))
        : [];

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-md"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'export' ? 'Export to YouTube Music' : 'Import to Wave'}
      >
        <motion.div
          initial={reduceMotion ? undefined : { opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
          className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded-[24px] border border-white/10 bg-[#141416] shadow-2xl flex flex-col"
        >
          <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
            <div className="min-w-0">
              <h2 className="truncate text-[15px] font-bold text-white">
                {mode === 'export' ? 'Export to YouTube Music' : 'Import to Wave'}
              </h2>
              <p className="truncate text-xs text-white/50">{title}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close transfer preview"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/60 hover:bg-white/15 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-2 px-5 pt-4 text-xs font-semibold" role="status">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-emerald-300">
              <Check className="h-3 w-3" /> {counts.matched} matched
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-amber-300">
              <AlertTriangle className="h-3 w-3" /> {counts.possible} possible
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-white/60">
              <MinusCircle className="h-3 w-3" /> {counts.unmatched} not found
            </span>
          </div>

          {possibleRows.length > 0 && (
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">
                {mode === 'export' ? 'Needs attention — not exported' : 'Possible matches — review each one'}
              </p>
              {possibleRows.map((row) => {
                if (mode === 'export') {
                  return (
                    <div
                      key={row.key}
                      className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5"
                    >
                      <ArtworkImage src={row.thumb} alt="" loading="lazy" decoding="async" className="h-9 w-9 rounded-lg object-cover bg-white/5 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-white">{row.title}</span>
                        <span className="block truncate text-[11px] text-white/45">{row.sub}</span>
                      </span>
                    </div>
                  );
                }
                const on = accepted.has(row.key);
                return (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => togglePossible(row.key)}
                    aria-pressed={on}
                    className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-colors ${
                      on ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-white/10 bg-white/[0.03] hover:border-white/25'
                    }`}
                  >
                    <ArtworkImage src={row.thumb} alt="" loading="lazy" decoding="async" className="h-9 w-9 rounded-lg object-cover bg-white/5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-white">{row.title}</span>
                      <span className="block truncate text-[11px] text-white/45">{row.sub}</span>
                    </span>
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full shrink-0 ${
                        on ? 'bg-emerald-500 text-black' : 'bg-white/10 text-white/50'
                      }`}
                      aria-hidden="true"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {mode === 'import' && (
            <label className="flex cursor-pointer items-center gap-2.5 px-5 py-2 text-xs text-white/60">
              <input
                type="checkbox"
                checked={includeUnmatched}
                onChange={(e) => setIncludeUnmatched(e.target.checked)}
                className="h-4 w-4 accent-white"
              />
              Also import {counts.unmatched} unmatched track{counts.unmatched === 1 ? '' : 's'} as YouTube fallbacks
            </label>
          )}

          {mode === 'export' && (
            <p className="px-5 py-2 text-[11px] leading-relaxed text-white/45">
              Only checked tracks with a YouTube video id are added. Possible matches without an id are never
              exported silently — pick them only if you know the video.
            </p>
          )}

          {error && (
            <p role="alert" className="px-5 py-1 text-xs font-medium text-rose-300">
              {error}
            </p>
          )}
          {busy && (
            <p role="status" className="flex items-center gap-2 px-5 py-1 text-xs text-white/60">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {progress || 'Working…'}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-full px-4 py-2 text-xs font-semibold text-white/60 hover:text-white disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={mode === 'export' ? confirmExport : confirmImport}
              disabled={busy || (mode === 'export' && counts.matched === 0) || (mode === 'import' && counts.matched + accepted.size + (includeUnmatched ? counts.unmatched : 0) === 0)}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2 text-xs font-bold text-black hover:bg-white/90 disabled:opacity-40"
            >
              {mode === 'export' ? 'Create YouTube playlist' : 'Create Wave playlist'} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}

