import { useRef, useEffect, useState } from 'react';

export const MarqueeText: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const check = () => {
      const c = containerRef.current;
      const t = textRef.current;
      if (!c || !t) return;
      setOverflows(t.scrollWidth > c.clientWidth + 4);
    };
    check();
    const ro = new ResizeObserver(check);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', check);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', check);
    };
  }, [text]);

  if (!overflows) {
    return (
      <div ref={containerRef} className="min-w-0 overflow-hidden whitespace-nowrap block">
        <p ref={textRef as any} className={`${className || ''} truncate whitespace-nowrap overflow-hidden text-ellipsis block`} style={{ whiteSpace: 'nowrap', textWrap: 'nowrap' as any }}>{text}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="marquee min-w-0 flex-1 overflow-hidden whitespace-nowrap block">
      <div className="marquee__track whitespace-nowrap flex-nowrap">
        <span ref={textRef} className={`${className || ''} whitespace-nowrap inline-block pr-12 shrink-0`} style={{ whiteSpace: 'nowrap' }}>{text}</span>
        <span aria-hidden className={`${className || ''} whitespace-nowrap inline-block pr-12 shrink-0`} style={{ whiteSpace: 'nowrap' }}>{text}</span>
      </div>
    </div>
  );
};
