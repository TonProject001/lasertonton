import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Settings, Lock, Eye, EyeOff, Target, Trophy, Clock, History, CameraOff, Video, MousePointer2, Scan, Volume2 } from 'lucide-react';
import { AppMode, Point, Shot, ProcessorSettings, RoundHistory } from '../types';
import TargetBoard from './TargetBoard';

// --- Sound Synthesis (Gunshot style) ---
// Global context to persist across renders
let audioCtx: AudioContext | null = null;

const  initAudio = () => {
    if (!audioCtx) {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContext) {
            audioCtx = new AudioContext();
        }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
};

const playGunshot = () => {
  if (!audioCtx) initAudio();
  if (!audioCtx) return;
  
  const ctx = audioCtx;
  
  // Create noise buffer
  const bufferSize = ctx.sampleRate * 0.5; // 0.5 seconds is enough
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  // Noise Source
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  // Filter (Lowpass to make it sound like a thud/pop)
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 800;

  // Envelope (Gain)
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(1, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

  // Connect graph
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  noise.start();
  noise.stop(ctx.currentTime + 0.3);
};

const playUnlockSound = () => {
    if (!audioCtx) initAudio();
    if (!audioCtx) return;
    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
};

// New Beep Sound for "Ready" signal
const playReadyBeep = () => {
    if (!audioCtx) initAudio();
    if (!audioCtx) return;
    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    // Square wave for a sharp "Digital Beep" like a shot timer
    osc.type = 'square';
    osc.frequency.setValueAtTime(1500, ctx.currentTime);
    
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.setValueAtTime(0.1, ctx.currentTime + 0.2); // Sustain
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25); // Release
    
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
};

