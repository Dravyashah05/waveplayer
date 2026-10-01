import {
  X,
  Trash2,
  Play,
  ListMusic,
  Sparkles,
  Plus,
  Music2,
  GripVertical,
  Shuffle,
  Clock3,
  ChevronDown,
  History,
  ArrowUpToLine,
  Trash,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Track } from '../types';
import { useState, useEffect, useMemo } from 'react';
import { settingsStore } from '../services/settingsStore';
import { playerStore } from '../services/playerStore';
import { getUpNext } from '../services/recommendationEngine';
import { fetchAutoplay } from '../services/recommendationApi';
import { isAutoplayEnabled, setAutoplayEnabled, subscribeAutoplay } from '../services/autoplay';

interface Props {
  open: boolean;
  queue: Track[];
  currentIndex: number;
  onClose: () => void;
  onPlayIndex: (i: number) => void;
  onClear: () => void;
  onRemove?: (idx: number) => void;
}

type Tab = 'queue' | 'upnext';

function fmtTotal(seconds: number) {
  if (!seconds || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

export const QueueDrawer: React.FC<Props> = ({ open, queue, currentIndex, onClose, onPlayIndex, onClear, onRemove }) => {
  const [glassIntensity, setGlassIntensity] = useState(() => settingsStore.get().glassIntensity);
  const [glassEnabled, setGlassEnabled] = useState(() => settingsStore.get().glassEnabled);
  const [upNext, setUpNext] = useState<Track[]>([]);
  const [upLoading, setUpLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('queue');
  const [showHistory, setShowHistory] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [autoplay, setAutoplay] = useState(() => isAutoplayEnabled());

  useEffect(() => subscribeAutoplay(() => setAutoplay(isAutoplayEnabled())), []);

  useEffect(() => {
    const unsub = settingsStore.subscribe(() => {
      setGlassIntensity(settingsStore.get().glassIntensity);
      setGlassEnabled(settingsStore.get().glassEnabled);
    });
    return () => { unsub(); };
  }, []);

  // Up Next recompute
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const cur = queue[currentIndex] || playerStore.current() || null;
    if (!cur) {
      setUpNext([]);
      return;
    }
    setUpLoading(true);
    const exclude = new Set(queue.map((t) => t.id));
    // Blend the upcoming tail so Up Next flows toward what's already queued
    const tail = queue.slice(currentIndex + 1, currentIndex + 3);
    // Server endpoint first (YouTube Music relations + ranking), on-device
    // engine as fallback — identical shape either way.
    const serverFirst = (async () => {
      if (!cur.id || !/^[a-zA-Z0-9_-]{11}$/.test(cur.id)) throw new Error('no-yt-id');
      const tracks = await fetchAutoplay(cur as any, [...exclude], 8);
      if (!tracks.length) throw new Error('empty');
      const tailTracks = tail.length ? await getUpNext(cur as any, exclude, 8, tail).catch(() => [] as Track[]) : [];
      const merged = [...tracks];
      for (const t of tailTracks) if (t?.id && !merged.some((m) => m.id === t.id)) merged.push(t);
      return merged.slice(0, 8);
    })();
    serverFirst
      .then((tracks) => {
        if (!cancelled) setUpNext(tracks as Track[]);
      })
      .catch(() => {
        getUpNext(cur as any, exclude, 8, tail)
          .then((tracks) => {
            if (!cancelled) setUpNext(tracks as Track[]);
          })
          .catch(() => {
            if (!cancelled) setUpNext([]);
          });
      })
      .finally(() => {
        if (!cancelled) setUpLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, queue.length, currentIndex, tab]);

  const blurPx = glassEnabled ? Math.round(18 + (glassIntensity / 100) * 26) : 0;
  const bgAlpha = glassEnabled ? (0.72 + (glassIntensity / 100) * 0.16).toFixed(2) : '0.98';
  const totalDuration = useMemo(() => queue.reduce((a, t) => a + (t.durationSeconds || 0), 0), [queue]);
  const now = queue[currentIndex] ?? null;
  const upNextSlice = queue.slice(currentIndex + 1);
  const historySlice = queue.slice(0, currentIndex);
  const remainingDuration = useMemo(() => upNextSlice.reduce((a, t) => a + (t.durationSeconds || 0), 0), [upNextSlice]);

  const handleMove = (from: number, to: number) => {
    if (from === to) return;
    playerStore.moveQueue(from, to);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]"
            style={
              glassEnabled
                ? {
                    backdropFilter: `blur(${Math.max(14, blurPx)}px)`,
                    WebkitBackdropFilter: `blur(${Math.max(14, blurPx)}px)`,
                  }
                : {}
            }
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '100%', opacity: 0.98 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0.98 }}
            transition={{ type: 'spring', damping: 30, stiffness: 380, mass: 0.9 }}
            className="fixed right-0 top-0 z-50 h-[100dvh] w-[96%] max-w-[420px] flex flex-col overflow-hidden rounded-l-[28px] border-y border-l border-white/[0.08] shadow-[-24px_0_80px_rgba(0,0,0,0.72),0_18px_56px_rgba(0,0,0,0.5)]"
            style={
              glassEnabled
                ? {
                    backgroundColor: `rgba(10,10,10,${bgAlpha})`,
                    backdropFilter: `blur(${Math.max(28, blurPx + 8)}px) saturate(180%) brightness(1.08)`,
                    WebkitBackdropFilter: `blur(${Math.max(28, blurPx + 8)}px) saturate(180%) brightness(1.08)`,
                  }
                : { backgroundColor: 'rgba(10,10,10,0.98)' }
            }
          >

            {/* Header */}
            <div
              className="relative shrink-0 border-b border-white/[0.06]"
              style={
                glassEnabled
                  ? {
                      backgroundColor: `rgba(14,14,14,${(0.55 + (glassIntensity / 100) * 0.2).toFixed(2)})`,
                      backdropFilter: `blur(${blurPx}px) saturate(170%) brightness(1.06)`,
                      WebkitBackdropFilter: `blur(${blurPx}px) saturate(170%) brightness(1.06)`,
                    }
                  : { backgroundColor: 'rgba(10,10,10,0.98)' }
              }
            >
              {/* drag handle pill - mobile */}
              <div className="flex justify-center pt-2.5 sm:hidden">
                <span className="h-1 w-9 rounded-full bg-white/20" />
              </div>

              <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-3 sm:px-5 sm:pt-4">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white text-black shadow-[0_8px_20px_rgba(255,255,255,0.14)]">
                    <ListMusic className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="flex items-center gap-2 text-[15px] font-extrabold leading-none tracking-[-0.03em] text-white">
                      Queue
                      {queue.length > 0 && (
                        <span className="inline-flex min-w-[22px] justify-center rounded-full bg-white px-1.5 py-0.5 text-[11px] font-bold leading-none text-black">
                          {queue.length}
                        </span>
                      )}
                    </h3>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-medium text-white/45">
                      {queue.length === 0 ? (
                        'Nothing queued'
                      ) : (
                        <>
                          <span className="inline-flex items-center gap-1">
                            <Clock3 className="h-3 w-3" />
                            {fmtTotal(totalDuration)}
                          </span>
                          <span className="h-1 w-1 rounded-full bg-white/15" />
                          <span className="text-white/60">{currentIndex + 1} of {queue.length}</span>
                          {playerStore.shuffle && (
                            <>
                              <span className="h-1 w-1 rounded-full bg-white/15" />
                              <span className="inline-flex items-center gap-1 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-black">
                                <Shuffle className="h-3 w-3" /> Shuffle
                              </span>
                            </>
                          )}
                        </>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => setAutoplayEnabled(!autoplay)}
                    title={autoplay ? 'Autoplay on — keeps the music going' : 'Autoplay off'}
                    className={`flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors ${autoplay ? 'border-white bg-white text-black shadow' : 'border-white/10 bg-white/[0.06] text-white/70 hover:bg-white hover:text-black hover:border-white'}`}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Autoplay</span>
                  </button>
                  {queue.length > 1 && (
                    <button
                      onClick={() => playerStore.toggleShuffle()}
                      title={playerStore.shuffle ? 'Shuffle on' : 'Shuffle'}
                      className={`flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors ${playerStore.shuffle ? 'border-white bg-white text-black shadow' : 'border-white/10 bg-white/[0.06] text-white/70 hover:bg-white hover:text-black hover:border-white'}`}
                    >
                      <Shuffle className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Shuffle</span>
                    </button>
                  )}
                  {queue.length > 0 && (
                    <button
                      onClick={onClear}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/60 hover:bg-white hover:text-black hover:border-white transition-colors"
                      title="Clear queue"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    onClick={onClose}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black hover:bg-white/90 shadow active:scale-95 transition-all"
                    title="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Tabs — liquid segmented */}
              {queue.length > 0 && (
                <div className="px-4 sm:px-5 pb-3">
                  <div className="flex items-center gap-1 rounded-full border border-white/[0.06] bg-black/30 p-1 backdrop-blur">
                    {(['queue', 'upnext'] as Tab[]).map((t) => (
                      <button
                        key={t}
                        onClick={() => setTab(t)}
                        className={`relative flex-1 rounded-full px-3 py-1.5 text-xs font-bold capitalize transition-colors ${tab === t ? 'bg-white text-black shadow' : 'text-white/55 hover:text-white'}`}
                      >
                        {t === 'queue' ? `Queue • ${queue.length}` : `Up next${upNext.length ? ` • ${upNext.length}` : ''}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
              {queue.length === 0 ? (
                <div className="px-5 py-10">
                  <div className="rounded-[24px] border border-white/[0.06] bg-white/[0.02] p-6 text-center backdrop-blur">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-black shadow-[0_10px_30px_rgba(255,255,255,0.12)]">
                      <Music2 className="h-7 w-7" />
                    </div>
                    <p className="mt-4 text-[15px] font-bold tracking-[-0.02em] text-white">Your queue is empty</p>
                    <p className="mx-auto mt-1 max-w-[26ch] text-sm leading-relaxed text-white/45">
                      Play a track and we&apos;ll keep your session here. Discover also fills Up next automatically.
                    </p>
                    <div className="mt-5 flex flex-col gap-2">
                      <button
                        onClick={onClose}
                        className="mx-auto inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-neutral-100 active:scale-[0.98] shadow"
                      >
                        <Sparkles className="h-4 w-4" /> Browse songs
                      </button>
                      <span className="text-xs font-medium text-white/30">Tip: hit + Queue on any card to add ahead</span>
                    </div>
                  </div>

                  {/* Up next even when empty */}
                  <div className="mt-6">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-white/50">
                        <Sparkles className="h-3.5 w-3.5 text-white/70" /> Made for you
                      </span>
                      {upLoading && <span className="text-xs text-white/30">Loading…</span>}
                    </div>
                    {upNext.length === 0 && !upLoading ? (
                      <div className="mt-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-4 text-center text-sm text-white/40">
                        Play a song to see smart suggestions.
                      </div>
                    ) : (
                      <div className="mt-3 grid gap-2">
                        {upNext.map((t) => (
                          <div
                            key={`empty-up-${t.id}`}
                            className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-2.5 backdrop-blur hover:bg-white/[0.06] transition-colors"
                          >
                            <img src={t.thumbnail} alt={t.title} className="h-11 w-11 rounded-xl object-cover ring-1 ring-white/10 shrink-0" referrerPolicy="no-referrer" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold leading-none text-white">{t.title}</p>
                              <p className="truncate text-xs text-white/45">{t.author}</p>
                            </div>
                            <button
                              onClick={() => playerStore.addToQueue(t)}
                              className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black hover:bg-neutral-100 shrink-0 shadow"
                              title="Add to queue"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : tab === 'upnext' ? (
                <div className="p-4 sm:p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/40">
                      <Sparkles className="h-3.5 w-3.5" /> Up next — auto
                    </h4>
                    {upLoading && <span className="text-xs font-medium text-white/30">Loading…</span>}
                  </div>
                  <p className="text-xs leading-relaxed text-white/40">
                    Based on <span className="font-semibold text-white/70">{now?.title ?? 'your taste'}</span> • Tap + to queue, or play directly.
                  </p>
                  {upNext.length === 0 && !upLoading ? (
                    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 text-center text-sm text-white/40">
                      Nothing suggested right now. Keep listening — we&apos;ll learn your taste.
                    </div>
                  ) : (
                    <motion.div layout className="grid gap-2">
                      {upNext.map((t, idx) => (
                        <motion.div
                          key={`rec-${t.id}-${idx}`}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.03, duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                          className="group flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-2.5 backdrop-blur hover:bg-white/[0.06] hover:border-white/[0.10] transition-colors"
                        >
                          <img src={t.thumbnail} alt={t.title} className="h-12 w-12 shrink-0 rounded-xl object-cover ring-1 ring-white/10" referrerPolicy="no-referrer" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold leading-tight text-white">{t.title}</p>
                            <p className="truncate text-xs text-white/45">{t.author}</p>
                            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/60">
                              <Music2 className="h-3 w-3" /> {t.duration || '—'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => playerStore.addToQueue(t)}
                              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white hover:bg-white hover:text-black transition-colors"
                              title="Add to queue"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => {
                                playerStore.addToQueue(t);
                                const q = playerStore.queue();
                                const found = q.findIndex((q) => q.id === t.id);
                                if (found >= 0) playerStore.setIndex(found);
                              }}
                              className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black hover:bg-neutral-100 shadow transition-colors"
                              title="Play now"
                            >
                              <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
                            </button>
                          </div>
                        </motion.div>
                      ))}
                    </motion.div>
                  )}
                  <div className="rounded-2xl border border-white/[0.06] bg-black/20 p-3.5 flex items-center justify-between backdrop-blur">
                    <p className="text-xs font-medium text-white/50">Continuous playback fills the queue automatically.</p>
                    <button onClick={() => setTab('queue')} className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-black hover:bg-neutral-100">
                      Back to queue
                    </button>
                  </div>
                </div>
              ) : (
                <div className="px-3 py-4 sm:px-4 space-y-5">
                  {/* Now Playing hero */}
                  {now && (
                    <section>
                      <div className="mb-2 flex items-center justify-between px-1">
                        <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
                          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.7)] animate-pulse" /> Now playing
                        </h4>
                        <span className="text-[11px] font-medium text-white/30">{queue.length > 1 ? `${upNextSlice.length} coming up • ${fmtTotal(remainingDuration)} left` : 'End of queue'}</span>
                      </div>
                      <motion.div
                        layout
                        className="group relative overflow-hidden rounded-[20px] border border-white/[0.08] bg-gradient-to-br from-white/[0.08] to-white/[0.02] p-3 backdrop-blur shadow-[0_12px_30px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.06)]"
                      >
                        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.06] via-transparent to-transparent pointer-events-none" />
                        <div className="relative flex gap-3">
                          <div className="relative h-[76px] w-[76px] shrink-0 overflow-hidden rounded-2xl bg-neutral-900 ring-1 ring-white/10 shadow-[0_8px_20px_rgba(0,0,0,0.4)]">
                            <img src={now.thumbnail} alt={now.title} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                            <span className="absolute inset-0 grid place-items-center bg-black/20 backdrop-blur-[1px]">
                              <span className="flex items-end gap-0.5 h-4 rounded-full bg-black/45 px-1.5 py-1 backdrop-blur border border-white/10">
                                <span className="wave-bar !h-2 !w-[3px]" /><span className="wave-bar !h-3 !w-[3px]" /><span className="wave-bar !h-2 !w-[3px]" />
                              </span>
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-sm font-bold leading-tight tracking-[-0.01em] text-white">{now.title}</p>
                            <p className="mt-0.5 truncate text-xs font-medium text-white/55">{now.author}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[10px] font-extrabold tracking-wide text-black">NOW</span>
                              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[11px] font-medium text-white/80">
                                <Clock3 className="h-3 w-3 opacity-70" /> {now.duration || '—'}
                              </span>
                              {now.albumName && (
                                <span className="hidden sm:inline-flex max-w-[14ch] truncate items-center gap-1 rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] font-medium text-white/60">
                                  <Music2 className="h-3 w-3" /> {now.albumName}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="hidden sm:flex flex-col items-end gap-1.5 shrink-0">
                            <button
                              onClick={() => setTab('upnext')}
                              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-white hover:text-black transition-colors"
                            >
                              <Sparkles className="h-3 w-3" /> Up next
                            </button>
                            <span className="text-[11px] font-medium text-white/30">Drag to reorder below</span>
                          </div>
                        </div>
                      </motion.div>
                    </section>
                  )}

                  {/* Next up */}
                  <section>
                    <div className="mb-2 flex items-center justify-between px-1">
                      <h4 className="text-[11px] font-bold uppercase tracking-widest text-white/40">
                        {upNextSlice.length ? `Next up • ${upNextSlice.length}` : 'Next up'}
                      </h4>
                      {upNextSlice.length > 0 && (
                        <span className="text-[11px] font-medium text-white/30">{fmtTotal(remainingDuration)}</span>
                      )}
                    </div>

                    {upNextSlice.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-5 text-center">
                        <p className="text-sm font-semibold text-white">You’re at the end of the queue</p>
                        <p className="mx-auto mt-1 max-w-[28ch] text-xs leading-relaxed text-white/40">
                          Add more from Search or jump to Up next for smart picks. Shuffle fills the gap too.
                        </p>
                        <button
                          onClick={() => setTab('upnext')}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-xs font-bold text-black hover:bg-neutral-100"
                        >
                          <Sparkles className="h-3.5 w-3.5" /> Explore Up next
                        </button>
                      </div>
                    ) : (
                      <motion.div layout className="grid gap-2">
                        {upNextSlice.map((t, offset) => {
                          const realIdx = currentIndex + 1 + offset;
                          const isDragOver = dragOver === realIdx;
                          return (
                            <motion.div
                              key={`${t.id}-${realIdx}`}
                              layout
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -6 }}
                              transition={{ delay: Math.min(offset * 0.02, 0.15), duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                              draggable
                              onDragStart={() => setDragIndex(realIdx)}
                              onDragEnd={() => {
                                if (dragIndex !== null && dragOver !== null && dragIndex !== dragOver) handleMove(dragIndex, dragOver);
                                setDragIndex(null);
                                setDragOver(null);
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                if (dragOver !== realIdx) setDragOver(realIdx);
                              }}
                              onDragLeave={() => setDragOver((cur) => (cur === realIdx ? null : cur))}
                              className={`group relative flex items-center gap-2.5 rounded-2xl border p-2 transition-all ${isDragOver ? 'border-white/20 bg-white/[0.07] shadow-[0_8px_20px_rgba(255,255,255,0.06)] scale-[1.01]' : dragIndex === realIdx ? 'border-white/10 bg-white/[0.05] opacity-60' : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/[0.10]'} backdrop-blur`}
                            >
                              <button
                                className="hidden sm:flex h-8 w-6 shrink-0 cursor-grab items-center justify-center rounded-lg text-white/25 hover:text-white/60 active:cursor-grabbing"
                                title="Drag to reorder"
                                aria-label="Drag to reorder"
                              >
                                <GripVertical className="h-4 w-4" />
                              </button>

                              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-white/10">
                                <img src={t.thumbnail} alt={t.title} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                                <span className="absolute left-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-[10px] font-bold text-white ring-1 ring-white/10 backdrop-blur">
                                  {realIdx + 1}
                                </span>
                                <button
                                  onClick={() => onPlayIndex(realIdx)}
                                  className="absolute inset-0 hidden items-center justify-center bg-black/45 backdrop-blur-[2px] group-hover:flex"
                                  title="Play"
                                >
                                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-black shadow">
                                    <Play className="h-3 w-3 fill-current ml-0.5" />
                                  </span>
                                </button>
                              </div>

                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-semibold leading-tight text-white">{t.title}</p>
                                <p className="truncate text-xs text-white/45">{t.author}</p>
                                <div className="mt-1 flex items-center gap-1">
                                  <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/60">
                                    <Clock3 className="h-3 w-3 opacity-60" /> {t.duration || '—'}
                                  </span>
                                  {offset === 0 && <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-black">Next</span>}
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => onPlayIndex(realIdx)}
                                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black shadow hover:bg-neutral-100 active:scale-95 transition-all sm:hidden"
                                  title="Play"
                                >
                                  <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
                                </button>
                                <button
                                  onClick={() => onPlayIndex(realIdx)}
                                  className="hidden sm:flex h-8 w-8 items-center justify-center rounded-full bg-white text-black shadow hover:bg-neutral-100 active:scale-95 transition-all"
                                  title="Play"
                                >
                                  <Play className="h-3 w-3 fill-current ml-0.5" />
                                </button>
                                <button
                                  onClick={() => {
                                    // move to top (play next)
                                    handleMove(realIdx, currentIndex + 1);
                                  }}
                                  className="hidden lg:flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/60 hover:bg-white hover:text-black hover:border-white transition-colors"
                                  title="Play next"
                                >
                                  <ArrowUpToLine className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => (onRemove ? onRemove(realIdx) : playerStore.removeFromQueue(realIdx))}
                                  className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/60 hover:bg-white hover:text-black hover:border-white transition-colors"
                                  title="Remove"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </motion.div>
                          );
                        })}
                      </motion.div>
                    )}
                  </section>

                  {/* History collapsible */}
                  {historySlice.length > 0 && (
                    <section>
                      <button
                        onClick={() => setShowHistory((v) => !v)}
                        className="flex w-full items-center justify-between rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-left backdrop-blur hover:bg-white/[0.04] transition-colors"
                      >
                        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-white/40">
                          <History className="h-3.5 w-3.5" /> Played • {historySlice.length}
                          <span className="hidden sm:inline font-medium normal-case tracking-normal text-white/25">Tap to {showHistory ? 'hide' : 'show'}</span>
                        </span>
                        <span className={`flex h-7 w-7 items-center justify-center rounded-full border bg-white/[0.06] text-white/50 transition-transform ${showHistory ? 'rotate-180 bg-white text-black border-white' : 'border-white/10'}`}>
                          <ChevronDown className="h-4 w-4" />
                        </span>
                      </button>
                      <AnimatePresence initial={false}>
                        {showHistory && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                            className="overflow-hidden"
                          >
                            <div className="mt-2 grid gap-2">
                              {historySlice
                                .slice()
                                .reverse()
                                .map((t, i) => {
                                  const realIdx = historySlice.length - 1 - i;
                                  return (
                                    <div
                                      key={`h-${t.id}-${realIdx}`}
                                      className="flex items-center gap-2.5 rounded-2xl border border-white/[0.04] bg-white/[0.01] p-2 opacity-75 hover:opacity-100 transition-opacity"
                                    >
                                      <img src={t.thumbnail} alt={t.title} className="h-10 w-10 rounded-xl object-cover ring-1 ring-white/5 shrink-0 grayscale-[0.15]" referrerPolicy="no-referrer" />
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-xs font-semibold text-white/80">{t.title}</p>
                                        <p className="truncate text-[11px] text-white/35">{t.author}</p>
                                      </div>
                                      <button
                                        onClick={() => onPlayIndex(realIdx)}
                                        className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/70 hover:bg-white hover:text-black transition-colors shrink-0"
                                        title="Play again"
                                      >
                                        <Play className="h-3 w-3 fill-current ml-0.5" />
                                      </button>
                                    </div>
                                  );
                                })}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </section>
                  )}
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div className="shrink-0 border-t border-white/[0.06] bg-black/25 backdrop-blur p-3 sm:p-4 pb-[max(12px,env(safe-area-inset-bottom))]">
              {queue.length > 0 && tab === 'queue' ? (
                <div className="space-y-3">
                  {/* quick recommendation strip */}
                  {upNext.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/30">
                          <Sparkles className="h-3 w-3" /> Up next
                        </span>
                        <button onClick={() => setTab('upnext')} className="text-[11px] font-semibold text-white/60 hover:text-white">
                          View all →
                        </button>
                      </div>
                      <div className="mt-2 flex gap-2 overflow-x-auto scrollbar-none pb-1 -mx-1 px-1">
                        {upNext.slice(0, 6).map((t) => (
                          <div key={`strip-${t.id}`} className="flex w-[160px] shrink-0 items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.04] p-2 backdrop-blur">
                            <img src={t.thumbnail} alt={t.title} className="h-10 w-10 rounded-xl object-cover ring-1 ring-white/10 shrink-0" referrerPolicy="no-referrer" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-semibold leading-tight text-white">{t.title}</p>
                              <p className="truncate text-[11px] text-white/40">{t.author}</p>
                            </div>
                            <button onClick={() => playerStore.addToQueue(t)} className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-black hover:bg-neutral-100 shrink-0 shadow">
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.04] px-3 py-2.5 backdrop-blur">
                    <div className="min-w-0">
                      <p className="text-xs font-bold leading-none text-white">{queue.length} tracks • {fmtTotal(totalDuration)}</p>
                      <p className="mt-1 text-[11px] font-medium leading-none text-white/40">Continuous playback • Skip teaches recommendations</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => playerStore.toggleShuffle()}
                        className={`hidden sm:inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold ${playerStore.shuffle ? 'border-white bg-white text-black' : 'border-white/10 bg-white/10 text-white hover:bg-white hover:text-black'}`}
                      >
                        <Shuffle className="h-3.5 w-3.5" /> {playerStore.shuffle ? 'Shuffle on' : 'Shuffle'}
                      </button>
                      <button
                        onClick={onClear}
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-bold text-white/70 hover:bg-white hover:text-black hover:border-white"
                      >
                        <Trash className="h-3.5 w-3.5" /> Clear
                      </button>
                    </div>
                  </div>
                </div>
              ) : queue.length > 0 && tab === 'upnext' ? (
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-white/40">{upNext.length} suggestions • Add to keep music flowing</p>
                  <button onClick={() => setTab('queue')} className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-black hover:bg-neutral-100">
                    Back to queue
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-white/30">Tip: Long-press Queue button to open quickly</span>
                  <button onClick={onClose} className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-black hover:bg-neutral-100">
                    Close
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
