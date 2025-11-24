import React, { useState, useEffect } from 'react';
import LaserTrainer from './components/LaserTrainer';
import { AppMode } from './types';
import { Target, Crosshair } from 'lucide-react';

const App: React.FC = () => {
  const [cvReady, setCvReady] = useState(false);

  // Poll for OpenCV readiness
  useEffect(() => {
    const timer = setInterval(() => {
      // @ts-ignore
      if (window.cv && window.cv.Mat) {
        setCvReady(true);
        clearInterval(timer);
      }
    }, 100);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 p-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <Crosshair className="w-6 h-6 text-emerald-500" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">LaserStrike <span className="text-emerald-500">Web</span></h1>
              <p className="text-xs text-slate-400">Browser-based Dry Fire Training</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <div className={`h-2.5 w-2.5 rounded-full ${cvReady ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-xs font-medium text-slate-400">
              {cvReady ? 'SYSTEM READY' : 'LOADING CV ENGINE...'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 bg-slate-950 p-4 md:p-6">
        <div className="max-w-7xl mx-auto h-full">
          {!cvReady ? (
            <div className="flex flex-col items-center justify-center h-[60vh] space-y-4">
              <div className="w-12 h-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
              <p className="text-slate-400 font-mono animate-pulse">Initializing Computer Vision Core...</p>
            </div>
          ) : (
            <LaserTrainer />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 border-t border-slate-800 py-4 text-center text-slate-500 text-sm">
        <p>&copy; {new Date().getFullYear()} LaserStrike Web. Use with a standard webcam and laser training cartridge.</p>
      </footer>
    </div>
  );
};

export default App;