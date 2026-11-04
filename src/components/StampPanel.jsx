import { useState } from 'react';
import { getNoteName } from '../utils/audio';
import { getMidiNote } from '../utils/pitchMap';
import { NUM_FRETS } from '../utils/constants';
import { loadChordLibrary, saveChordLibrary } from '../utils/storage';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const OPEN_STRING_MIDI = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4

// Extract stamp shape — stores string, fret, and interval from root
function captureStampShape(noteList) {
  const midis = noteList.map(n => getMidiNote(n.stringIndex, n.fret));
  const rootMidi = Math.min(...midis);
  return {
    rootMidi,
    rootName: NOTE_NAMES[rootMidi % 12],
    voices: noteList.map((n, i) => ({
      stringIndex: n.stringIndex,
      fret: n.fret,
      semitones: midis[i] - rootMidi,
      duration: n.duration || 1,
      velocity: n.velocity ?? 0.8,
      beatOffset: n.beatOffset || 0,
    })),
  };
}

// Transpose a stamp shape by shifting all frets by a semitone delta
// Returns null if any fret goes out of range
function transposeShape(voices, semitoneDelta) {
  const transposed = voices.map(v => {
    const newFret = v.fret + semitoneDelta;
    if (newFret < 0 || newFret > NUM_FRETS) return null;
    return { ...v, fret: newFret };
  });
  if (transposed.some(v => v === null)) return null;
  return transposed;
}

