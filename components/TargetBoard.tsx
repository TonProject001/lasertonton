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
    <div className="relative w-full aspect-[500/700] bg-slate-900 rounded-xl overflow-hidden border border-slate-700 shadow-2xl">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Background Grid (Optional aesthetic) */}
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
                fill={isBlack ? '#111' : '#f1f5f9'}
                stroke="#94a3b8"
                strokeWidth="1"
              />
              {ring.score < 10 && (
                <text
                  x={cx}
                  y={cy - ring.radius + 20}
                  textAnchor="middle"
                  fill={isBlack ? '#fff' : '#000'}
                  fontSize="16"
                  fontWeight="bold"
                  fontFamily="monospace"
                  opacity="0.5"
                >
                  {ring.score}
                </text>
              )}
            </g>
          );
        })}

        {/* Center X */}
        <line x1={cx - 10} y1={cy} x2={cx + 10} y2={cy} stroke="#fbbf24" strokeWidth="2" />
        <line x1={cx} y1={cy - 10} x2={cx} y2={cy + 10} stroke="#fbbf24" strokeWidth="2" />

        {/* Shots History */}
        {shots.map((shot) => (
            <g key={shot.id}>
                <circle
                    cx={shot.x}
                    cy={shot.y}
                    r="6"
                    fill={shot.score === 10 ? '#10b981' : '#ef4444'} 
                    stroke="white"
                    strokeWidth="2"
                    opacity="0.6"
                />
                 <text
                  x={shot.x + 8}
                  y={shot.y + 8}
                  fill="white"
                  fontSize="10"
                  className="pointer-events-none select-none"
                >
                  {rings.length - shots.indexOf(shot)}
                </text>
            </g>
        ))}

        {/* Last Shot Highlight */}
        {lastShot && (
          <>
            <circle
              cx={lastShot.x}
              cy={lastShot.y}
              r="8"
              fill={lastShot.score === 10 ? '#10b981' : '#ef4444'}
              stroke="white"
              strokeWidth="2"
              className="animate-ping origin-center"
            />
            <circle
              cx={lastShot.x}
              cy={lastShot.y}
              r="8"
              fill={lastShot.score === 10 ? '#10b981' : '#ef4444'}
              stroke="white"
              strokeWidth="2"
            />
          </>
        )}
      </svg>
    </div>
  );
};

export default TargetBoard;