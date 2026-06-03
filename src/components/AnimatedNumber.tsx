import { useEffect, useRef, useState } from "react";

// Smooth-count animation: cancels in-flight animation and starts fresh toward
// the latest target value. Safe for high-frequency updates (100ms tick rate).
function useAnimatedNumber(value: number, duration: number): number {
  const displayRef = useRef(value);
  const [display, setDisplay] = useState(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (value === displayRef.current) return;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const from = displayRef.current;
    const to = value;
    let startTime: number | null = null;

    const tick = (ts: number) => {
      if (startTime === null) startTime = ts;
      const progress = Math.min((ts - startTime) / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + (to - from) * eased;
      displayRef.current = current;
      setDisplay(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        displayRef.current = to;
        setDisplay(to);
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [value, duration]);

  return display;
}

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  duration?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
  /** Prepend "+" for positive values */
  signed?: boolean;
}

export function AnimatedNumber({
  value,
  decimals = 2,
  duration = 300,
  className,
  prefix,
  suffix,
  signed,
}: AnimatedNumberProps) {
  const display = useAnimatedNumber(value, duration);
  const formatted = display.toFixed(decimals);
  const sign = signed && display >= 0 ? "+" : "";

  return (
    <span className={className}>
      {prefix}{sign}{formatted}{suffix}
    </span>
  );
}
