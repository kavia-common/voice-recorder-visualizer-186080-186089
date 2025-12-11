import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

/**
 * Voice Recorder SPA
 * - Recording via MediaRecorder with permission handling and MIME detection
 * - Canvas-based waveform visualization using Web Audio API for recording and playback
 * - Recordings list with play/pause, progress, and delete
 * - Responsive, accessible UI in a light theme using provided colors
 */

const THEME = {
  primary: '#3b82f6',
  success: '#06b6d4',
  error: '#EF4444',
  background: '#f9fafb',
  surface: '#ffffff',
  text: '#111827',
};

// Helpers
function supportsMediaRecorder() {
  return typeof window !== 'undefined' && 'MediaRecorder' in window;
}
function supportsGetUserMedia() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}
function pickBestAudioMime() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/wav'];
  const MediaRecorderCtor = window.MediaRecorder;
  if (!MediaRecorderCtor) return '';
  for (const type of candidates) {
    if (MediaRecorderCtor.isTypeSupported && MediaRecorderCtor.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

// PUBLIC_INTERFACE
function App() {
  // Theme (light only but keep toggle for accessibility preference)
  const [theme, setTheme] = useState('light');

  // Recording State
  const [permission, setPermission] = useState('prompt'); // prompt | granted | denied
  const [isRecording, setIsRecording] = useState(false);
  const [recordings, setRecordings] = useState([]); // { id, url, blob, name, duration, createdAt }
  const [error, setError] = useState('');

  // Playback State
  const [activeId, setActiveId] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);

  // Media + AudioContext Refs
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const sourceNodeRef = useRef(null); // for recording visualization
  const rafIdRef = useRef(null);

  // Playback visualization refs
  const playbackAudioRef = useRef(null);
  const playbackSourceRef = useRef(null);
  const playbackAnalyserRef = useRef(null);
  const playbackDataArrayRef = useRef(null);
  const playbackRafIdRef = useRef(null);

  // Canvas refs
  const recordCanvasRef = useRef(null);
  const playbackCanvasRef = useRef(null);

  // MIME
  const mimeType = useMemo(() => (supportsMediaRecorder() ? pickBestAudioMime() : ''), []);

  useEffect(() => {
    document.documentElement.style.backgroundColor = THEME.background;
    document.documentElement.setAttribute('data-theme', theme);
    return () => {
      document.documentElement.style.backgroundColor = '';
    };
  }, [theme]);

  useEffect(() => {
    return () => {
      cleanupRecordingResources();
      cleanupPlaybackResources();
    };
  }, []);

  const ensureAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = ctx;
    }
    return audioContextRef.current;
  }, []);

  const setupRecordingAnalyser = useCallback((stream) => {
    const ctx = ensureAudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);

    analyserRef.current = analyser;
    sourceNodeRef.current = source;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    dataArrayRef.current = dataArray;

    drawWaveform(recordCanvasRef, analyser, dataArray, THEME.primary, true);
  }, [ensureAudioContext]);

  const cleanupRecordingResources = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.disconnect(); } catch {}
      sourceNodeRef.current = null;
    }
    analyserRef.current = null;
    dataArrayRef.current = null;

    if (mediaRecorderRef.current) {
      try { mediaRecorderRef.current.stop(); } catch {}
      mediaRecorderRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
  }, []);

  const setupPlaybackAnalyser = useCallback((audioEl) => {
    const ctx = ensureAudioContext();
    const source = ctx.createMediaElementSource(audioEl);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    analyser.connect(ctx.destination);

    playbackAnalyserRef.current = analyser;
    playbackSourceRef.current = source;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    playbackDataArrayRef.current = dataArray;

    drawWaveform(playbackCanvasRef, analyser, dataArray, THEME.success, false);
  }, [ensureAudioContext]);

  const cleanupPlaybackResources = useCallback(() => {
    if (playbackRafIdRef.current) {
      cancelAnimationFrame(playbackRafIdRef.current);
      playbackRafIdRef.current = null;
    }
    if (playbackSourceRef.current) {
      try { playbackSourceRef.current.disconnect(); } catch {}
      playbackSourceRef.current = null;
    }
    playbackAnalyserRef.current = null;
    playbackDataArrayRef.current = null;
  }, []);

  function drawWaveform(canvasRef, analyser, dataArray, stroke, isRecordingPhase) {
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas || !analyser || !dataArray) return;

      const ctx2d = canvas.getContext('2d');
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;

      ctx2d.clearRect(0, 0, width, height);

      analyser.getByteTimeDomainData(dataArray);
      ctx2d.lineWidth = 2;
      ctx2d.strokeStyle = stroke;
      ctx2d.beginPath();

      const sliceWidth = width / dataArray.length;
      let x = 0;

      for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * height) / 2;
        if (i === 0) ctx2d.moveTo(x, y);
        else ctx2d.lineTo(x, y);
        x += sliceWidth;
      }
      ctx2d.lineTo(width, height / 2);
      ctx2d.stroke();

      const id = isRecordingPhase ? 'rec' : 'play';
      const rafSetter = isRecordingPhase ? (val) => (rafIdRef.current = val) : (val) => (playbackRafIdRef.current = val);
      rafSetter(requestAnimationFrame(draw));
    };
    // start loop
    (isRecordingPhase ? (val) => (rafIdRef.current = val) : (val) => (playbackRafIdRef.current = val))(requestAnimationFrame(draw));
  }

  const requestMicrophone = useCallback(async () => {
    setError('');
    if (!supportsGetUserMedia()) {
      setPermission('denied');
      setError('getUserMedia is not supported by this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      setPermission('granted');
      return stream;
    } catch (e) {
      setPermission('denied');
      setError('Microphone permission denied or unavailable.');
      throw e;
    }
  }, []);

  // PUBLIC_INTERFACE
  const startRecording = useCallback(async () => {
    setError('');
    if (!supportsMediaRecorder() || !supportsGetUserMedia()) {
      setError('Audio recording is not supported in this browser.');
      return;
    }
    let stream = mediaStreamRef.current;
    if (!stream) {
      try {
        stream = await requestMicrophone();
      } catch {
        return;
      }
    }
    if (!stream) return;

    const options = {};
    if (mimeType) options.mimeType = mimeType;

    try {
      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];
      setupRecordingAnalyser(stream);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };
      recorder.onstop = async () => {
        try {
          const blob = new Blob(recordedChunksRef.current, { type: mimeType || 'audio/webm' });
          const url = URL.createObjectURL(blob);

          // measure duration
          const duration = await measureBlobDuration(blob);

          const name = `Recording ${new Date().toLocaleTimeString()}`;
          const newRec = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            url,
            blob,
            name,
            duration,
            createdAt: new Date().toISOString(),
          };
          setRecordings((prev) => [newRec, ...prev]);
        } catch (err) {
          setError('Failed to process recording.');
        } finally {
          cleanupRecordingResources();
          setIsRecording(false);
        }
      };

      recorder.start(100); // collect every 100ms
      setIsRecording(true);
      const ctx = ensureAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    } catch (e) {
      setError('Unable to start recording.');
    }
  }, [cleanupRecordingResources, ensureAudioContext, mimeType, requestMicrophone, setupRecordingAnalyser]);

  // PUBLIC_INTERFACE
  const stopRecording = useCallback(() => {
    setError('');
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }
  }, []);

  async function measureBlobDuration(blob) {
    return new Promise((resolve) => {
      const tempAudio = document.createElement('audio');
      tempAudio.src = URL.createObjectURL(blob);
      const cleanup = () => {
        URL.revokeObjectURL(tempAudio.src);
      };
      tempAudio.addEventListener('loadedmetadata', () => {
        resolve(isFinite(tempAudio.duration) ? tempAudio.duration : 0);
        cleanup();
      });
      tempAudio.addEventListener('error', () => {
        resolve(0);
        cleanup();
      });
    });
  }

  const onPlay = useCallback(async (recId) => {
    if (activeId === recId && isPlaying) {
      // pause
      if (playbackAudioRef.current) {
        playbackAudioRef.current.pause();
        setIsPlaying(false);
      }
      return;
    }

    // switch track
    setActiveId(recId);
    setPlayProgress(0);

    // stop previous
    if (playbackAudioRef.current) {
      playbackAudioRef.current.pause();
      playbackAudioRef.current.currentTime = 0;
    }
    cleanupPlaybackResources();

    const rec = recordings.find((r) => r.id === recId);
    if (!rec) return;

    const audioEl = new Audio(rec.url);
    playbackAudioRef.current = audioEl;

    audioEl.addEventListener('timeupdate', () => {
      const p = audioEl.duration ? (audioEl.currentTime / audioEl.duration) * 100 : 0;
      setPlayProgress(p);
    });
    audioEl.addEventListener('ended', () => {
      setIsPlaying(false);
      setPlayProgress(100);
      cleanupPlaybackResources();
    });
    audioEl.addEventListener('play', () => setIsPlaying(true));
    audioEl.addEventListener('pause', () => setIsPlaying(false));

    // visualization
    try {
      setupPlaybackAnalyser(audioEl);
      const ctx = ensureAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
    } catch {
      // ignore visualizer failure
    }

    audioEl.play().catch(() => {
      setError('Unable to play audio.');
    });
  }, [activeId, cleanupPlaybackResources, ensureAudioContext, recordings, setupPlaybackAnalyser, isPlaying]);

  const onDelete = useCallback((recId) => {
    setRecordings((prev) => {
      const rec = prev.find((r) => r.id === recId);
      if (rec) {
        try { URL.revokeObjectURL(rec.url); } catch {}
      }
      return prev.filter((r) => r.id !== recId);
    });
    if (activeId === recId) {
      if (playbackAudioRef.current) {
        playbackAudioRef.current.pause();
        playbackAudioRef.current = null;
      }
      cleanupPlaybackResources();
      setActiveId(null);
      setIsPlaying(false);
      setPlayProgress(0);
    }
  }, [activeId, cleanupPlaybackResources]);

  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'light' : 'light')); // locked to light but keeps accessible pattern

  const canRecord = supportsMediaRecorder() && supportsGetUserMedia();

  return (
    <div className="App" style={{ minHeight: '100vh', background: THEME.background, color: THEME.text }}>
      <header style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 24, color: THEME.text }}>Voice Recorder</h1>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label="App theme"
            style={{ backgroundColor: THEME.primary }}
          >
            🎙️
          </button>
        </div>
        <p style={{ marginTop: 8, color: '#374151' }}>
          Record your voice, see a live waveform, and manage your recordings.
        </p>
      </header>

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '0 16px 48px' }}>
        {!canRecord && (
          <div role="alert" aria-live="polite" style={alertStyle(THEME.error)}>
            Your browser does not support audio recording (MediaRecorder/getUserMedia).
          </div>
        )}
        {error && (
          <div role="alert" aria-live="polite" style={alertStyle(THEME.error)}>{error}</div>
        )}
        {permission === 'denied' && (
          <div role="alert" aria-live="polite" style={alertStyle(THEME.error)}>
            Microphone permission denied. Please enable it in your browser settings.
          </div>
        )}

        <section aria-labelledby="recording-section" style={cardStyle()}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <h2 id="recording-section" style={{ margin: 0, fontSize: 18, color: THEME.text }}>Recording</h2>
            <div style={{ display: 'flex', gap: 12 }}>
              {!isRecording ? (
                <button
                  onClick={startRecording}
                  disabled={!canRecord}
                  style={btnStyle(THEME.primary)}
                  aria-label="Start recording"
                >
                  <InlineIconMic /> Start
                </button>
              ) : (
                <button
                  onClick={stopRecording}
                  style={btnStyle(THEME.error)}
                  aria-label="Stop recording"
                >
                  <InlineIconStop /> Stop
                </button>
              )}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'grid', gap: 8 }}>
              <label htmlFor="rec-canvas" style={{ color: '#374151' }}>
                Live waveform
              </label>
              <div style={canvasContainerStyle()}>
                <canvas
                  id="rec-canvas"
                  ref={recordCanvasRef}
                  role="img"
                  aria-label="Recording waveform visualization"
                  style={{ width: '100%', height: 120, display: 'block' }}
                />
              </div>
              {isRecording && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: THEME.primary }}>
                  <span aria-live="polite" role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={dotPulseStyle(THEME.primary)} aria-hidden="true" />
                    Recording...
                  </span>
                </div>
              )}
            </div>
          </div>
        </section>

        <section aria-labelledby="playback-section" style={cardStyle()}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <h2 id="playback-section" style={{ margin: 0, fontSize: 18, color: THEME.text }}>Playback</h2>
            <div aria-live="polite" style={{ minWidth: 120, textAlign: 'right', color: '#374151' }}>
              {isPlaying ? 'Playing' : activeId ? 'Paused' : 'Idle'}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'grid', gap: 8 }}>
              <label htmlFor="play-canvas" style={{ color: '#374151' }}>
                Playback waveform
              </label>
              <div style={canvasContainerStyle()}>
                <canvas
                  id="play-canvas"
                  ref={playbackCanvasRef}
                  role="img"
                  aria-label="Playback waveform visualization"
                  style={{ width: '100%', height: 120, display: 'block' }}
                />
              </div>
              <div style={{ marginTop: 8 }}>
                <div style={progressTrackStyle()}>
                  <div style={progressBarStyle(THEME.success, playProgress)} aria-valuenow={playProgress} aria-valuemin={0} aria-valuemax={100} role="progressbar" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="list-section" style={cardStyle()}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <h2 id="list-section" style={{ margin: 0, fontSize: 18, color: THEME.text }}>Recordings</h2>
            <div style={{ color: '#374151' }}>{recordings.length} item{recordings.length !== 1 ? 's' : ''}</div>
          </div>

          <ul style={{ listStyle: 'none', padding: 0, marginTop: 16, display: 'grid', gap: 12 }}>
            {recordings.length === 0 && (
              <li style={{ color: '#6b7280' }}>No recordings yet. Click Start to begin.</li>
            )}
            {recordings.map((rec) => (
              <li key={rec.id} style={rowStyle()}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <span title="Audio" aria-hidden="true"><InlineIconWave /></span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60ch' }}>
                      {rec.name}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {formatDuration(rec.duration)} • {new Date(rec.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => onPlay(rec.id)}
                    style={btnSecondaryStyle(activeId === rec.id && isPlaying ? THEME.error : THEME.primary)}
                    aria-label={activeId === rec.id && isPlaying ? 'Pause' : 'Play'}
                  >
                    {activeId === rec.id && isPlaying ? <InlineIconPause /> : <InlineIconPlay />}
                  </button>
                  <a
                    href={rec.url}
                    download={`${rec.name}.webm`}
                    style={btnSecondaryStyle(THEME.success)}
                    aria-label="Download"
                  >
                    <InlineIconDownload />
                  </a>
                  <button
                    onClick={() => onDelete(rec.id)}
                    style={btnSecondaryStyle(THEME.error)}
                    aria-label="Delete"
                  >
                    <InlineIconTrash />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer style={{ textAlign: 'center', padding: '16px', color: '#6b7280' }}>
        Built with React, MediaRecorder, and Web Audio API.
      </footer>
    </div>
  );
}

function alertStyle(bg) {
  return {
    background: '#fff',
    border: `1px solid ${bg}`,
    color: bg,
    padding: '12px 16px',
    borderRadius: 10,
    marginBottom: 16,
  };
}
function cardStyle() {
  return {
    background: THEME.surface,
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  };
}
function canvasContainerStyle() {
  return {
    background: '#ffffff',
    border: '1px dashed #e5e7eb',
    borderRadius: 12,
    padding: 8,
  };
}
function btnStyle(color) {
  return {
    backgroundColor: color,
    color: '#fff',
    border: 'none',
    borderRadius: 999,
    padding: '10px 16px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
  };
}
function btnSecondaryStyle(color) {
  return {
    backgroundColor: 'transparent',
    color,
    border: `1px solid ${color}`,
    borderRadius: 999,
    padding: '8px 12px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    textDecoration: 'none',
  };
}
function rowStyle() {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 12,
    background: '#fff',
  };
}
function progressTrackStyle() {
  return {
    width: '100%',
    height: 8,
    background: '#e5e7eb',
    borderRadius: 999,
    overflow: 'hidden',
  };
}
function progressBarStyle(color, pct) {
  return {
    width: `${Math.max(0, Math.min(100, pct))}%`,
    height: '100%',
    background: color,
    transition: 'width 100ms linear',
  };
}
function dotPulseStyle(color) {
  return {
    width: 10,
    height: 10,
    borderRadius: '9999px',
    background: color,
    boxShadow: `0 0 0 0 ${color}`,
    animation: 'pulse 1.5s infinite',
  };
}

function formatDuration(sec) {
  if (!isFinite(sec)) return '0:00';
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Inline SVG Icons
function InlineIconMic() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 14a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v4a3 3 0 0 0 3 3Z" stroke="currentColor" strokeWidth="2" />
      <path d="M19 11a7 7 0 0 1-14 0M12 18v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function InlineIconStop() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
function InlineIconPlay() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7-11-7Z" />
    </svg>
  );
}
function InlineIconPause() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" />
      <rect x="14" y="5" width="4" height="14" />
    </svg>
  );
}
function InlineIconTrash() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function InlineIconDownload() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function InlineIconWave() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 12h2m2-4v8m3-10v12m3-8v4m3-6v8m3-4h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default App;
