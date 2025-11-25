import React from 'react';
import { Shot } from '../types';

interface TargetBoardProps {
  shots: Shot[];
  lastShot: Shot | null;
}

const TargetBoard: React.FC<TargetBoardProps> = ({ shots, lastShot }) => {
  // Target dimensions
  const width = 500;
  const height = 700;
  const cx = 250;
  const cy = 350;
  const maxRadius = 250;

  // Generate rings (10 to 1)
  const rings = Array.from({ length: 10 }, (_, i) => {
    const score = 10 - i;
    const radius = Math.floor(maxRadius * (i + 1) / 10);
    return { score, radius };
  });

  return (
    <div className="relative w-full aspect-[500/700]">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-full bg-slate-950"
        preserveAspectRatio="xMidYMid meet"
      >
        <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#1e293b" strokeWidth="1" />
        </pattern>
        <rect width="100%" height="100%" fill="url(#grid)" />

        {/* Target Rings */}
        {rings.reverse().map((ring) => {
          const isBlack = ring.score >= 7;
          return (
            <g key={ring.score}>
              <circle
                cx={cx}
                cy={cy}
                r={ring.radius}
                fill={isBlack ? '#0f172a' : '#f1f5f9'}
                stroke="#64748b"
                strokeWidth="1.5"
              />
              {ring.score < 10 && (
                <text
                  x={cx}
                  y={cy - ring.radius + 25}
                  textAnchor="middle"
                  fill={isBlack ? '#94a3b8' : '#64748b'}
                  fontSize="24"
                  fontWeight="900"
                  fontFamily="monospace"
                  opacity="0.8"
                >
                  {ring.score}
                </text>
              )}
            </g>
          );
        })}

        {/* Center X */}
        <line x1={cx - 15} y1={cy} x2={cx + 15} y2={cy} stroke="#fbbf24" strokeWidth="3" />
        <line x1={cx} y1={cy - 15} x2={cx} y2={cy + 15} stroke="#fbbf24" strokeWidth="3" />

        {/* Shots History */}
        {shots.map((shot, index) => (
            <g key={shot.id}>
                <circle
                    cx={shot.x}
                    cy={shot.y}
                    r="12" 
                    fill={shot.score === 10 ? '#10b981' : '#ef4444'} 
                    stroke="white"
                    strokeWidth="3"
                    opacity="0.9"
                />
                 <text
                  x={shot.x}
                  y={shot.y}
                  dy=".3em"
                  textAnchor="middle"
                  fill="white"
                  fontSize="14"
                  fontWeight="bold"
                  className="pointer-events-none select-none"
                >
                  {index + 1}
                </text>
            </g>
        ))}

        {/* Last Shot Highlight */}
        {lastShot && (
          <>
            <circle
              cx={lastShot.x}
              cy={lastShot.y}
              r="20"
              fill="none"
              stroke={lastShot.score === 10 ? '#10b981' : '#ef4444'}
              strokeWidth="4"
              className="animate-ping origin-center"
              opacity="0.5"
            />
          </>
        )}
      </svg>
    </div>
  );
};

export default TargetBoard;