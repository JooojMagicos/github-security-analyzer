interface Props {
  score: number;
}

function scoreColor(score: number): string {
  if (score >= 80) return '#00ff88';
  if (score >= 60) return '#ffd600';
  if (score >= 40) return '#ff7043';
  return '#ff4560';
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'SECURE';
  if (score >= 60) return 'MODERATE';
  if (score >= 40) return 'AT RISK';
  return 'CRITICAL';
}

export default function ScoreRing({ score }: Props) {
  const radius = 54;
  const stroke = 6;
  const normalizedRadius = radius - stroke / 2;
  const circumference = 2 * Math.PI * normalizedRadius;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = circumference - (clamped / 100) * circumference;
  const color = scoreColor(clamped);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <svg width={radius * 2} height={radius * 2} viewBox={`0 0 ${radius * 2} ${radius * 2}`}>
        {/* Track */}
        <circle
          cx={radius}
          cy={radius}
          r={normalizedRadius}
          fill="none"
          stroke="#1e2d4a"
          strokeWidth={stroke}
        />
        {/* Progress */}
        <circle
          cx={radius}
          cy={radius}
          r={normalizedRadius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${radius} ${radius})`}
          style={{ filter: `drop-shadow(0 0 6px ${color}80)` }}
        />
        {/* Score text */}
        <text
          x={radius}
          y={radius - 6}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#fff"
          fontSize="26"
          fontFamily="'Space Mono', monospace"
          fontWeight="700"
        >
          {clamped}
        </text>
        <text
          x={radius}
          y={radius + 16}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={color}
          fontSize="9"
          fontFamily="'Space Mono', monospace"
          letterSpacing="2"
        >
          /100
        </text>
      </svg>
      <span
        style={{
          fontFamily: "'Syne', sans-serif",
          fontWeight: 700,
          fontSize: 11,
          letterSpacing: '0.15em',
          color,
          textTransform: 'uppercase',
        }}
      >
        {scoreLabel(clamped)}
      </span>
    </div>
  );
}
