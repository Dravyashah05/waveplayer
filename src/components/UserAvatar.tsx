import React, { useState } from 'react';
import { UserRound } from 'lucide-react';
import { GoogleAccountUser } from '../hooks/useGoogleAccount';

interface UserAvatarProps {
  user?: GoogleAccountUser | null;
  sizeClass?: string;
  iconSizeClass?: string;
  textSizeClass?: string;
  showStatus?: boolean;
  className?: string;
  ring?: boolean;
}

export function getInitials(name?: string, email?: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    return parts[0][0].toUpperCase();
  }
  if (email && email.trim()) {
    return email.trim()[0].toUpperCase();
  }
  return 'W';
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  user,
  sizeClass = 'h-12 w-12',
  iconSizeClass = 'h-5 w-5',
  textSizeClass = 'text-base font-bold',
  showStatus = false,
  className = '',
  ring = true,
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const initials = getInitials(user?.name, user?.email);
  const hasPicture = Boolean(user?.picture && !imgFailed);

  return (
    <div className={`relative shrink-0 select-none ${sizeClass} ${className}`}>
      <div
        className={`w-full h-full rounded-full overflow-hidden flex items-center justify-center ${
          ring ? 'ring-1 ring-white/20 shadow-[0_4px_16px_rgba(0,0,0,0.3)]' : ''
        } ${
          user
            ? 'bg-gradient-to-tr from-[#242428] via-[#1f1f22] to-[#323238] text-white'
            : 'bg-white/10 text-white/70'
        }`}
      >
        {hasPicture ? (
          <img
            src={user!.picture}
            alt={user?.name || 'User Profile'}
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
          />
        ) : user?.name || user?.email ? (
          <span className={`${textSizeClass} tracking-tight select-none font-extrabold text-white`}>
            {initials}
          </span>
        ) : (
          <UserRound className={iconSizeClass} />
        )}
      </div>

      {showStatus && user && (
        <span
          className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-emerald-500 ring-2 ring-[#121212]"
          title="Google Connected"
        />
      )}
    </div>
  );
};
