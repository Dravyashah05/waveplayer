import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BookOpen,
  Sparkles,
  Award,
  TrendingUp,
  Heart,
  Trophy,
  Disc3,
  Quote,
  ChevronDown,
  ChevronUp,
  Music2,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Search,
} from 'lucide-react';

export interface BioSection {
  title: string;
  sequence: number;
  text: string;
  paragraphs?: string[];
  listItems?: { number?: number; title: string; subtitle?: string }[];
}

/**
 * Clean malformed UTF-8/Latin-1 mojibake characters returned from legacy APIs
 */
export function fixMojibake(text: string): string {
  if (!text) return '';
  return text
    .replace(/\\u00e2\\u20ac\\u02dc/g, '‘')
    .replace(/\\u00e2\\u20ac\\u2122/g, '’')
    .replace(/\\u00e2\\u20ac\\u0153/g, '“')
    .replace(/\\u00e2\\u20ac\\u009d/g, '”')
    .replace(/\\u00e2\\u20ac\\u201c/g, '–')
    .replace(/\\u00e2\\u20ac\\u201d/g, '—')
    .replace(/\\u00e2\\u20ac\\u00a6/g, '…')
    .replace(/â€˜/g, '‘')
    .replace(/â€™/g, '’')
    .replace(/â€œ/g, '“')
    .replace(/â€\u009d/g, '”')
    .replace(/â€“/g, '–')
    .replace(/â€”/g, '—')
    .replace(/â€¦/g, '…')
    .replace(/â€˜/g, '‘')
    .replace(/â€™/g, '’')
    .replace(/â€œ/g, '“')
    .replace(/â€/g, '”')
    .replace(/â€“/g, '–')
    .replace(/â€”/g, '—')
    .replace(/â€¦/g, '…')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * Parses raw artist bio input (JSON string, JSON array, or plain text)
 */
export function parseArtistBio(rawBio: string | any): BioSection[] {
  if (!rawBio) return [];

  let data: any = rawBio;

  if (typeof rawBio === 'string') {
    const trimmed = rawBio.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        data = JSON.parse(trimmed);
      } catch {
        // Not valid JSON, fallback to plain text
      }
    }
  }

  // If parsed data is an array of sections
  if (Array.isArray(data)) {
    return data
      .map((item, idx) => {
        const title = fixMojibake(item.title || `Chapter ${idx + 1}`);
        const text = fixMojibake(item.text || '');
        const sequence = typeof item.sequence === 'number' ? item.sequence : idx + 1;

        // Check if text is a numbered list (e.g. Top 10 Songs)
        const rawLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const isList =
          rawLines.length >= 2 &&
          rawLines.some((l) => /^\d+[\.\)]\s+/.test(l));

        if (isList) {
          const listItems = rawLines.map((l, lIdx) => {
            const match = l.match(/^(\d+)[\.\)]\s*(.*)$/);
            const full = match ? match[2] : l;
            const parts = full.split(/\s*-\s*|\s*–\s*/);
            return {
              number: match ? parseInt(match[1], 10) : lIdx + 1,
              title: parts[0]?.trim() || full,
              subtitle: parts[1]?.trim() || undefined,
            };
          });

          return {
            title,
            sequence,
            text,
            listItems,
          };
        }

        // Split regular text into paragraphs
        const paragraphs = text
          .split(/\r?\n\r?\n|\r?\n/)
          .map((p) => p.trim())
          .filter(Boolean);

        return {
          title,
          sequence,
          text,
          paragraphs: paragraphs.length > 0 ? paragraphs : [text],
        };
      })
      .sort((a, b) => a.sequence - b.sequence);
  }

  // Single plain string bio
  if (typeof rawBio === 'string') {
    const clean = fixMojibake(rawBio);
    const paragraphs = clean
      .split(/\r?\n\r?\n|\r?\n/)
      .map((p) => p.trim())
      .filter(Boolean);

    return [
      {
        title: 'Biography & Overview',
        sequence: 1,
        text: clean,
        paragraphs,
      },
    ];
  }

  return [];
}

