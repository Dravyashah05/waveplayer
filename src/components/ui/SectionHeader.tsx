import React from 'react';
import { ChevronRight } from 'lucide-react';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
  badge?: string;
  className?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  subtitle,
  eyebrow,
  actionLabel,
  onAction,
  icon,
  badge,
  className = '',
}) => {
  return (
    <div className={`flex items-end justify-between gap-3 mb-3 sm:mb-4 px-0.5 ${className}`}>
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <p className="eyebrow mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-white/50">
            {eyebrow}
          </p>
        )}
        <div className="flex items-center gap-2">
          {icon && <span className="text-white/70 shrink-0">{icon}</span>}
          <h2 className="text-[18px] min-[400px]:text-[20px] sm:text-[22px] font-bold tracking-[-0.02em] text-white leading-tight truncate">
            {title}
          </h2>
          {badge && (
            <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/80">
              {badge}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="caption mt-0.5 text-xs sm:text-[13px] text-white/60 truncate">
            {subtitle}
          </p>
        )}
      </div>

      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="group inline-flex items-center gap-1 text-[12px] sm:text-[13px] font-semibold text-white/60 hover:text-white transition-colors touch-target px-2 -mr-2 shrink-0 select-none active:scale-95"
          aria-label={`${actionLabel} - ${title}`}
        >
          <span>{actionLabel}</span>
          <ChevronRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        </button>
      )}
    </div>
  );
};
