// Project-wide rules. `npm run check` fails any reel outside these.
export const LIMITS = {
  minSeconds: 20,
  maxSeconds: 45,
  // Flow rules (calibrated on this footage with review's "active" score: dead holds
  // 3-10, gentle subject motion 4-12, camera moves 30-60).
  stillActivity: 7, // median activity under this = a static shot
  movingActivity: 20, // over this = clearly moving
  openingExtraSeconds: 1.0, // opening clip may run this much past the hook text
  // Reading speed for on-screen text: Netflix's timed-text guide allows at most 17
  // characters per second for adults; above that viewers can't finish the line. Time
  // counted is how long the text is fully readable (after its reveal animation).
  maxCharsPerSecond: 17,
};

// Pacing per editing style (reel.style). calm = the cinematic travel reels;
// energetic = fast beat-cut reels to upbeat tracks (shots of 1-4 beats, ramps).
export const STYLES = {
  calm: {
    // Warn below these, so reels don't feel rushed.
    minClipSeconds: 0.9,
    minAverageClipSeconds: 1.4,
    maxHold: { still: 1.6, gentle: 3.0, moving: 4.0, photo: 2.0 }, // seconds, middle clips
    maxClosingSeconds: 4.6,
  },
  energetic: {
    // One beat at ~130 BPM is 0.46 s; anything shorter is a flash, not a shot.
    minClipSeconds: 0.45,
    minAverageClipSeconds: 0.8,
    maxHold: { still: 1.0, gentle: 2.0, moving: 3.0, photo: 1.2 },
    maxClosingSeconds: 3.5,
  },
};
export type Style = keyof typeof STYLES;
