import raw from '../../config/gameConfig.json';

export interface KeyBindings {
  up: string;
  down: string;
  left: string;
  right: string;
  LP: string;
  RP: string;
  LK: string;
  RK: string;
}

export interface GameConfig {
  fps: number;
  maxHealth: number;
  lowHealthRatio: number;
  roundsToWin: number;
  roundTimeSeconds: number;
  startDistance: number;
  arenaRadius: number;
  friction: number;
  input: { bufferFrames: number; simultaneousFrames: number; motionFrames: number; tapFrames: number; wsWindowFrames: number };
  throw: { breakWindow: number; breakPushback: number; backThrowDamageScale: number };
  counterHit: { damageScale: number; extraStun: number };
  juggle: {
    gravity: number;
    gravityScalePerHit: number;
    lift: number;
    liftDecay: number;
    maxHits: number;
    damageScalePerHit: number;
    minDamageScale: number;
    driftSpeed: number;
    knockdownLift: number;
    knockdownSpeed: number;
    koLift: number;
    koSpeed: number;
  };
  guardBreak: { threshold: number; decayPerFrame: number; stunFrames: number };
  hitstop: { light: number; heavy: number; block: number; throw: number; heavyDamage: number };
  ground: { minLieFrames: number; maxLieFrames: number; getupFrames: number; getupInvulnFrames: number; rollFrames: number; rollDistance: number };
  ko: { slowmoFrames: number; slowmoScale: number; holdFrames: number };
  round: { introFrames: number; announceRoundFrame: number; announceFightFrame: number; endFrames: number; fadeFrames: number };
  practice: { refillDelayFrames: number };
  render: { internalHeight: number; vertexSnap: boolean; dither: boolean; scanlines: boolean; fov: number };
  keyboard: { p1: KeyBindings; p2: KeyBindings };
}

export const gameConfig: GameConfig = raw as GameConfig;