export default function StampPanel({ notes, selectedNotes, selectedBeat, onStampCommit, onPreviewChange, stampRoot, noteDuration = 1, onArmStamp, armedId = null }) {
  // Migrate old format stamps on load
  const [stamps, setStamps] = useState(() => {
    const raw = loadChordLibrary();
    const stampsArray = Array.isArray(raw) ? raw : [];
    return stampsArray.filter(c => c.voices || c.intervals || c.notes).map(c => {
      if (c.voices) return c; // current format
      // Migrate from old formats
      const srcNotes = c.intervals || c.notes || [];
      const noteList = srcNotes.map(n => {
        if (n.stringIndex !== undefined) return n;
        return { stringIndex: 0, fret: n.semitones || 0, duration: n.duration || 1, velocity: n.velocity ?? 0.8, beatOffset: n.beatOffset || 0 };
      });
      const { rootMidi, voices } = captureStampShape(noteList);
      return { ...c, voices, rootMidi };
    });
  });
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');

  const persist = (updated) => {
    try {
      setStamps(updated);
      saveChordLibrary(updated);
    } catch (e) {
      console.error('Failed to persist stamps:', e);
      setStamps(updated);
    }
  };

  // Save stamp from selected notes — captures exact voicing shape
  const handleSaveFromSelection = () => {
    try {
      if (!selectedNotes || selectedNotes.size === 0) return;
      const selected = notes.filter((_, i) => selectedNotes.has(i));
      if (selected.length === 0) return;
      const minBeat = Math.min(...selected.map(n => n.beat));
      const withOffsets = selected.map(n => ({ ...n, beatOffset: n.beat - minBeat }));
      const { rootMidi, rootName, voices } = captureStampShape(withOffsets);
      const name = (rootName || 'Stamp') + ' stamp';
      const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      persist([...stamps, { id, name, voices, rootMidi }]);
    } catch (e) {
      console.error('Failed to capture stamp:', e);
    }
  };

  const handleDelete = (id) => {
    persist(stamps.filter(c => c.id !== id));
  };

  // Transpose stamp shape to target root, preserving voicing
  const getRootMidi = () => {
    if (stampRoot) return getMidiNote(stampRoot.stringIndex, stampRoot.fret);
    return 48;
  };

  // Transpose stamp shape to target root, preserving voicing
  const computeTransposed = (stamp) => {
    try {
      const voices = stamp?.voices;
      if (!voices || voices.length === 0) return null;
      if (typeof voices[0].fret !== 'number') return null;
      const targetMidi = getRootMidi();
      const originalRoot = stamp.rootMidi;
      if (typeof originalRoot !== 'number') {
        return voices.map(v => ({
          stringIndex: v.stringIndex,
          fret: v.fret,
          duration: noteDuration,
          velocity: v.velocity ?? 0.8,
          beatOffset: v.beatOffset || 0,
        }));
      }
      const delta = targetMidi - originalRoot;
      const transposed = transposeShape(voices, delta);
      if (!transposed) {
        return voices.map(v => ({
          stringIndex: v.stringIndex,
          fret: v.fret,
          duration: noteDuration,
          velocity: v.velocity ?? 0.8,
          beatOffset: v.beatOffset || 0,
        }));
      }
      return transposed.map(v => ({
        stringIndex: v.stringIndex,
        fret: v.fret,
        duration: noteDuration,
        velocity: v.velocity ?? 0.8,
        beatOffset: v.beatOffset || 0,
      }));
    } catch (e) {
      console.error('Failed to transpose stamp:', e);
      return null;
    }
  };

  const handleStamp = (stamp) => {
    const stampNotes = computeTransposed(stamp);
    if (!stampNotes || stampNotes.length === 0) return;
    onStampCommit(stampNotes);
  };

  const startRename = (stamp) => {
    setEditingId(stamp.id);
    setEditName(stamp.name);
  };

  const commitRename = () => {
    if (editingId && editName.trim()) {
      persist(stamps.map(c => c.id === editingId ? { ...c, name: editName.trim() } : c));
    }
    setEditingId(null);
  };

  try {
    return (
      <div className="stamp-panel">
        <div className="stamp-panel-header">
          <button className="capture-button" onClick={handleSaveFromSelection} title="Save selected notes as a stamp">
            Capture
          </button>
        </div>
        <div className="stamp-panel-list">
          {stamps.length === 0 && (
            <div className="stamp-empty">Select notes and click "Capture" to save them as a stamp.</div>
          )}
          {stamps.map(stamp => (
            <div key={stamp?.id || Math.random().toString(36)} className="stamp-item">
              <button
                className={`stamp-btn ${armedId === stamp?.id ? 'armed' : ''}`}
                onClick={() => {
                  try {
                    const voices = computeTransposed(stamp);
                    if (!voices) return;
                    if (armedId === stamp.id) {
                      onPreviewChange?.(null, false);
                    } else {
                      onPreviewChange?.(voices, true);
                    }
                    onArmStamp?.(stamp, voices);
                  } catch (e) {
                    console.error('Failed to arm stamp:', e);
                  }
                }}
                onMouseEnter={() => {
                  try {
                    if (armedId !== null) return;
                    onPreviewChange && onPreviewChange(computeTransposed(stamp), false)
                  } catch (e) {
                    console.error('Failed to preview stamp:', e);
                  }
                }}
                onMouseLeave={() => {
                  try {
                    if (armedId !== null) {
                      if (armedId === stamp.id) {
                        const voices = computeTransposed(stamp);
                        onPreviewChange && onPreviewChange(voices, true);
                      }
                    } else {
                      onPreviewChange && onPreviewChange(null, false);
                    }
                  } catch (e) {
                    console.error('Failed to clear stamp preview:', e);
                  }
                }}
                title="Stamp"
              >
                {editingId === stamp.id ? (
                  <input
                    className="stamp-name-input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setEditingId(null);
                      e.stopPropagation();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <span onDoubleClick={(e) => { e.stopPropagation(); startRename(stamp); }}>
                    {stamp.name}
                  </span>
                )}
                <span className="stamp-note-count">{(stamp.voices || stamp.intervals || []).length}n</span>
              </button>
              <button className="stamp-delete-btn" onClick={() => {
                try {
                  handleDelete(stamp.id);
                } catch (e) {
                  console.error('Failed to delete stamp:', e);
                }
              }} title="Delete">x</button>
            </div>
          ))}
        </div>
      </div>
    );
  } catch (e) {
    console.error('StampPanel render crashed:', e);
    return (
      <div className="stamp-panel">
        <div className="stamp-empty">Error loading stamps</div>
      </div>
    );
  }
}
