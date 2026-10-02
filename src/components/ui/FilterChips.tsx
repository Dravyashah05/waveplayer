import React from 'react';
import { motion } from 'motion/react';

export interface FilterChipItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

interface FilterChipsProps {
  items: FilterChipItem[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
  layoutIdPrefix?: string;
}

export const FilterChips: React.FC<FilterChipsProps> = ({
  items,
  activeId,
  onChange,
  className = '',
  layoutIdPrefix = 'filter-chip',
}) => {
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={`flex items-center gap-2 overflow-x-auto scrollbar-none py-1 -mx-1 px-1 snap-x snap-mandatory ${className}`}
    >
      {items.map((item) => {
        const isActive = activeId === item.id;
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            type="button"
            onClick={() => onChange(item.id)}
            className={`relative inline-flex items-center gap-1.5 rounded-full px-3.5 sm:px-4 py-2 text-[13px] font-semibold tracking-[-0.01em] transition-all shrink-0 snap-start select-none touch-target min-h-[44px] ${
              isActive
                ? 'text-black shadow-[0_2px_12px_rgba(255,255,255,0.18)]'
                : 'bg-white/[0.06] hover:bg-white/[0.10] text-white/70 hover:text-white border border-white/[0.08]'
            }`}
          >
            {isActive && (
              <motion.div
                layoutId={`${layoutIdPrefix}-active`}
                className="absolute inset-0 rounded-full bg-white"
                transition={{ type: 'spring', stiffness: 450, damping: 35 }}
              />
            )}
            {item.icon && (
              <span className={`relative z-10 ${isActive ? 'text-black' : 'text-white/60'}`}>
                {item.icon}
              </span>
            )}
            <span className="relative z-10 leading-none">{item.label}</span>
            {typeof item.count === 'number' && item.count > 0 && (
              <span
                className={`relative z-10 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                  isActive ? 'bg-black/15 text-black' : 'bg-white/10 text-white/60'
                }`}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
