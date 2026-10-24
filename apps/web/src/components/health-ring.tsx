export function HealthRing({ score, size = 92 }: { score: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const tone = clamped >= 80 ? "var(--brand)" : clamped >= 60 ? "#f5a524" : "#f0532a";
  return (
    <div className="health-ring" style={{ width: size, height: size }} role="img" aria-label={`Health score ${clamped} out of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          style={{ stroke: tone }}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span><b>{clamped}</b><small>/100</small></span>
    </div>
  );
}

export function healthLabel(score: number): string {
  if (score >= 85) return "Strong foundation";
  if (score >= 70) return "Good, with items to review";
  if (score >= 50) return "Needs attention";
  return "Significant quality issues";
}
