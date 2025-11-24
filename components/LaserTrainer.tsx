import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Camera, Settings, RefreshCcw, Lock, AlertCircle, Eye, EyeOff, SwitchCamera } from 'lucide-react';
import { AppMode, Point, Shot, ProcessorSettings } from '../types';
import TargetBoard from './TargetBoard';

// Sound synthesis helper
const playBeep = (freq = 800, duration = 0.1) => {
  const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContext) return;
  const ctx = new AudioContext({ sampleRate: 44100 });
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = freq;
  osc.type = 'sine';
  gain.gain.setValueAtTime(0.1, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + duration);
  osc.start();
  osc.stop(ctx.currentTime + duration);
};

const LaserTrainer: React.FC = () => {
  // -- Refs --
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>();
  const lastShotTimeRef = useRef<number>(0);
  const transformMatrixRef = useRef<any>(null); // cv.Mat
  
  // -- State --
  const [mode, setMode] = useState<AppMode>(AppMode.SETUP);
  const [shots, setShots] = useState<Shot[]>([]);
  const [settings, setSettings] = useState<ProcessorSettings>({
    threshold: 240, // High brightness for laser
    minArea: 2,
    cooldown: 300,
  });
  const [targetFound, setTargetFound] = useState(false);
  const [targetQuad, setTargetQuad] = useState<Point[]>([]); // For visualization in Setup
  const [potentialQuad, setPotentialQuad] = useState<Point[]>([]); // Visualization for "almost found"
  const [showDebug, setShowDebug] = useState(false); // Toggle for CV debug view
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment'); // Camera direction

  // -- OpenCV Setup & Processing Loop --
  useEffect(() => {
    const startCamera = async () => {
      // Stop existing tracks first
      if (videoRef.current && videoRef.current.srcObject) {
          const stream = videoRef.current.srcObject as MediaStream;
          stream.getTracks().forEach(track => track.stop());
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: facingMode
          },
          audio: false
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // Wait for metadata to load to ensure dimensions are correct
          videoRef.current.onloadedmetadata = () => {
             videoRef.current?.play();
          };
        }
      } catch (err) {
        console.error("Camera error:", err);
        // Fallback for some desktop browsers that might not support facingMode or high res
        try {
             const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
             if (videoRef.current) {
                videoRef.current.srcObject = fallbackStream;
                videoRef.current.play();
             }
        } catch (e) {
             alert("Could not access camera. Please allow permissions.");
        }
      }
    };

    startCamera();

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (transformMatrixRef.current) transformMatrixRef.current.delete();
      // Stop camera on unmount
      if (videoRef.current && videoRef.current.srcObject) {
          const stream = videoRef.current.srcObject as MediaStream;
          stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [facingMode]);

  // Main processing loop
  const processFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    // @ts-ignore
    const cv = window.cv;
    if (!cv) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    if (video.readyState !== 4 || !ctx) {
      requestRef.current = requestAnimationFrame(processFrame);
      return;
    }

    // Adjust canvas size to match video (handle rotation on mobile)
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const width = canvas.width;
    const height = canvas.height;

    // Draw current frame to canvas
    ctx.drawImage(video, 0, 0, width, height);

    // --- SETUP MODE: Find the A4 Paper ---
    if (mode === AppMode.SETUP) {
      try {
        let src = cv.imread(canvas);
        let gray = new cv.Mat();
        let blur = new cv.Mat();
        let edges = new cv.Mat();
        let dilated = new cv.Mat();
        
        // 1. Preprocess
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
        
        // 2. Edge Detection (Canny)
        cv.Canny(blur, edges, 50, 150); 

        // 3. Dilate (CRITICAL FIX: Connects broken edges)
        let M = cv.Mat.ones(3, 3, cv.CV_8U);
        let anchor = new cv.Point(-1, -1);
        cv.dilate(edges, dilated, M, anchor, 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
        M.delete();

        // Debug View: Show what the computer sees
        if (showDebug) {
            let debugMat = new cv.Mat();
            cv.cvtColor(dilated, debugMat, cv.COLOR_GRAY2RGBA);
            cv.imshow(canvas, debugMat);
            debugMat.delete();
        }

        // 4. Find contours
        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let maxArea = 0;
        let bestApprox: any = null;
        let tempBestQuad: Point[] = [];

        // 5. Find largest valid quadrilateral
        for (let i = 0; i < contours.size(); ++i) {
          let cnt = contours.get(i);
          let area = cv.contourArea(cnt);
          
          if (area > 2000) { 
            let peri = cv.arcLength(cnt, true);
            let approx = new cv.Mat();
            cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
            
            if (area > maxArea) {
              maxArea = area;
              
              let currentPoints = [];
              for (let j = 0; j < approx.rows; j++) {
                   currentPoints.push({
                       x: approx.data32S[j * 2],
                       y: approx.data32S[j * 2 + 1]
                   });
              }

              if (approx.rows === 4) {
                 if (bestApprox) bestApprox.delete();
                 bestApprox = approx; 
                 tempBestQuad = []; 
              } else {
                 setPotentialQuad(currentPoints);
                 approx.delete();
              }
            } else {
              approx.delete();
            }
          }
        }

        if (bestApprox) {
            setTargetFound(true);
            setPotentialQuad([]); 
            
            let points = [];
            for (let i = 0; i < 4; i++) {
                points.push({
                    x: bestApprox.data32S[i * 2],
                    y: bestApprox.data32S[i * 2 + 1]
                });
            }
            setTargetQuad(points);
            bestApprox.delete();
        } else {
            setTargetFound(false);
            setTargetQuad([]);
        }

        // Draw Overlays
        if (targetFound && targetQuad.length === 4) {
            ctx.beginPath();
            ctx.lineWidth = 5;
            ctx.strokeStyle = '#10b981'; // Emerald 500 (Green)
            ctx.moveTo(targetQuad[0].x, targetQuad[0].y);
            for(let i=1; i<4; i++) ctx.lineTo(targetQuad[i].x, targetQuad[i].y);
            ctx.closePath();
            ctx.stroke();
            
            // Draw corners
            targetQuad.forEach(p => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 5, 0, 2*Math.PI);
                ctx.fillStyle = '#10b981';
                ctx.fill();
            });
        } else if (potentialQuad.length > 0) {
            ctx.beginPath();
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#eab308'; // Yellow 500
            ctx.setLineDash([10, 10]); // Dashed line
            ctx.moveTo(potentialQuad[0].x, potentialQuad[0].y);
            for(let i=1; i<potentialQuad.length; i++) ctx.lineTo(potentialQuad[i].x, potentialQuad[i].y);
            ctx.closePath();
            ctx.stroke();
            ctx.setLineDash([]);
        }

        src.delete(); gray.delete(); blur.delete(); edges.delete(); dilated.delete();
        contours.delete(); hierarchy.delete();

      } catch (err) {
        console.error("OpenCV Error in Setup:", err);
      }
    }

    // --- SHOOT MODE: Detect Lasers ---
    if (mode === AppMode.SHOOT && transformMatrixRef.current) {
        const frameData = ctx.getImageData(0, 0, width, height);
        const data = frameData.data;
        let maxVal = 0;
        let maxIdx = -1;

        // Optimized loop
        for (let i = 0; i < data.length; i += 4 * 2) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            if (r > settings.threshold && r > (g + b)) {
                if (r > maxVal) {
                    maxVal = r;
                    maxIdx = i;
                }
            }
        }

        const now = Date.now();
        if (maxIdx !== -1 && (now - lastShotTimeRef.current > settings.cooldown)) {
            const pixelIdx = maxIdx / 4;
            const x = pixelIdx % width;
            const y = Math.floor(pixelIdx / width);

            ctx.beginPath();
            ctx.arc(x, y, 10, 0, 2 * Math.PI);
            ctx.fillStyle = 'red';
            ctx.fill();

            try {
                let srcPoint = cv.matFromArray(1, 1, cv.CV_32FC2, [x, y]);
                let dstPoint = new cv.Mat();
                
                cv.perspectiveTransform(srcPoint, dstPoint, transformMatrixRef.current);
                
                const tx = dstPoint.data32F[0];
                const ty = dstPoint.data32F[1];
                
                srcPoint.delete();
                dstPoint.delete();

                if (tx >= -20 && tx <= 520 && ty >= -20 && ty <= 720) {
                    lastShotTimeRef.current = now;
                    registerShot(tx, ty);
                    playBeep(1200, 0.1);
                }
            } catch (e) {
                console.error("Transform error", e);
            }
        }
    }

    requestRef.current = requestAnimationFrame(processFrame);
  }, [mode, settings, showDebug, targetFound, targetQuad, potentialQuad]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(processFrame);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [processFrame]);


  // -- Helpers --
  const toggleCamera = () => {
    setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
  };

  const lockTarget = () => {
    if (targetQuad.length !== 4) return;
    
    // @ts-ignore
    const cv = window.cv;
    
    // Order points: tl, tr, br, bl
    const pts = targetQuad.map(p => ({...p, sum: p.x + p.y, diff: p.y - p.x}));
    const sorted = [
        pts.reduce((min, p) => p.sum < min.sum ? p : min, pts[0]), 
        pts.reduce((min, p) => p.diff < min.diff ? p : min, pts[0]),
        pts.reduce((max, p) => p.sum > max.sum ? p : max, pts[0]),
        pts.reduce((max, p) => p.diff > max.diff ? p : max, pts[0]),
    ];

    const srcCoords = [
        sorted[0].x, sorted[0].y,
        sorted[1].x, sorted[1].y,
        sorted[2].x, sorted[2].y,
        sorted[3].x, sorted[3].y
    ];
    
    const dstCoords = [0, 0, 500, 0, 500, 700, 0, 700];

    const srcMat = cv.matFromArray(4, 1, cv.CV_32FC2, srcCoords);
    const dstMat = cv.matFromArray(4, 1, cv.CV_32FC2, dstCoords);

    if (transformMatrixRef.current) transformMatrixRef.current.delete();
    transformMatrixRef.current = cv.getPerspectiveTransform(srcMat, dstMat);
    
    srcMat.delete();
    dstMat.delete();

    setMode(AppMode.SHOOT);
    playBeep(600, 0.2);
  };

  const registerShot = (tx: number, ty: number) => {
    const cx = 250;
    const cy = 350;
    const dist = Math.sqrt(Math.pow(tx - cx, 2) + Math.pow(ty - cy, 2));
    let rawScore = 10 - Math.floor((dist / 250) * 10);
    rawScore = Math.max(0, Math.min(10, rawScore));

    const newShot: Shot = {
        id: Math.random().toString(36).substr(2, 9),
        x: tx,
        y: ty,
        score: rawScore,
        timestamp: Date.now(),
        timeString: new Date().toLocaleTimeString()
    };

    setShots(prev => [...prev, newShot]);
  };

  const resetSession = () => {
    setShots([]);
    setMode(AppMode.SETUP);
    setTargetFound(false);
  };

  const clearShots = () => {
      setShots([]);
  };
  
  const lastShot = shots.length > 0 ? shots[shots.length - 1] : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full pb-10 lg:pb-0">
      
      {/* LEFT COLUMN: CAMERA & CONTROLS (8 cols) */}
      <div className="lg:col-span-8 flex flex-col gap-4">
        
        {/* Camera Container */}
        <div className="relative rounded-2xl overflow-hidden bg-black border-2 border-slate-700 shadow-2xl aspect-video group">
           <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover hidden" 
            playsInline
            muted
          />
          <canvas
            ref={canvasRef}
            className="w-full h-full object-contain"
          />
          
          {/* Overlay UI Top */}
          <div className="absolute top-4 left-4 right-4 flex justify-between items-start pointer-events-none">
             <div className="bg-black/60 backdrop-blur-md px-3 py-1 rounded-full border border-white/10 flex items-center gap-2 pointer-events-auto">
                <div className={`w-2 h-2 rounded-full ${mode === AppMode.SHOOT ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`} />
                <span className="text-xs font-mono text-white tracking-wider font-bold">
                    {mode === AppMode.SETUP ? 'SETUP' : 'LIVE'}
                </span>
            </div>

            <div className="flex gap-2 pointer-events-auto">
                 {mode === AppMode.SETUP && (
                 <>
                    <button 
                        onClick={toggleCamera}
                        className="bg-black/60 backdrop-blur-md p-2 rounded-full border border-white/10 hover:bg-black/80 transition-colors active:scale-95"
                        title="Flip Camera"
                    >
                        <SwitchCamera className="w-5 h-5 text-white" />
                    </button>
                    <button 
                        onClick={() => setShowDebug(!showDebug)}
                        className={`bg-black/60 backdrop-blur-md p-2 rounded-full border border-white/10 hover:bg-black/80 transition-colors active:scale-95 ${showDebug ? 'bg-emerald-900/50 border-emerald-500' : ''}`}
                        title="Toggle Debug View"
                    >
                        {showDebug ? <EyeOff className="w-5 h-5 text-emerald-400" /> : <Eye className="w-5 h-5 text-slate-400" />}
                    </button>
                 </>
                )}
            </div>
          </div>

          {mode === AppMode.SETUP && !targetFound && (
             <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                {potentialQuad.length > 0 ? (
                    <div className="mt-32 bg-yellow-900/80 backdrop-blur-sm px-4 py-2 rounded-full border border-yellow-500/50 animate-bounce">
                        <p className="text-yellow-200 font-bold text-sm">Hold Steady...</p>
                    </div>
                ) : (
                    <div className="bg-black/50 backdrop-blur-sm p-4 rounded-xl border border-slate-600 flex flex-col items-center max-w-[280px] text-center">
                        <AlertCircle className="w-8 h-8 text-slate-400 mb-2" />
                        <p className="text-white font-medium">Point at Target</p>
                        <p className="text-xs text-slate-400 mt-1">Ensure good lighting. Tap the eye icon to see what the AI sees.</p>
                    </div>
                )}
             </div>
          )}

          {mode === AppMode.SETUP && targetFound && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none w-full flex justify-center px-4">
                 <div className="bg-emerald-900/80 backdrop-blur-sm px-6 py-2 rounded-full border border-emerald-500/50 animate-pulse">
                    <p className="text-emerald-100 font-bold text-sm whitespace-nowrap">TARGET FOUND</p>
                 </div>
              </div>
          )}
        </div>

        {/* Controls Bar */}
        <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            
            <div className="flex flex-col sm:flex-row items-stretch gap-3">
                {mode === AppMode.SETUP ? (
                    <button
                        onClick={lockTarget}
                        disabled={!targetFound}
                        className={`flex items-center justify-center gap-2 px-6 py-4 sm:py-3 rounded-lg font-bold transition-all ${
                            targetFound 
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 scale-100 active:scale-95' 
                            : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-50'
                        }`}
                    >
                        <Lock className="w-5 h-5" />
                        {targetFound ? "LOCK TARGET" : "SCANNING..."}
                    </button>
                ) : (
                    <button
                        onClick={resetSession}
                        className="flex items-center justify-center gap-2 px-6 py-4 sm:py-3 rounded-lg font-bold bg-slate-700 hover:bg-slate-600 text-white transition-all active:scale-95"
                    >
                        <Settings className="w-5 h-5" />
                        RESET
                    </button>
                )}
                
                {mode === AppMode.SHOOT && (
                    <button
                        onClick={clearShots}
                        className="flex items-center justify-center gap-2 px-4 py-4 sm:py-3 rounded-lg font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all active:scale-95"
                    >
                        <RefreshCcw className="w-4 h-4" />
                        CLEAR
                    </button>
                )}
            </div>

            {/* Threshold Slider */}
            <div className="flex items-center gap-3 bg-slate-950 px-4 py-3 rounded-lg border border-slate-800">
                <span className="text-xs font-mono text-slate-400 uppercase whitespace-nowrap">Laser Sens</span>
                <input
                    type="range"
                    min="150"
                    max="255"
                    step="5"
                    value={settings.threshold}
                    onChange={(e) => setSettings({...settings, threshold: parseInt(e.target.value)})}
                    className="flex-1 min-w-[100px] h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
            </div>
        </div>
      </div>

      {/* RIGHT COLUMN: TARGET & STATS (4 cols) */}
      <div className="lg:col-span-4 flex flex-col h-full gap-4">
        
        {/* Score Card */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 flex flex-col items-center justify-center relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-emerald-500 to-transparent opacity-50" />
            <h3 className="text-slate-400 text-sm font-mono tracking-widest uppercase mb-1">Last Shot</h3>
            <div className={`text-7xl font-black tabular-nums tracking-tighter ${lastShot?.score === 10 ? 'text-emerald-400 drop-shadow-[0_0_15px_rgba(52,211,153,0.5)]' : 'text-white'}`}>
                {lastShot ? lastShot.score : '-'}
            </div>
            
            <div className="mt-4 grid grid-cols-2 gap-4 w-full">
                <div className="bg-slate-950/50 p-3 rounded-lg text-center">
                    <div className="text-xs text-slate-500 uppercase">Shots</div>
                    <div className="text-xl font-bold text-white">{shots.length}</div>
                </div>
                <div className="bg-slate-950/50 p-3 rounded-lg text-center">
                    <div className="text-xs text-slate-500 uppercase">Avg</div>
                    <div className="text-xl font-bold text-white">
                        {shots.length > 0 
                            ? (shots.reduce((a, b) => a + b.score, 0) / shots.length).toFixed(1) 
                            : '-'}
                    </div>
                </div>
            </div>
        </div>

        {/* Virtual Target - Only show if we have space or it's crucial, generally good on scroll */}
        <div className="flex-1 min-h-[350px]">
            <TargetBoard shots={shots} lastShot={lastShot} />
        </div>

        {/* Shot Log */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden h-48 flex flex-col mb-8 lg:mb-0">
            <div className="p-3 bg-slate-950 border-b border-slate-800 text-xs font-mono text-slate-400 uppercase tracking-wider">
                History
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {shots.slice().reverse().map((shot, idx) => (
                    <div key={shot.id} className="flex items-center justify-between p-2 hover:bg-slate-800 rounded transition-colors text-sm">
                        <span className="text-slate-500 w-6">#{shots.length - idx}</span>
                        <span className={`font-bold ${shot.score >= 9 ? 'text-emerald-400' : shot.score >= 7 ? 'text-yellow-400' : 'text-white'}`}>
                            {shot.score}
                        </span>
                        <span className="text-slate-600 font-mono text-xs">{shot.timeString}</span>
                    </div>
                ))}
                {shots.length === 0 && (
                    <div className="text-center py-8 text-slate-600 text-sm italic">
                        Ready to fire
                    </div>
                )}
            </div>
        </div>

      </div>
    </div>
  );
};

export default LaserTrainer;