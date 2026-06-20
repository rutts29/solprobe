"use client";

import { useId, useMemo } from "react";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  /** CSS color or var(...) reference. Stroke uses this; fill uses color-mix. */
  stroke?: string;
  strokeWidth?: number;
  /** 0..1, opacity of the area fill. Set to 0 for line-only. */
  fillOpacity?: number;
  className?: string;
}

/**
 * Tiny pure-SVG sparkline. No deps. Theme-safe.
 * Fill is derived from stroke via color-mix in oklch — works in both light and dark.
 */
export function Sparkline({
  data,
  width = 80,
  height = 24,
  stroke = "var(--brand)",
  strokeWidth = 1.5,
  fillOpacity = 0.14,
  className,
}: SparklineProps) {
  const clipId = `sparkline-${useId().replaceAll(":", "")}`;
  const { d, area } = useMemo(() => {
    if (!data || data.length < 2) return { d: "", area: "" };
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const inset = Math.max(strokeWidth, 1);
    const innerWidth = Math.max(1, width - inset * 2);
    const innerHeight = Math.max(1, height - inset * 2);
    const stepX = innerWidth / (data.length - 1);
    const points = data.map((v, i) => {
      const x = inset + i * stepX;
      const y = inset + innerHeight - ((v - min) / range) * innerHeight;
      return [x, y] as const;
    });
    const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
    const filled = `${line} L${width - inset} ${height - inset} L${inset} ${height - inset} Z`;
    return { d: line, area: filled };
  }, [data, width, height, strokeWidth]);

  if (!d) return <svg width={width} height={height} className={className} />;

  const fill = `color-mix(in oklch, ${stroke} ${Math.round(fillOpacity * 100)}%, transparent)`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className}>
      <clipPath id={clipId}>
        <rect x="0" y="0" width={width} height={height} />
      </clipPath>
      {fillOpacity > 0 && <path d={area} fill={fill} />}
      <path clipPath={`url(#${clipId})`} d={d} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface SparkBarsProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  gap?: number;
  className?: string;
}

export function SparkBars({ data, width = 80, height = 24, color = "var(--brand)", gap = 2, className }: SparkBarsProps) {
  if (!data || data.length === 0) return <svg width={width} height={height} className={className} />;
  const max = Math.max(...data) || 1;
  const barW = (width - gap * (data.length - 1)) / data.length;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className}>
      {data.map((v, i) => {
        const h = Math.max(1, (v / max) * height);
        const x = i * (barW + gap);
        const y = height - h;
        return <rect key={i} x={x} y={y} width={barW} height={h} fill={color} rx={1} />;
      })}
    </svg>
  );
}
