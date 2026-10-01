import React from 'react';

export const GlassPanel: React.FC<React.HTMLAttributes<HTMLDivElement> & { strong?: boolean }> = ({ className = '', strong, ...props }) => (
  <div className={`${strong ? 'glass-strong' : 'glass'} rounded-2xl ${className}`} {...props} />
);

export const GlassCard: React.FC<React.HTMLAttributes<HTMLDivElement> & { hover?: boolean }> = ({ className = '', hover, ...props }) => (
  <div className={`glass-card rounded-xl ${hover ? 'glass-hover cursor-pointer' : ''} ${className}`} {...props} />
);

export const GlassButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'subtle' | 'ghost' }> = ({ variant = 'subtle', className = '', children, ...props }) => {
  const base = 'inline-flex items-center justify-center gap-2 rounded-full text-sm font-semibold transition-all active:scale-[0.98]';
  const styles = {
    primary: 'bg-[#0a0a0c] hover:bg-[#000000] text-white shadow-[0_8px_20px_rgba(10,10,12,0.3)] border border-[#0a0a0c]',
    subtle: 'glass-button text-white border border-white/[0.08] hover:bg-white/[0.12]',
    ghost: 'text-[#aeaeb2] hover:text-white hover:bg-white/[0.06] border border-transparent',
  }[variant];
  return <button className={`${base} ${styles} px-4 py-2 ${className}`} {...props}>{children}</button>;
};

export const GlassNavigation: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = '', ...props }) => (
  <div className={`glass rounded-xl p-1.5 flex gap-1 ${className}`} {...props} />
);

export const GlassPlayer: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = '', ...props }) => (
  <div className={`glass-strong rounded-2xl border border-white/[0.08] ${className}`} {...props} />
);

export const GlassModal: React.FC<React.HTMLAttributes<HTMLDivElement> & { open: boolean; onClose?: () => void }> = ({ open, onClose, className = '', children, ...props }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-xl" onClick={onClose} />
      <div className={`relative glass-panel rounded-2xl max-w-lg w-full max-h-[90vh] overflow-hidden ${className}`} {...props}>
        {children}
      </div>
    </div>
  );
};

export const GlassSidebar: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = '', ...props }) => (
  <div className={`glass rounded-xl overflow-hidden flex flex-col ${className}`} {...props} />
);