interface ArtistBioProps {
  bio: string | any;
  artistName?: string;
  onNavigate?: (page: string, param?: string) => void;
}

export const ArtistBio: React.FC<ArtistBioProps> = ({ bio, artistName = 'Artist', onNavigate }) => {
  const sections = parseArtistBio(bio);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [expanded, setExpanded] = useState<boolean>(false);

  if (!sections.length) return null;

  const getSectionIcon = (title: string) => {
    const t = title.toLowerCase();
    if (t.includes('intro') || t.includes('about')) return <Sparkles className="h-4 w-4 text-purple-400" />;
    if (t.includes('career') || t.includes('early') || t.includes('journey')) return <TrendingUp className="h-4 w-4 text-emerald-400" />;
    if (t.includes('marriage') || t.includes('personal') || t.includes('life')) return <Heart className="h-4 w-4 text-pink-400" />;
    if (t.includes('top') || t.includes('song') || t.includes('hit') || t.includes('discography')) return <Trophy className="h-4 w-4 text-amber-400" />;
    return <BookOpen className="h-4 w-4 text-cyan-400" />;
  };

  const getSectionTheme = (title: string) => {
    const t = title.toLowerCase();
    if (t.includes('intro') || t.includes('about')) {
      return {
        badge: 'bg-purple-500/15 text-purple-300 border-purple-500/25',
        border: 'border-purple-500/20 hover:border-purple-500/40',
        glow: 'from-purple-500/10 via-transparent to-transparent',
      };
    }
    if (t.includes('career') || t.includes('early')) {
      return {
        badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
        border: 'border-emerald-500/20 hover:border-emerald-500/40',
        glow: 'from-emerald-500/10 via-transparent to-transparent',
      };
    }
    if (t.includes('marriage') || t.includes('personal')) {
      return {
        badge: 'bg-pink-500/15 text-pink-300 border-pink-500/25',
        border: 'border-pink-500/20 hover:border-pink-500/40',
        glow: 'from-pink-500/10 via-transparent to-transparent',
      };
    }
    if (t.includes('top') || t.includes('song') || t.includes('hit')) {
      return {
        badge: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
        border: 'border-amber-500/20 hover:border-amber-500/40',
        glow: 'from-amber-500/10 via-transparent to-transparent',
      };
    }
    return {
      badge: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25',
      border: 'border-cyan-500/20 hover:border-cyan-500/40',
      glow: 'from-cyan-500/10 via-transparent to-transparent',
    };
  };

  const filteredSections =
    activeFilter === 'all'
      ? sections
      : sections.filter((s) => s.title.toLowerCase() === activeFilter.toLowerCase());

  // Show first 2 sections if not expanded and there are more than 2
  const visibleSections =
    expanded || activeFilter !== 'all' || sections.length <= 2
      ? filteredSections
      : filteredSections.slice(0, 2);

  return (
    <div className="space-y-6 pt-4">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-[0.08em] bg-purple-500/15 text-purple-300 border border-purple-500/25">
            <Sparkles className="h-3 w-3" /> Editorial Biography
          </div>
          <h2 className="mt-2 text-[20px] sm:text-[24px] font-black tracking-[-0.02em] text-white">
            About {artistName}
          </h2>
          <p className="mt-0.5 text-[13px] text-[#86868b]">
            Life story, career milestones, awards, and musical heritage
          </p>
        </div>

        {/* Section Quick-Filter Pills */}
        {sections.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-full bg-white/[0.04] border border-white/[0.08] backdrop-blur-md self-start sm:self-center">
            <button
              type="button"
              onClick={() => setActiveFilter('all')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                activeFilter === 'all'
                  ? 'bg-white text-black shadow-sm'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              All Chapters
            </button>
            {sections.map((s) => (
              <button
                key={s.sequence}
                type="button"
                onClick={() => setActiveFilter(s.title)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                  activeFilter.toLowerCase() === s.title.toLowerCase()
                    ? 'bg-purple-500 text-white shadow-sm'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                {s.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid of Section Story Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <AnimatePresence mode="popLayout">
          {visibleSections.map((section) => {
            const theme = getSectionTheme(section.title);
            const isTopSongs = section.listItems && section.listItems.length > 0;

            return (
              <motion.div
                key={section.sequence}
                layout
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className={`relative overflow-hidden rounded-[24px] bg-[#0c0c0e]/85 backdrop-blur-xl border ${
                  theme.border
                } p-6 shadow-[0_12px_36px_rgba(0,0,0,0.5)] transition-all flex flex-col justify-between ${
                  isTopSongs ? 'md:col-span-2' : ''
                }`}
              >
                {/* Ambient dynamic gradient wash */}
                <div
                  className={`absolute top-0 right-0 w-72 h-72 rounded-full bg-gradient-to-b ${theme.glow} blur-[60px] pointer-events-none`}
                />

                <div className="relative z-10 space-y-4">
                  {/* Card Header */}
                  <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.06] border border-white/[0.08] shadow-inner">
                        {getSectionIcon(section.title)}
                      </div>
                      <h3 className="text-[17px] font-bold text-white tracking-[-0.01em]">
                        {section.title}
                      </h3>
                    </div>

                    <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/50 border border-white/[0.06]">
                      Chapter {section.sequence}
                    </span>
                  </div>

                  {/* Top 10 Songs List View */}
                  {isTopSongs && section.listItems ? (
                    <div className="space-y-3 pt-1">
                      <p className="text-xs font-medium text-white/60">
                        Recognized career anthems and record-breaking singles:
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                        {section.listItems.map((item, i) => (
                          <div
                            key={i}
                            onClick={() => onNavigate?.('search', `${item.title} ${artistName}`)}
                            className="group/item flex items-center justify-between p-3 rounded-[16px] bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] hover:border-amber-500/30 transition-all cursor-pointer shadow-sm"
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 font-mono text-xs font-bold group-hover/item:bg-amber-500 group-hover/item:text-black transition-colors">
                                {String(item.number || i + 1).padStart(2, '0')}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-bold text-white group-hover/item:text-amber-200 transition-colors">
                                  {item.title}
                                </p>
                                {item.subtitle && (
                                  <p className="text-[11px] text-[#86868b] mt-0.5 flex items-center gap-1">
                                    <Calendar className="h-2.5 w-2.5" /> {item.subtitle}
                                  </p>
                                )}
                              </div>
                            </div>
                            <Search className="h-3.5 w-3.5 text-white/30 group-hover/item:text-white transition-colors shrink-0" />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    /* Regular Prose Paragraphs */
                    <div className="space-y-3.5 text-[13.5px] sm:text-[14px] text-white/80 leading-[1.75] font-normal">
                      {section.paragraphs?.map((p, pIdx) => (
                        <p key={pIdx} className="text-justify sm:text-left">
                          {pIdx === 0 && section.sequence === 1 ? (
                            <span className="relative font-medium text-white/95">
                              {p}
                            </span>
                          ) : (
                            p
                          )}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer Highlights */}
                <div className="relative z-10 mt-5 pt-3 border-t border-white/[0.04] flex items-center justify-between text-[11px] text-white/40">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-purple-400" /> Verified Discography Info
                  </span>
                  <span>JioSaavn Official Archive</span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Expand / Collapse Button if multiple sections */}
      {sections.length > 2 && activeFilter === 'all' && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-xs font-bold text-white transition-all shadow-md active:scale-95"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-4 w-4" /> Collapse Biography Chapters
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4" /> Read All {sections.length} Chapters & Stories
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
