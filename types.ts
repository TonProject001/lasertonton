export interface Point {
    x: number;
    y: number;
}

export interface Shot {
    id: string;
    x: number; // 0-500 coordinates relative to target
    y: number; // 0-700 coordinates relative to target
    score: number;
    timestamp: number;
    timeString: string;
}

export enum AppMode {
    LOADING_CV = 'LOADING_CV',
    SETUP = 'SETUP',
    SHOOT = 'SHOOT'
}

export interface ProcessorSettings {
    threshold: number; // 0-255 brightness threshold for laser
    minArea: number;   // Minimum contour area to count as a shot
    cooldown: number;  // Milliseconds between shots
}