const LaserTrainer: React.FC = () => {
  // -- Refs --
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number | null>(null);
  const transformMatrixRef = useRef<any>(null); // cv.Mat
  const streamRef = useRef<MediaStream | null>(null);
  const lastShotTimestampRef = useRef<number>(0);
  
  // -- State --
  const [mode, setMode] = useState<AppMode>(AppMode.SETUP);
  const [setupType, setSetupType] = useState<'AUTO' | 'MANUAL'>('AUTO');
  const [currentRoundShots, setCurrentRoundShots] = useState<Shot[]>([]);
  const [history, setHistory] = useState<RoundHistory[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  
  const [settings, setSettings] = useState<ProcessorSettings>({
    threshold: 200, // Slightly lower default threshold for better detection
    minArea: 2,
    cooldown: 3000, 
  });
  
  const [cooldownRemaining, setCooldownRemaining] = useState(0); // in Seconds
  
  const [targetFound, setTargetFound] = useState(false);
  const [targetQuad, setTargetQuad] = useState<Point[]>([]); 
  const [potentialQuad, setPotentialQuad] = useState<Point[]>([]); 
  const [showDebug, setShowDebug] = useState(false); 

  // Manual Mode Points (Refs for performance in loop, State for initial setup)
  const manualPointsRef = useRef<Point[]>([
    {x: 100, y: 100}, {x: 500, y: 100}, 
    {x: 500, y: 400}, {x: 100, y: 400}
  ]);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  const enableAudio = () => {
      initAudio();
      setAudioEnabled(true);
      playUnlockSound();
  };

  // -- Camera Handling --
  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      const constraints = {
        video: {
             width: { ideal: 1280 },
             height: { ideal: 720 },
             facingMode: 'environment'
        },
        audio: false
      };

      let stream: MediaStream;
      try {
         stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
         console.warn("Preferred constraints failed, falling back to basic video", err);
         stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = async () => {
             try {
                await videoRef.current?.play();
                setIsCameraActive(true);
             } catch (e) {
                console.error("Play error", e);
             }
        };
      }
    } catch (err: any) {
      console.error("Camera Init Error:", err);
      setIsCameraActive(false);
      setCameraError("Camera access denied or not found. Please allow permission.");
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (transformMatrixRef.current) {
          try { transformMatrixRef.current.delete(); } catch(e) {}
          transformMatrixRef.current = null;
      }
      setIsCameraActive(false);
    };
  }, [startCamera]);

  // -- Cooldown Timer --
  useEffect(() => {
    if (cooldownRemaining > 0) {
        const timer = setTimeout(() => {
            setCooldownRemaining(prev => prev - 1);
        }, 1000);
        return () => clearTimeout(timer);
    }
  }, [cooldownRemaining]);

  // -- Play Beep when Ready --
  useEffect(() => {
    if (mode === AppMode.SHOOT && cooldownRemaining === 0 && currentRoundShots.length < 5) {
        // Debounce audio slightly to prevent React StrictMode double-trigger
        const timer = setTimeout(() => {
             playReadyBeep();
        }, 50);
        return () => clearTimeout(timer);
    }
  }, [cooldownRemaining, mode, currentRoundShots.length]);

  // -- Canvas Interactions for Manual Mode --
  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
      if (mode !== AppMode.SETUP || setupType !== 'MANUAL' || !canvasRef.current) return;
      // CRITICAL for touch dragging prevents scrolling
      if ('preventDefault' in e) e.preventDefault(); 
      
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      
      let clientX, clientY;
      if ('touches' in e) {
          clientX = e.touches[0].clientX;
          clientY = e.touches[0].clientY;
      } else {
          clientX = (e as React.MouseEvent).clientX;
          clientY = (e as React.MouseEvent).clientY;
      }

      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      const x = (clientX - rect.left) * scaleX;
      const y = (clientY - rect.top) * scaleY;

      // Larger hit area for mobile (50px)
      const hitRadius = 50 * scaleX; 
      
      const clickedIdx = manualPointsRef.current.findIndex(p => {
          const dist = Math.sqrt(Math.pow(p.x - x, 2) + Math.pow(p.y - y, 2));
          return dist < hitRadius;
      });

      if (clickedIdx !== -1) {
          setDraggingIdx(clickedIdx);
      }
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
      if (draggingIdx === null || !canvasRef.current) return;
      if ('preventDefault' in e) e.preventDefault();

      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      
      let clientX, clientY;
      if ('touches' in e) {
          clientX = e.touches[0].clientX;
          clientY = e.touches[0].clientY;
      } else {
          clientX = (e as React.MouseEvent).clientX;
          clientY = (e as React.MouseEvent).clientY;
      }

      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      const x = (clientX - rect.left) * scaleX;
      const y = (clientY - rect.top) * scaleY;

      const newPoints = [...manualPointsRef.current];
      // Keep within bounds
      newPoints[draggingIdx] = { 
          x: Math.max(0, Math.min(canvas.width, x)), 
          y: Math.max(0, Math.min(canvas.height, y)) 
      };
      manualPointsRef.current = newPoints;
  };

  const handlePointerUp = (e: React.MouseEvent | React.TouchEvent) => {
      if ('preventDefault' in e) e.preventDefault();
      setDraggingIdx(null);
  };


  // Main processing loop
  const processFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    // @ts-ignore
    const cv = window.cv;
    if (!cv) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (video.readyState !== 4 || video.videoWidth === 0 || video.videoHeight === 0) {
      requestRef.current = requestAnimationFrame(processFrame);
      return;
    }

    // Match internal resolution
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      // Reset points on resize
      const w = video.videoWidth;
      const h = video.videoHeight;
      manualPointsRef.current = [
          {x: w*0.2, y: h*0.2}, {x: w*0.8, y: h*0.2},
          {x: w*0.8, y: h*0.8}, {x: w*0.2, y: h*0.8}
      ];
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // --- SETUP MODE ---
    if (mode === AppMode.SETUP) {
      if (setupType === 'AUTO') {
          try {
            let src = cv.imread(canvas);
            let gray = new cv.Mat();
            let blur = new cv.Mat();
            let edges = new cv.Mat();
            
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
            cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
            cv.adaptiveThreshold(blur, edges, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 11, 2);
            cv.bitwise_not(edges, edges); 
            let M = cv.Mat.ones(3, 3, cv.CV_8U);
            cv.dilate(edges, edges, M);

            if (showDebug) cv.imshow(canvas, edges);

            let contours = new cv.MatVector();
            let hierarchy = new cv.Mat();
            cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            let maxArea = 0;
            let bestApprox: any = null;

            for (let i = 0; i < contours.size(); ++i) {
              let cnt = contours.get(i);
              let area = cv.contourArea(cnt);
              if (area > (canvas.width * canvas.height * 0.02)) { 
                let peri = cv.arcLength(cnt, true);
                let approx = new cv.Mat();
                cv.approxPolyDP(cnt, approx, 0.04 * peri, true); // Looser tolerance
                if (approx.rows === 4) {
                    if (area > maxArea) {
                        maxArea = area;
                        if (bestApprox) bestApprox.delete();
                        bestApprox = approx; 
                    } else {
                        approx.delete();
                    }
                } else {
                    approx.delete();
                }
              }
            }

            if (bestApprox) {
                setTargetFound(true);
                let points = [];
                for (let i = 0; i < 4; i++) {
                    points.push({ x: bestApprox.data32S[i * 2], y: bestApprox.data32S[i * 2 + 1] });
                }
                setTargetQuad(points);
                bestApprox.delete();
            } else {
                setTargetFound(false);
            }

            src.delete(); gray.delete(); blur.delete(); edges.delete(); M.delete();
            contours.delete(); hierarchy.delete();

            if (targetFound && targetQuad.length === 4) {
                ctx.beginPath();
                ctx.lineWidth = 4;
                ctx.strokeStyle = '#00ff00'; 
                ctx.moveTo(targetQuad[0].x, targetQuad[0].y);
                for(let i=1; i<4; i++) ctx.lineTo(targetQuad[i].x, targetQuad[i].y);
                ctx.closePath();
                ctx.stroke();
            }

          } catch (err) {
            console.error("CV Error", err);
          }
      } else {
          // MANUAL DRAW
          const points = manualPointsRef.current;
          ctx.beginPath();
          ctx.lineWidth = 3;
          ctx.strokeStyle = '#34d399'; 
          ctx.moveTo(points[0].x, points[0].y);
          ctx.lineTo(points[1].x, points[1].y);
          ctx.lineTo(points[2].x, points[2].y);
          ctx.lineTo(points[3].x, points[3].y);
          ctx.closePath();
          ctx.stroke();

          points.forEach((p, idx) => {
              ctx.beginPath();
              // Make handles bigger
              ctx.arc(p.x, p.y, 20, 0, 2 * Math.PI);
              ctx.fillStyle = draggingIdx === idx ? '#10b981' : 'rgba(255, 255, 255, 0.3)';
              ctx.fill();
              ctx.lineWidth = 3;
              ctx.strokeStyle = '#ffffff';
              ctx.stroke();
              
              ctx.fillStyle = 'white';
              ctx.font = 'bold 16px Arial';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText((idx+1).toString(), p.x, p.y);
          });
      }
    }

    // --- SHOOT MODE ---
    if (mode === AppMode.SHOOT && transformMatrixRef.current && cooldownRemaining === 0) {
        // Prevent processing if we recently shot (Debounce 500ms)
        if (Date.now() - lastShotTimestampRef.current < 500) {
             requestRef.current = requestAnimationFrame(processFrame);
             return;
        }

        const frameData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = frameData.data;
        let maxVal = 0;
        let maxIdx = -1;

        // Skip pixels for performance, but not too many or we miss small lasers
        for (let i = 0; i < data.length; i += 4 * 2) { 
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            // Enhanced Red Detection Logic
            // 1. Must be bright enough (> threshold)
            // 2. Must be significantly Redder than Green and Blue (Red dominant)
            if (r > settings.threshold && r > (g * 1.5) && r > (b * 1.5)) {
                if (r > maxVal) {
                    maxVal = r;
                    maxIdx = i;
                }
            }
        }

        if (maxIdx !== -1) {
            const pixelIdx = maxIdx / 4;
            const x = pixelIdx % canvas.width;
            const y = Math.floor(pixelIdx / canvas.width);

            try {
                let srcPoint = cv.matFromArray(1, 1, cv.CV_32FC2, [x, y]);
                let dstPoint = new cv.Mat();
                cv.perspectiveTransform(srcPoint, dstPoint, transformMatrixRef.current);
                const tx = dstPoint.data32F[0];
                const ty = dstPoint.data32F[1];
                srcPoint.delete();
                dstPoint.delete();

                if (tx >= -20 && tx <= 520 && ty >= -20 && ty <= 720) {
                    handleShot(tx, ty);
                }
            } catch (e) { }
        }
    }

    requestRef.current = requestAnimationFrame(processFrame);
  }, [mode, setupType, settings, showDebug, targetFound, targetQuad, cooldownRemaining, draggingIdx]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(processFrame);
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); }
  }, [processFrame]);

  // -- Actions --
  const lockTarget = () => {
    let finalQuad: Point[] = [];
    if (setupType === 'AUTO') {
        if (!targetFound || targetQuad.length !== 4) return;
        finalQuad = targetQuad;
    } else {
        finalQuad = manualPointsRef.current;
    }

    // Sort corners Top-Left, Top-Right, Bottom-Right, Bottom-Left
    // @ts-ignore
    const cv = window.cv;
    const pts = finalQuad.map(p => ({...p, sum: p.x + p.y, diff: p.y - p.x}));
    const tl = pts.reduce((prev, curr) => curr.sum < prev.sum ? curr : prev, pts[0]);
    const br = pts.reduce((prev, curr) => curr.sum > prev.sum ? curr : prev, pts[0]);
    const tr = pts.reduce((prev, curr) => curr.diff < prev.diff ? curr : prev, pts[0]);
    const bl = pts.reduce((prev, curr) => curr.diff > prev.diff ? curr : prev, pts[0]);

    const srcMat = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
    const dstMat = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 500, 0, 500, 700, 0, 700]);

    if (transformMatrixRef.current) transformMatrixRef.current.delete();
    transformMatrixRef.current = cv.getPerspectiveTransform(srcMat, dstMat);
    srcMat.delete(); dstMat.delete();

    setMode(AppMode.SHOOT);
    setCurrentRoundShots([]);
    playUnlockSound();
  };

  const handleShot = (tx: number, ty: number) => {
      // Debounce check just in case logic slips
      if (Date.now() - lastShotTimestampRef.current < 500) return;
      lastShotTimestampRef.current = Date.now();

      playGunshot();
      setCooldownRemaining(3); // Start cooldown

      const cx = 250, cy = 350;
      const dist = Math.sqrt(Math.pow(tx - cx, 2) + Math.pow(ty - cy, 2));
      let rawScore = 10 - Math.floor((dist / 250) * 10);
      rawScore = Math.max(0, Math.min(10, rawScore));

      const newShot: Shot = {
          id: Date.now().toString(),
          x: tx, y: ty, score: rawScore,
          timestamp: Date.now(),
          timeString: new Date().toLocaleTimeString(),
          roundId: history.length + 1
      };

      const updated = [...currentRoundShots, newShot];
      setCurrentRoundShots(updated);

      if (updated.length >= 5) {
          setTimeout(() => finishRound(updated), 1500);
      }
  };

  const finishRound = (shots: Shot[]) => {
      const total = shots.reduce((a, b) => a + b.score, 0);
      setHistory(prev => [{
          roundNumber: prev.length + 1,
          totalScore: total,
          shots: shots,
          timestamp: new Date().toLocaleTimeString()
      }, ...prev]);
      setMode(AppMode.ROUND_OVER);
  };

  const startNewRound = () => {
      setMode(AppMode.SHOOT);
      setCooldownRemaining(0);
      setCurrentRoundShots([]);
  };

  const resetToSetup = () => {
      setMode(AppMode.SETUP);
      setTargetFound(false);
      setCurrentRoundShots([]);
      setCooldownRemaining(0);
  };

  return (
    <div className="flex flex-col md:grid md:grid-cols-12 gap-4 h-full pb-8">
      
      {/* 1. TARGET AREA (Mobile Top) */}
      <div className="md:col-span-5 flex flex-col gap-4 order-1">
         {/* Status Bar */}
         <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 flex justify-between items-center shadow-lg">
             <div>
                 <span className="text-xs text-slate-500 uppercase font-mono">Total Score</span>
                 <div className="text-4xl font-black text-emerald-400">
                     {currentRoundShots.reduce((a,b)=>a+b.score, 0)}
                 </div>
             </div>
             {mode === AppMode.SHOOT && (
                <div className="text-right">
                     <span className="text-xs text-slate-500 uppercase font-mono">Shots {currentRoundShots.length}/5</span>
                     <div className="flex gap-1 mt-1 justify-end">
                         {[...Array(5)].map((_, i) => (
                             <div key={i} className={`w-3 h-3 rounded-full ${i < (5 - currentRoundShots.length) ? 'bg-emerald-500' : 'bg-slate-800'}`} />
                         ))}
                     </div>
                </div>
             )}
         </div>

         {/* Target Board Container */}
         <div className="relative bg-slate-925 rounded-xl border border-slate-800 overflow-hidden shadow-2xl">
             <TargetBoard shots={currentRoundShots} lastShot={currentRoundShots[currentRoundShots.length-1]} />
             
             {/* Cooldown Overlay (Big Visual) */}
             {cooldownRemaining > 0 && mode === AppMode.SHOOT && (
                 <div className="absolute inset-0 bg-red-900/80 backdrop-blur-sm flex flex-col items-center justify-center z-10 animate-in fade-in">
                     <div className="text-8xl font-black text-white font-mono animate-pulse">{cooldownRemaining}</div>
                     <div className="text-white font-bold text-xl mt-2 tracking-widest">WAIT...</div>
                 </div>
             )}
             
             {/* Ready Indicator */}
             {mode === AppMode.SHOOT && cooldownRemaining === 0 && currentRoundShots.length < 5 && (
                 <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-emerald-500/90 text-white px-6 py-1 rounded-full text-xs font-bold tracking-widest shadow-lg animate-pulse z-10">
                     READY TO FIRE
                 </div>
             )}

             {/* Round Over */}
             {mode === AppMode.ROUND_OVER && (
                 <div className="absolute inset-0 bg-slate-900/95 flex flex-col items-center justify-center z-20 p-6 text-center animate-in zoom-in-95">
                     <Trophy className="w-16 h-16 text-yellow-400 mb-2" />
                     <h2 className="text-3xl font-bold text-white">ROUND FINISHED</h2>
                     <p className="text-slate-400 mb-6">Final Score: <span className="text-emerald-400 text-2xl font-bold">{history[0]?.totalScore}</span></p>
                     <button onClick={startNewRound} className="w-full max-w-xs py-4 bg-emerald-600 text-white font-bold rounded-xl shadow-lg hover:bg-emerald-500 mb-3">
                         NEXT ROUND
                     </button>
                     <button onClick={resetToSetup} className="text-slate-500 text-sm hover:text-white underline">
                         Recalibrate Camera
                     </button>
                 </div>
             )}
         </div>
      </div>

      {/* 2. CAMERA AREA */}
      <div className="md:col-span-7 flex flex-col gap-4 order-2">
         
         {!audioEnabled && (
             <button onClick={enableAudio} className="w-full py-2 bg-blue-600/20 border border-blue-500/50 text-blue-200 rounded-lg flex items-center justify-center gap-2 text-sm">
                 <Volume2 size={16} /> Enable Sound Effects
             </button>
         )}

         <div className="relative rounded-xl overflow-hidden bg-black border border-slate-700 shadow-xl aspect-video touch-none">
             <canvas 
                ref={canvasRef} 
                className={`w-full h-full block ${mode === AppMode.SETUP && setupType === 'MANUAL' ? 'cursor-crosshair touch-none' : ''}`}
                onMouseDown={handlePointerDown}
                onMouseMove={handlePointerMove}
                onMouseUp={handlePointerUp}
                onTouchStart={handlePointerDown}
                onTouchMove={handlePointerMove}
                onTouchEnd={handlePointerUp}
                style={{ touchAction: 'none' }} // Critical for mobile
             />
             <video ref={videoRef} className="hidden" playsInline muted autoPlay />
             
             {mode === AppMode.SETUP && (
                <div className="absolute top-3 right-3 flex flex-col gap-2">
                     <button onClick={() => setShowDebug(!showDebug)} className="p-3 bg-black/60 rounded-full text-white backdrop-blur border border-white/10">
                        {showDebug ? <EyeOff size={20}/> : <Eye size={20}/>}
                    </button>
                    <button 
                        onClick={() => setSetupType(prev => prev === 'AUTO' ? 'MANUAL' : 'AUTO')} 
                        className={`p-3 rounded-full text-white backdrop-blur border border-white/10 ${setupType === 'MANUAL' ? 'bg-emerald-600' : 'bg-black/60'}`} 
                    >
                        {setupType === 'AUTO' ? <Scan size={20}/> : <MousePointer2 size={20}/>}
                    </button>
                </div>
             )}

             {cameraError && (
                 <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 p-6 text-center">
                     <CameraOff className="w-12 h-12 text-red-500 mb-2" />
                     <p className="text-white font-bold">{cameraError}</p>
                     <button onClick={startCamera} className="mt-4 px-4 py-2 bg-white text-black font-bold rounded">Retry Camera</button>
                 </div>
             )}
         </div>

         {/* Controls */}
         <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
             {mode === AppMode.SETUP ? (
                 <div className="flex flex-col gap-3">
                     <div className="flex items-center justify-between text-slate-400 text-xs uppercase font-bold tracking-wider mb-1">
                        <span>Setup Mode: {setupType}</span>
                        <span>Sensitivity: {settings.threshold}</span>
                     </div>
                     
                     <button
                        onClick={lockTarget}
                        disabled={!isCameraActive || (setupType === 'AUTO' && !targetFound)}
                        className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all ${
                            (setupType === 'MANUAL' || targetFound)
                            ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/50 animate-pulse' 
                            : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        }`}
                     >
                        <Lock size={20} />
                        {setupType === 'MANUAL' ? "CONFIRM CORNERS" : (targetFound ? "LOCK TARGET" : "SCANNING...")}
                     </button>
                     
                     <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden mt-2 relative">
                         {/* Visual guide for sensitivity */}
                         <div className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-red-500 to-transparent w-full opacity-20 pointer-events-none"></div>
                         <div className="h-full bg-emerald-500 transition-all duration-300 relative z-10" style={{ width: `${((settings.threshold - 50) / 205) * 100}%`}} />
                     </div>
                     <div className="flex justify-between text-xs text-slate-500">
                         <span>More Sensitive (Low Light)</span>
                         <span>Less Sensitive (Bright Light)</span>
                     </div>
                     <input 
                        type="range" min="50" max="255" 
                        value={settings.threshold} 
                        onChange={(e) => setSettings({...settings, threshold: parseInt(e.target.value)})}
                        className="w-full opacity-0 -mt-6 cursor-pointer h-8 relative z-20"
                     />
                 </div>
             ) : (
                 <button onClick={resetToSetup} className="w-full py-4 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl flex items-center justify-center gap-2">
                    <Settings size={20} /> ADJUST CAMERA
                 </button>
             )}
         </div>
         
         {/* History */}
         {history.length > 0 && (
             <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                 <h3 className="text-slate-400 text-xs font-bold uppercase mb-3 flex items-center gap-2"><History size={14}/> Recent Rounds</h3>
                 <div className="space-y-2 max-h-32 overflow-y-auto">
                     {history.map(h => (
                         <div key={h.roundNumber} className="flex justify-between items-center bg-slate-950 p-2 rounded border border-slate-800">
                             <span className="text-slate-500 text-xs">#{h.roundNumber}</span>
                             <span className="text-emerald-400 font-bold">{h.totalScore} pts</span>
                         </div>
                     ))}
                 </div>
             </div>
         )}
      </div>
    </div>
  );
};

export default LaserTrainer;