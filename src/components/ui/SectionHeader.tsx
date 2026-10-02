import React from 'react';
import { ChevronRight } from 'lucide-react';

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionIcon?: React.ReactNode;
  action2Label?: string;
  onAction2?: () => void;
  action2Icon?: React.ReactNode;
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
  actionIcon,
  action2Label,
  onAction2,
  action2Icon,
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
          {icon && (
            <span className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-xl bg-white/[0.08] text-white shrink-0">
              {icon}
            </span>
          )}
          <h2 className="text-[18px] min-[400px]:text-[20px] sm:text-[22px] font-black tracking-[-0.02em] text-white leading-tight truncate">
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

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {action2Label && onAction2 && (
          <button
            type="button"
            onClick={onAction2}
            className="touch-target inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] hover:bg-white text-white/80 hover:text-black border border-white/[0.08] px-3 py-1.5 text-[12px] font-semibold transition-all active:scale-95 shrink-0"
            aria-label={`${action2Label} - ${title}`}
          >
            {action2Icon}
            <span>{action2Label}</span>
          </button>
        )}
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="touch-target group inline-flex items-center gap-1 rounded-full bg-white/[0.06] hover:bg-white text-white/80 hover:text-black border border-white/[0.08] px-3 py-1.5 text-[12px] font-semibold transition-all active:scale-95 shrink-0"
            aria-label={`${actionLabel} - ${title}`}
          >
            {actionIcon}
            <span>{actionLabel}</span>
            <ChevronRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
          </button>
        )}
      </div>
    </div>
  );
};
