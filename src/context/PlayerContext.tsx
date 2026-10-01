/**
 * @deprecated Playback now lives in a single engine: `services/playerEngine.ts`
 * (singleton + `usePlayerEngine()` hook). This module only re-exports it so
 * stale imports keep working. Do not add providers or audio elements here —
 * duplicate engines caused double-playback and state fights.
 */
export { playerEngine, usePlayerEngine } from '../services/playerEngine';
