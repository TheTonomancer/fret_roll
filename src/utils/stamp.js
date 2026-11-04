import { getMidiNote } from './pitchMap';
import { NUM_FRETS } from './constants';
import { closestComboForPitch, getComboForPosition } from './pitchMap';

// Convert a hex color (#fff or #ffffff) to rgba string with given alpha
export function hexToRgba(hex, alpha) {
  let r = 0, g = 0, b = 0;
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else if (hex.length === 7) {
    r = parseInt(hex[1] + hex[2], 16);
    g = parseInt(hex[3] + hex[4], 16);
    b = parseInt(hex[5] + hex[6], 16);
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Group stamp voices by beatOffset so notes at the same chronological time
// share the same sequential blink delay. Returns groups sorted by beatOffset
// with an incremental delay per group.
export function groupByBeatOffset(voices, delayStep = 0.15) {
  if (!voices || !voices.length) return [];
  const map = new Map();
  voices.forEach((v) => {
    const key = v.beatOffset || 0;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(v);
  });
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, groupVoices], i) => ({ voices: groupVoices, delay: i * delayStep }));
}

// Compute where a stamped chord's voices land when anchored at anchorMidi.
// The lowest note of the stamp is anchored at anchorMidi and every other voice
// keeps its pitch distance from that lowest note. Each voice tries to stay on
// its captured string; if that fret goes out of range it falls back to the
// nearest playable string+fret. When usePosition is on, getComboForPosition
// governs which string set is used (position window determines when notes jump
// to the next string set over).
export function computeStampVoices(voices, anchorMidi, usePosition, position, noteDuration = 1) {
  if (!voices || !voices.length || anchorMidi == null) return [];
  const baseMidi = Math.min(...voices.map((v) => getMidiNote(v.stringIndex, v.fret)));
  const delta = anchorMidi - baseMidi;
  return voices.map((cn) => {
    const targetMidi = getMidiNote(cn.stringIndex, cn.fret) + delta;
    let combo = null;
    if (usePosition) {
      const c = getComboForPosition(targetMidi, position);
      combo = c ? { stringIndex: c.stringIndex, fret: c.fret } : null;
    } else {
      const fretOnOriginal = targetMidi - getMidiNote(cn.stringIndex, 0);
      if (fretOnOriginal >= 0 && fretOnOriginal <= NUM_FRETS) {
        combo = { stringIndex: cn.stringIndex, fret: fretOnOriginal };
      } else {
        const c = closestComboForPitch(targetMidi, cn.stringIndex);
        combo = c ? { stringIndex: c.stringIndex, fret: c.fret } : null;
      }
    }
    if (!combo) return null;
    return {
      stringIndex: combo.stringIndex,
      fret: combo.fret,
      beatOffset: cn.beatOffset || 0,
      duration: cn.duration || noteDuration,
    };
  }).filter(Boolean);
}
