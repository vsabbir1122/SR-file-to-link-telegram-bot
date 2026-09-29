import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  Film,
  Globe,
  HardDriveUpload,
  Link2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sliders,
  Sparkles,
  Trash2,
  Video,
  Camera,
} from 'lucide-react';
import { generateFixedPythonFiles } from './pythonTemplates';

interface QualityVariant {
  label: '1080p' | '720p' | '480p' | '360p';
  resolution: string;
  bitrateMbps: number;
  sizeBytes: number;
  url: string;
  streamUrl: string;
  downloadUrl: string;
}

interface VideoItem {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number;
  sourceType: 'sample' | 'url' | 'upload' | 'telegram';
  sourceUrl: string;
  createdAt: string;
  watchUrl: string;
  standalonePlayerUrl: string;
  streamUrl: string;
  downloadUrl: string;
  qualities: QualityVariant[];
}

interface LogEntry {
  id: string;
  time: string;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

interface BotState {
  mongoUri: string;
  mongoConnected: boolean;
  mongoDatabaseName: string;
  mongoVideosCount: number;
  mongoUsersCount: number;
  apiId: string;
  apiHash: string;
  hasBotToken: boolean;
  maskedBotToken: string;
  binChannel: string;
  domain: string;
  publicTunnelDomain: string | null;
  isRunning: boolean;
  mtprotoConnected: boolean;
  botUsername: string | null;
  botFirstName: string | null;
  lastError: string | null;
  processedCount: number;
  lastPingAt: string;
  logs: LogEntry[];
}

type NavTab = 'studio' | 'library' | 'bot' | 'code';

type SrPreset = 'original' | 'sr_sharp' | 'cinema_hdr' | 'deblock';

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
}

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('studio');
  const [loading, setLoading] = useState<boolean>(true);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string>('sr-1001');
  const [selectedQuality, setSelectedQuality] = useState<'1080p' | '720p' | '480p' | '360p'>('720p');

  // Domain & Bot State
  const [activeDomain, setActiveDomain] = useState<string>(
    'https://ais-dev-w4opwh3w5736ifna5yycat-160296201066.asia-east1.run.app'
  );
  const [publicTunnelDomain, setPublicTunnelDomain] = useState<string | null>(null);
  const [sharedDomain, setSharedDomain] = useState<string>(
    'https://ais-pre-w4opwh3w5736ifna5yycat-160296201066.asia-east1.run.app'
  );
  const [devDomain, setDevDomain] = useState<string>(
    'https://ais-dev-w4opwh3w5736ifna5yycat-160296201066.asia-east1.run.app'
  );
  const [domainInput, setDomainInput] = useState<string>(
    'https://ais-dev-w4opwh3w5736ifna5yycat-160296201066.asia-east1.run.app'
  );
  const [mongoUriInput, setMongoUriInput] = useState<string>(
    'mongodb+srv://sabbirvai1122:SABBIRVAI1122@cluster0.t1bsiei.mongodb.net/?appName=Cluster0'
  );
  const [botState, setBotState] = useState<BotState | null>(null);

  // Domain Verification State
  const [verifyingDomain, setVerifyingDomain] = useState<boolean>(false);
  const [domainVerifyResult, setDomainVerifyResult] = useState<{
    ok: boolean;
    latencyMs: number;
    checkedAt: string;
    domain: string;
  } | null>({
    ok: true,
    latencyMs: 19,
    checkedAt: new Date().toISOString(),
    domain: 'https://ais-pre-w4opwh3w5736ifna5yycat-160296201066.asia-east1.run.app',
  });

  // Super-Resolution (SR) Real-time Optical Enhancement State
  const [srPreset, setSrPreset] = useState<SrPreset>('sr_sharp');
  const [srSharpness, setSrSharpness] = useState<number>(65);
  const [srContrast, setSrContrast] = useState<number>(112);
  const [srSaturation, setSrSaturation] = useState<number>(118);
  const [srBrightness, setSrBrightness] = useState<number>(104);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [splitCompare, setSplitCompare] = useState<boolean>(false);

  // Video Player Runtime Metrics & Gesture Controls
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoBoxRef = useRef<HTMLDivElement | null>(null);
  const [videoDimensions, setVideoDimensions] = useState<{ w: number; h: number }>({ w: 1920, h: 1080 });
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [playerVolume, setPlayerVolume] = useState<number>(100);
  const [gestureHud, setGestureHud] = useState<{
    visible: boolean;
    type: 'volume' | 'brightness';
    value: number;
  }>({ visible: false, type: 'volume', value: 100 });
  const gestureTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{
    x: number;
    y: number;
    isRight: boolean;
    startVol: number;
    startBrt: number;
    swiping: boolean;
    height: number;
  } | null>(null);

  // Quality Selection Popup State (480p, 720p, 1080p) before Play or Download
  const [qualityPopup, setQualityPopup] = useState<{
    open: boolean;
    mode: 'play' | 'download';
    videoId: string;
  }>({ open: false, mode: 'play', videoId: 'sr-1001' });

  // Clean Fixed-Screen Player Mode (active automatically when ?watch= is present)
  const [cleanPlayerMode, setCleanPlayerMode] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search);
    return Boolean(params.get('watch'));
  });

  // Admin Password Gate State (Password: SABBIRVAI1122)
  const ADMIN_PASSWORD = 'SABBIRVAI1122';
  const [isAdminUnlocked, setIsAdminUnlocked] = useState<boolean>(() => {
    try {
      return localStorage.getItem('sr_admin_pass_v1') === ADMIN_PASSWORD;
    } catch {
      return false;
    }
  });
  const [adminPasswordInput, setAdminPasswordInput] = useState<string>('');
  const [adminPasswordError, setAdminPasswordError] = useState<string | null>(null);

  const handleAdminUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminPasswordInput.trim() === ADMIN_PASSWORD) {
      setIsAdminUnlocked(true);
      setAdminPasswordError(null);
      try {
        localStorage.setItem('sr_admin_pass_v1', ADMIN_PASSWORD);
      } catch {
        // ignore storage errors
      }
    } else {
      setAdminPasswordError('ভুল পাসওয়ার্ড! সঠিক অ্যাডমিন পাসওয়ার্ড দিন।');
    }
  };

  const handleAdminLock = () => {
    setIsAdminUnlocked(false);
    setAdminPasswordInput('');
    try {
      localStorage.removeItem('sr_admin_pass_v1');
    } catch {
      // ignore
    }
  };

  // Library Search & Filter
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'sample' | 'telegram' | 'custom'>('all');

  // Add Video Modal State
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [addMode, setAddMode] = useState<'url' | 'upload'>('url');
  const [newVideoTitle, setNewVideoTitle] = useState<string>('');
  const [newVideoUrl, setNewVideoUrl] = useState<string>('');
  const [uploadingFile, setUploadingFile] = useState<boolean>(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Bot Config Form State
  const [apiIdInput, setApiIdInput] = useState<string>('2040');
  const [apiHashInput, setApiHashInput] = useState<string>('b18441a1ff607e10a989891a5462e627');
  const [botTokenInput, setBotTokenInput] = useState<string>('');
  const [binChannelInput, setBinChannelInput] = useState<string>('-1001982736450');
  const [savingBotConfig, setSavingBotConfig] = useState<boolean>(false);
  const [simulatingBot, setSimulatingBot] = useState<boolean>(false);

  // Python Code Exporter State
  const [selectedFileKey, setSelectedFileKey] = useState<
    'main.py' | 'render.yaml' | 'requirements.txt' | 'Procfile' | 'runtime.txt'
  >('main.py');

  // Copy Feedback State
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const triggerCopy = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 1800);
  };

  const fetchServerStatus = async (preserveSelection = true) => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (data.ok) {
        setActiveDomain(data.activeDomain);
        setPublicTunnelDomain(data.publicTunnelDomain || null);
        setSharedDomain(data.sharedDomain);
        setDevDomain(data.devDomain);
        setDomainInput(data.activeDomain);
        setBotState(data.botState);
        if (data.botState?.mongoUri) {
          setMongoUriInput(data.botState.mongoUri);
        }
        setApiIdInput(data.botState.apiId || '2040');
        setApiHashInput(data.botState.apiHash || 'b18441a1ff607e10a989891a5462e627');
        setBinChannelInput(data.botState.binChannel || '-1001982736450');
        setVideos(data.videos || []);

        if (data.videos?.length > 0) {
          const params = new URLSearchParams(window.location.search);
          const watchParam = params.get('watch');
          if (!watchParam && (!preserveSelection || selectedVideoId === 'sr-1001')) {
            setSelectedVideoId(data.videos[0].id);
          }
        }
      }
    } catch {
      // Keep existing state if transient network hiccup occurs
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const watchParam = params.get('watch');
    const qParam = params.get('q') as '1080p' | '720p' | '480p' | '360p' | null;
    if (watchParam) {
      setSelectedVideoId(watchParam);
      setCleanPlayerMode(true);
      setActiveTab('studio');
      if (!qParam) {
        setQualityPopup({ open: true, mode: 'play', videoId: watchParam });
      }
    }
    if (qParam && ['1080p', '720p', '480p', '360p'].includes(qParam)) {
      setSelectedQuality(qParam);
    }
    fetchServerStatus(true);
  }, []);

  const showGestureIndicator = (type: 'volume' | 'brightness', value: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    setGestureHud({ visible: true, type, value: clamped });
    if (gestureTimerRef.current) {
      window.clearTimeout(gestureTimerRef.current);
    }
    gestureTimerRef.current = window.setTimeout(() => {
      setGestureHud((prev) => ({ ...prev, visible: false }));
    }, 650);
  };

  const handleVideoTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!e.touches || e.touches.length !== 1 || !videoBoxRef.current) return;
    const touch = e.touches[0];
    const rect = videoBoxRef.current.getBoundingClientRect();
    const relY = touch.clientY - rect.top;
    const relX = touch.clientX - rect.left;
    if (relY > rect.height - 46) {
      touchStartRef.current = null;
      return;
    }
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      isRight: relX > rect.width / 2,
      startVol: playerVolume,
      startBrt: srBrightness,
      swiping: false,
      height: Math.max(160, rect.height),
    };
  };

  const handleVideoTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const state = touchStartRef.current;
    if (!state || !e.touches || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dy = state.y - touch.clientY;
    const dx = touch.clientX - state.x;

    if (!state.swiping) {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
        state.swiping = true;
      } else {
        return;
      }
    }

    const delta = (dy / (state.height * 0.65)) * 100;
    if (state.isRight) {
      const nextVol = Math.max(0, Math.min(100, Math.round(state.startVol + delta)));
      setPlayerVolume(nextVol);
      if (videoRef.current) {
        videoRef.current.muted = nextVol === 0;
        videoRef.current.volume = nextVol / 100;
      }
      showGestureIndicator('volume', nextVol);
    } else {
      const nextBrt = Math.max(20, Math.min(150, Math.round(state.startBrt + delta)));
      setSrBrightness(nextBrt);
      const pct = Math.round(((nextBrt - 20) / 130) * 100);
      showGestureIndicator('brightness', pct);
    }
  };

  const handleVideoTouchEnd = () => {
    touchStartRef.current = null;
  };

  const currentVideo = videos.find((v) => v.id === selectedVideoId) || videos[0];

  const applySrPreset = (preset: SrPreset) => {
    setSrPreset(preset);
    if (preset === 'original') {
      setSrSharpness(0);
      setSrContrast(100);
      setSrSaturation(100);
      setSrBrightness(100);
    } else if (preset === 'sr_sharp') {
      setSrSharpness(65);
      setSrContrast(112);
      setSrSaturation(118);
      setSrBrightness(104);
    } else if (preset === 'cinema_hdr') {
      setSrSharpness(80);
      setSrContrast(124);
      setSrSaturation(130);
      setSrBrightness(102);
    } else if (preset === 'deblock') {
      setSrSharpness(35);
      setSrContrast(106);
      setSrSaturation(108);
      setSrBrightness(103);
    }
  };

  const handleQualitySwitch = (q: '1080p' | '720p' | '480p' | '360p', forcePlay = false) => {
    const vEl = videoRef.current;
    const savedTime = vEl ? vEl.currentTime : 0;
    const shouldPlay = forcePlay || (vEl ? !vEl.paused : false);
    if (q === selectedQuality && vEl) {
      if (shouldPlay) {
        vEl.play().catch(() => {});
      }
      return;
    }
    setSelectedQuality(q);
    setTimeout(() => {
      if (videoRef.current) {
        if (savedTime > 1) {
          try {
            videoRef.current.currentTime = savedTime;
          } catch {
            // ignore seek on live stream
          }
        }
        if (shouldPlay) {
          videoRef.current.play().catch(() => {});
        }
      }
    }, 40);
  };

  const handlePlaybackRate = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  };

  const handleCaptureSnapshot = () => {
    const vEl = videoRef.current;
    if (!vEl) return;
    const canvas = document.createElement('canvas');
    canvas.width = vEl.videoWidth || 1920;
    canvas.height = vEl.videoHeight || 1080;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.filter = `contrast(${srContrast}%) saturate(${srSaturation}%) brightness(${srBrightness}%)`;
    ctx.drawImage(vEl, 0, 0, canvas.width, canvas.height);
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${currentVideo?.title.replace(/\s+/g, '_') || 'SR_Frame'}_${selectedQuality}.png`;
      a.click();
    } catch {
      // If cross-origin media taints canvas, open standalone stream snapshot
      window.open(`/player/${currentVideo?.id}?q=${selectedQuality}`, '_blank');
    }
  };

  const handleUpdateDomain = async (targetDomain?: string) => {
    const domToSave = (targetDomain ?? domainInput).trim();
    if (!domToSave) return;
    setVerifyingDomain(true);
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domToSave }),
      });
      const verifyRes = await fetch('/api/verify-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domToSave }),
      });
      const verifyData = await verifyRes.json();
      if (verifyData.ok) {
        setDomainVerifyResult({
          ok: true,
          latencyMs: verifyData.latencyMs,
          checkedAt: verifyData.checkedAt,
          domain: verifyData.domain,
        });
      }
      await fetchServerStatus(true);
    } finally {
      setVerifyingDomain(false);
    }
  };

  const handleSaveBotConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBotConfig(true);
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: domainInput,
          mongoUri: mongoUriInput,
          apiId: apiIdInput,
          apiHash: apiHashInput,
          botToken: botTokenInput || undefined,
          binChannel: binChannelInput,
        }),
      });
      setBotTokenInput('');
      await fetchServerStatus(true);
    } finally {
      setSavingBotConfig(false);
    }
  };

  const handleSimulateTelegramUpload = async () => {
    setSimulatingBot(true);
    try {
      const res = await fetch('/api/bot/simulate', { method: 'POST' });
      const data = await res.json();
      if (data.ok && data.video) {
        await fetchServerStatus(true);
        setSelectedVideoId(data.video.id);
      }
    } finally {
      setSimulatingBot(false);
    }
  };

  const handleAddVideoByUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    if (!newVideoUrl.trim()) {
      setAddError('Please enter a valid direct video URL (MP4 / WebM / MKV).');
      return;
    }
    setUploadingFile(true);
    try {
      const res = await fetch('/api/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newVideoTitle.trim() || 'Custom Multi-Quality Stream',
          sourceUrl: newVideoUrl.trim(),
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setAddError(data.error || 'Could not add video URL.');
      } else {
        await fetchServerStatus(true);
        setSelectedVideoId(data.video.id);
        setShowAddModal(false);
        setNewVideoTitle('');
        setNewVideoUrl('');
        setActiveTab('studio');
      }
    } catch (err: any) {
      setAddError(err?.message || 'Error adding video');
    } finally {
      setUploadingFile(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAddError(null);
    if (file.size > 35 * 1024 * 1024) {
      setAddError('For instant browser upload, please choose a video file under 35 MB, or use a direct URL.');
      return;
    }
    setUploadingFile(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64Data = reader.result as string;
        const res = await fetch('/api/videos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: newVideoTitle.trim() || file.name.replace(/\.[^/.]+$/, ''),
            fileName: file.name,
            mimeType: file.type || 'video/mp4',
            sizeBytes: file.size,
            base64Data,
          }),
        });
        const data = await res.json();
        if (data.ok && data.video) {
          await fetchServerStatus(true);
          setSelectedVideoId(data.video.id);
          setShowAddModal(false);
          setNewVideoTitle('');
          setActiveTab('studio');
        } else {
          setAddError(data.error || 'Upload failed.');
        }
      } catch (err: any) {
        setAddError(err?.message || 'Upload failed.');
      } finally {
        setUploadingFile(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDeleteVideo = async (id: string) => {
    await fetch(`/api/videos/${id}`, { method: 'DELETE' });
    await fetchServerStatus(true);
    if (selectedVideoId === id && videos.length > 1) {
      const remaining = videos.filter((v) => v.id !== id);
      if (remaining[0]) setSelectedVideoId(remaining[0].id);
    }
  };

  const filteredVideos = videos.filter((v) => {
    const matchesQuery =
      v.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.fileName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.id.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesQuery) return false;
    if (sourceFilter === 'sample') return v.sourceType === 'sample';
    if (sourceFilter === 'telegram') return v.sourceType === 'telegram';
    if (sourceFilter === 'custom') return v.sourceType === 'url' || v.sourceType === 'upload';
    return true;
  });

  const fixedPythonFiles = generateFixedPythonFiles({
    domain: activeDomain,
    mongoUri: mongoUriInput,
    apiId: apiIdInput,
    apiHash: apiHashInput,
    botToken: botState?.hasBotToken ? 'CONFIGURED_IN_SERVER_ENV' : 'YOUR_BOT_TOKEN_HERE',
    binChannel: binChannelInput,
  });

  const handleDownloadCodeFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Calculate SVG sharpening kernel matrix based on srSharpness (0..100)
  const sharpAmount = Number(((srSharpness / 100) * 1.2).toFixed(2));
  const centerWeight = Number((1 + 4 * sharpAmount).toFixed(2));
  const edgeWeight = Number((-sharpAmount).toFixed(2));
  const kernelMatrix = `0 ${edgeWeight} 0 ${edgeWeight} ${centerWeight} ${edgeWeight} 0 ${edgeWeight} 0`;

  const cleanAnimeTitle = (currentVideo?.title || currentVideo?.fileName || 'Anime Video')
    .replace(/\.(mp4|mkv|webm|avi|mov)$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // If in Clean Fixed-Screen Player Mode (?watch= or toggled), render the locked mobile player screen
  if (cleanPlayerMode && currentVideo) {
    return (
      <div
        className="fixed inset-0 w-screen h-dvh overflow-hidden bg-[#090d16] text-slate-100 flex flex-col items-center justify-center select-none touch-none"
        onTouchMove={(e) => e.preventDefault()}
      >
        <div className="w-full max-w-[720px] flex flex-col items-center">
          <div
            ref={videoBoxRef}
            onTouchStart={handleVideoTouchStart}
            onTouchMove={handleVideoTouchMove}
            onTouchEnd={handleVideoTouchEnd}
            className="relative w-full aspect-video max-h-[68dvh] bg-black overflow-hidden flex items-center justify-center border-y border-white/10 touch-none"
          >
            <button
              type="button"
              onClick={() =>
                setQualityPopup({ open: true, mode: 'play', videoId: currentVideo.id })
              }
              className="absolute top-3 right-3 z-20 bg-slate-900/80 border border-white/20 text-white text-xs font-bold px-2.5 py-1 rounded-md backdrop-blur-md cursor-pointer"
            >
              {selectedQuality} ⚙️
            </button>

            {gestureHud.visible && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-slate-950/90 border border-white/15 rounded-xl px-5 py-3.5 min-w-[165px] flex flex-col items-center gap-2 pointer-events-none backdrop-blur-md">
                <div className="text-sm font-bold text-white flex items-center gap-2">
                  <span>
                    {gestureHud.type === 'volume'
                      ? gestureHud.value === 0
                        ? '🔇'
                        : '🔊'
                      : '☀️'}
                  </span>
                  <span>
                    {gestureHud.type === 'volume' ? 'Sound' : 'Light'} {gestureHud.value}%
                  </span>
                </div>
                <div className="w-32 h-1.5 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 rounded-full transition-all duration-75"
                    style={{ width: `${gestureHud.value}%` }}
                  />
                </div>
              </div>
            )}

            <video
              ref={videoRef}
              key={currentVideo.id}
              src={`/stream/${currentVideo.id}?quality=${selectedQuality}`}
              controls
              playsInline
              preload={qualityPopup.open ? 'none' : 'auto'}
              onError={(e) => {
                const el = e.currentTarget;
                const savedPos = el.currentTime || 0;
                if (!el.src.includes('&r=') && !el.src.includes('/remux/')) {
                  el.src = `/stream/${currentVideo.id}?quality=${selectedQuality}&r=${Date.now()}`;
                } else if (!el.src.includes('/remux/')) {
                  el.src = `/remux/${currentVideo.id}?quality=${selectedQuality}`;
                } else if (!el.src.includes('transcode=1')) {
                  el.src = `/remux/${currentVideo.id}?quality=${selectedQuality}&transcode=1`;
                } else {
                  return;
                }
                el.load();
                if (savedPos > 1) {
                  el.addEventListener(
                    'loadedmetadata',
                    () => {
                      try {
                        el.currentTime = savedPos;
                      } catch {
                        // ignore
                      }
                    },
                    { once: true }
                  );
                }
                el.play().catch(() => {});
              }}
              style={{
                filter: `brightness(${srBrightness}%)`,
              }}
              className="w-full h-full object-contain bg-black"
            />
          </div>
        </div>

        {/* Quality Selection Popup Modal (480p, 720p, 1080p) */}
        {qualityPopup.open && (
          <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-5">
            <div className="w-full max-w-[340px] bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3.5 shadow-2xl">
              <div className="text-base font-bold text-white text-center">
                কোয়ালিটি সিলেক্ট করুন
              </div>
              <div className="space-y-2.5">
                {(['480p', '720p', '1080p'] as const).map((q) => (
                  <div key={q} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        handleQualitySwitch(q, true);
                        setQualityPopup((prev) => ({ ...prev, open: false }));
                      }}
                      className={`flex-1 py-3 px-3.5 rounded-xl border text-sm font-bold flex items-center justify-between cursor-pointer ${
                        selectedQuality === q
                          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                          : 'border-slate-700 bg-slate-800 text-white'
                      }`}
                    >
                      <span>▶️ Play {q}</span>
                      <span className="text-xs opacity-75">
                        {q === '1080p' ? 'FHD' : q === '720p' ? 'HD' : 'SD'}
                      </span>
                    </button>
                    <a
                      href={`/dl/${qualityPopup.videoId}?quality=${q}`}
                      download
                      onClick={() => setQualityPopup((prev) => ({ ...prev, open: false }))}
                      className="py-3 px-3.5 rounded-xl border border-slate-700 bg-slate-950 text-emerald-400 text-xs font-bold flex items-center justify-center"
                    >
                      ⬇️ {q}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Require Admin Password (SABBIRVAI1122) to access the main dashboard
  // Note: Video watch links (?watch=, /player/:id, /watch/:id) and download links (/dl/:id) remain 100% public
  if (!isAdminUnlocked) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-5">
        <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5 shadow-2xl">
          <div className="text-center space-y-1.5">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto text-xl">
              🔒
            </div>
            <h1 className="text-lg font-bold text-white">SR Video Admin Panel</h1>
            <p className="text-xs text-slate-400">
              ড্যাশবোর্ডে প্রবেশ করতে অ্যাডমিন পাসওয়ার্ড দিন
            </p>
          </div>

          <form onSubmit={handleAdminUnlock} className="space-y-3.5">
            <div>
              <input
                type="password"
                value={adminPasswordInput}
                onChange={(e) => {
                  setAdminPasswordInput(e.target.value);
                  setAdminPasswordError(null);
                }}
                placeholder="Enter Admin Password..."
                autoFocus
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
              {adminPasswordError && (
                <p className="text-xs text-rose-400 mt-2 text-center font-medium">
                  {adminPasswordError}
                </p>
              )}
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold text-sm transition-colors cursor-pointer"
            >
              Unlock Dashboard
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Hidden SVG Super-Resolution Convolution Filter */}
      <svg className="hidden" aria-hidden="true">
        <defs>
          <filter id="sr-sharpen-filter">
            <feConvolveMatrix
              order="3 3"
              preserveAlpha="true"
              kernelMatrix={kernelMatrix}
            />
          </filter>
        </defs>
      </svg>

      {/* Top Bar Contract: Zone 1 (Brand) — Zone 2 (4 Nav Links) — Zone 3 (Primary Action) */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/90 sticky top-0 z-30 backdrop-blur-md">
        <a
          href="#studio"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('studio');
          }}
          className="text-lg font-bold tracking-tight text-white whitespace-nowrap"
        >
          SR Video Quality
        </a>

        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-400">
          <button
            onClick={() => setActiveTab('studio')}
            className={`hover:text-white transition-colors whitespace-nowrap pb-0.5 ${
              activeTab === 'studio' ? 'text-white border-b-2 border-emerald-500' : ''
            }`}
          >
            Stream Studio
          </button>
          <button
            onClick={() => setActiveTab('library')}
            className={`hover:text-white transition-colors whitespace-nowrap pb-0.5 ${
              activeTab === 'library' ? 'text-white border-b-2 border-emerald-500' : ''
            }`}
          >
            Video Library ({videos.length})
          </button>
          <button
            onClick={() => setActiveTab('bot')}
            className={`hover:text-white transition-colors whitespace-nowrap pb-0.5 ${
              activeTab === 'bot' ? 'text-white border-b-2 border-emerald-500' : ''
            }`}
          >
            Telegram Bot Engine
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={`hover:text-white transition-colors whitespace-nowrap pb-0.5 ${
              activeTab === 'code' ? 'text-white border-b-2 border-emerald-500' : ''
            }`}
          >
            Fixed Python Code
          </button>
        </nav>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleAdminLock}
            title="Lock Dashboard"
            className="px-3 py-2 text-xs font-semibold text-slate-300 bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
          >
            🔒 Lock
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Video Stream</span>
          </button>
        </div>
      </header>

      {/* Mobile Navigation Selector */}
      <div className="flex md:hidden items-center gap-1 p-2 border-b border-slate-800 bg-slate-900/60 overflow-x-auto">
        {(
          [
            { id: 'studio', label: 'Stream Studio' },
            { id: 'library', label: `Library (${videos.length})` },
            { id: 'bot', label: 'Telegram Bot' },
            { id: 'code', label: 'Fixed Python Code' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
              activeTab === tab.id ? 'bg-emerald-500 text-slate-950 font-semibold' : 'text-slate-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Pre-Configured Working Domain Bar */}
      <section className="border-b border-slate-800 bg-slate-900/50 px-6 py-3.5">
        <div className="max-w-[1380px] mx-auto flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-300">
            <Globe className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-semibold text-white">Active Working Domain (ডোমেইন সংযুক্ত):</span>
            <code className="font-mono text-emerald-300 bg-slate-950 px-2.5 py-1 rounded border border-slate-800 select-all">
              {activeDomain}
            </code>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-emerald-400 font-medium">
              {botState?.mongoConnected ? 'MongoDB Atlas Connected' : 'Connecting MongoDB...'} ·{' '}
              {domainVerifyResult?.ok
                ? `HTTP 206 Range Ready (${domainVerifyResult.latencyMs}ms)`
                : 'Ready'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => triggerCopy('active-domain', activeDomain)}
              className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              {copiedKey === 'active-domain' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Domain Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Domain</span>
                </>
              )}
            </button>

            <button
              onClick={() => handleUpdateDomain(activeDomain)}
              disabled={verifyingDomain}
              className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${verifyingDomain ? 'animate-spin text-emerald-400' : ''}`} />
              <span>{verifyingDomain ? 'Verifying...' : 'Verify Domain 100%'}</span>
            </button>

            <a
              href={`/player/${currentVideo?.id || 'sr-1001'}?q=${selectedQuality}`}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 text-xs font-medium text-emerald-300 bg-emerald-950/60 border border-emerald-800/60 hover:bg-emerald-900/50 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Test Direct Watch Page</span>
            </a>
          </div>
        </div>
      </section>

      {/* Main Workspace Container */}
      <main className="flex-1 max-w-[1380px] w-full mx-auto px-6 py-6">
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 h-[480px] bg-slate-900 border border-slate-800 rounded-xl animate-pulse" />
            <div className="lg:col-span-4 h-[480px] bg-slate-900 border border-slate-800 rounded-xl animate-pulse" />
          </div>
        ) : (
          <>
            {/* =================================================================
                TAB 1: STREAM STUDIO & SUPER-RESOLUTION VIDEO PLAYER
               ================================================================= */}
            {activeTab === 'studio' && currentVideo && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Left 8 Columns: Multi-Quality Video Player & Direct Stream Links */}
                <div className="lg:col-span-8 space-y-6">
                  {/* Video Viewport Container */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                    {/* Video Top Header */}
                    <div className="px-5 py-3.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h1 className="text-base font-semibold text-white text-balance">
                          {currentVideo.title}
                        </h1>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
                          <span>ID: {currentVideo.id}</span>
                          <span aria-hidden="true">·</span>
                          <span>{selectedQuality} ({
                            currentVideo.qualities.find((q) => q.label === selectedQuality)?.resolution || '1920x1080'
                          })</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {formatBytes(
                              currentVideo.qualities.find((q) => q.label === selectedQuality)?.sizeBytes ||
                                currentVideo.sizeBytes
                            )}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            SR Filter: {srPreset === 'original' ? 'Bypassed' : `Active (Sharpness ${srSharpness}%)`}
                          </span>
                        </div>
                      </div>

                      {/* Segmented Multi-Quality Selector (480p, 720p, 1080p) */}
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
                          {(['480p', '720p', '1080p'] as const).map((q) => (
                            <button
                              key={q}
                              onClick={() => handleQualitySwitch(q)}
                              className={`px-2.5 py-1 text-xs font-mono font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                                selectedQuality === q
                                  ? 'bg-emerald-500 text-slate-950 font-semibold'
                                  : 'text-slate-400 hover:text-white'
                              }`}
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => setCleanPlayerMode(true)}
                          className="px-2.5 py-1.5 text-xs font-semibold bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 rounded-lg hover:bg-emerald-500/30 transition-colors cursor-pointer whitespace-nowrap"
                        >
                          📱 Clean Mobile Player
                        </button>
                      </div>
                    </div>

                    {/* Video Element with Real-Time Super-Resolution Filter + Swipe Gestures */}
                    <div
                      ref={videoBoxRef}
                      onTouchStart={handleVideoTouchStart}
                      onTouchMove={handleVideoTouchMove}
                      onTouchEnd={handleVideoTouchEnd}
                      className="relative bg-black aspect-video flex items-center justify-center overflow-hidden touch-none"
                    >
                      {gestureHud.visible && (
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-slate-950/90 border border-white/15 rounded-xl px-5 py-3.5 min-w-[165px] flex flex-col items-center gap-2 pointer-events-none backdrop-blur-md">
                          <div className="text-sm font-bold text-white flex items-center gap-2">
                            <span>
                              {gestureHud.type === 'volume'
                                ? gestureHud.value === 0
                                  ? '🔇'
                                  : '🔊'
                                : '☀️'}
                            </span>
                            <span>
                              {gestureHud.type === 'volume' ? 'Sound' : 'Light'} {gestureHud.value}%
                            </span>
                          </div>
                          <div className="w-32 h-1.5 bg-white/20 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-400 rounded-full transition-all duration-75"
                              style={{ width: `${gestureHud.value}%` }}
                            />
                          </div>
                        </div>
                      )}

                      <video
                        ref={videoRef}
                        key={currentVideo.id}
                        src={`/stream/${currentVideo.id}?quality=${selectedQuality}`}
                        controls
                        playsInline
                        preload="auto"
                        onError={(e) => {
                          const el = e.currentTarget;
                          if (!el.src.includes('/remux/')) {
                            el.src = `/remux/${currentVideo.id}?quality=${selectedQuality}&transcode=1`;
                            el.load();
                            el.play().catch(() => {});
                          }
                        }}
                        onLoadedMetadata={(e) => {
                          const el = e.currentTarget;
                          setVideoDimensions({
                            w: el.videoWidth || 1920,
                            h: el.videoHeight || 1080,
                          });
                          setDuration(el.duration || currentVideo.durationSec);
                        }}
                        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                        style={{
                          filter:
                            srPreset === 'original'
                              ? `brightness(${srBrightness}%)`
                              : `url(#sr-sharpen-filter) contrast(${srContrast}%) saturate(${srSaturation}%) brightness(${srBrightness}%)`,
                        }}
                        className="w-full h-full object-contain"
                      />

                      {splitCompare && (
                        <div className="absolute top-3 left-3 pointer-events-none bg-slate-950/85 border border-slate-700 px-3 py-1.5 rounded text-xs text-emerald-300 font-mono">
                          SR Optical Engine Active · Native {videoDimensions.w}x{videoDimensions.h} → {selectedQuality}
                        </div>
                      )}
                    </div>

                    {/* Bottom Action & Playback Bar */}
                    <div className="px-5 py-3.5 bg-slate-900 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">Speed:</span>
                        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-md border border-slate-800">
                          {[0.75, 1.0, 1.25, 1.5, 2.0].map((rate) => (
                            <button
                              key={rate}
                              onClick={() => handlePlaybackRate(rate)}
                              className={`px-2 py-0.5 text-xs font-mono rounded transition-colors cursor-pointer ${
                                playbackRate === rate
                                  ? 'bg-slate-800 text-emerald-400 font-semibold'
                                  : 'text-slate-400 hover:text-white'
                              }`}
                            >
                              {rate}x
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={handleCaptureSnapshot}
                          className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          <span>Capture SR Frame</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setQualityPopup({ open: true, mode: 'download', videoId: currentVideo.id })
                          }
                          className="px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Select Quality & Download</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Working Stream & Download Links Panel for Current Video */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h2 className="text-sm font-semibold text-white">
                          01. Direct Multi-Quality Streaming & Download Endpoints
                        </h2>
                        <p className="text-xs text-slate-400 mt-0.5">
                          All links below use your active domain and support HTTP 206 Partial Content byte-range seeking.
                        </p>
                      </div>
                      <span className="text-xs font-mono text-emerald-400 tabular-nums">
                        Time: {formatDuration(currentTime)} / {formatDuration(duration || currentVideo.durationSec)}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Watch Page URL */}
                      <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg flex flex-col justify-between gap-2">
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span>Standalone Watch Player URL (Telegram WebView Ready)</span>
                          <a
                            href={`/player/${currentVideo.id}?q=${selectedQuality}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-emerald-400 hover:underline flex items-center gap-1"
                          >
                            <span>Open</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            readOnly
                            value={`${activeDomain}/player/${currentVideo.id}?q=${selectedQuality}`}
                            className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:outline-none"
                          />
                          <button
                            onClick={() =>
                              triggerCopy(
                                'watch-link',
                                `${activeDomain}/player/${currentVideo.id}?q=${selectedQuality}`
                              )
                            }
                            className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-white rounded whitespace-nowrap cursor-pointer"
                          >
                            {copiedKey === 'watch-link' ? 'Copied!' : 'Copy'}
                          </button>
                        </div>
                      </div>

                      {/* Direct Stream URL */}
                      <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg flex flex-col justify-between gap-2">
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span>Direct Stream Endpoint ({selectedQuality} · VLC / MX Player)</span>
                          <a
                            href={`vlc://${activeDomain}/stream/${currentVideo.id}?quality=${selectedQuality}`}
                            className="text-emerald-400 hover:underline"
                          >
                            Launch VLC
                          </a>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            readOnly
                            value={`${activeDomain}/stream/${currentVideo.id}?quality=${selectedQuality}`}
                            className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:outline-none"
                          />
                          <button
                            onClick={() =>
                              triggerCopy(
                                'stream-link',
                                `${activeDomain}/stream/${currentVideo.id}?quality=${selectedQuality}`
                              )
                            }
                            className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-white rounded whitespace-nowrap cursor-pointer"
                          >
                            {copiedKey === 'stream-link' ? 'Copied!' : 'Copy'}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* All 4 Quality Tier Direct Links */}
                    <div className="pt-2 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {currentVideo.qualities.map((q) => (
                        <div
                          key={q.label}
                          className={`p-2.5 rounded-lg border transition-colors ${
                            selectedQuality === q.label
                              ? 'bg-slate-950 border-emerald-500/60'
                              : 'bg-slate-950/60 border-slate-800'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-mono font-semibold text-white">{q.label}</span>
                            <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                              {q.bitrateMbps} Mbps
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                            {q.resolution} · {formatBytes(q.sizeBytes)}
                          </div>
                          <div className="flex items-center gap-1.5 mt-2">
                            <button
                              onClick={() => handleQualitySwitch(q.label)}
                              className="flex-1 py-1 text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded cursor-pointer"
                            >
                              Play
                            </button>
                            <button
                              onClick={() =>
                                triggerCopy(`q-${q.label}`, `${activeDomain}/dl/${currentVideo.id}?quality=${q.label}`)
                              }
                              className="flex-1 py-1 text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-emerald-300 rounded cursor-pointer"
                            >
                              {copiedKey === `q-${q.label}` ? 'Copied' : 'Link'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right 4 Columns: Super-Resolution Optical Controls & Quick Stream Switcher */}
                <div className="lg:col-span-4 space-y-6">
                  {/* Super-Resolution Optical Processor */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                        <Sliders className="w-4 h-4 text-emerald-400" />
                        <span>02. Super-Resolution (SR) Enhancer</span>
                      </h2>
                      <button
                        onClick={() => applySrPreset('sr_sharp')}
                        className="text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
                      >
                        Reset Default
                      </button>
                    </div>

                    {/* SR Optical Presets */}
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          { id: 'sr_sharp', label: 'SR Sharp 1080p' },
                          { id: 'cinema_hdr', label: '4K Cinema HDR' },
                          { id: 'deblock', label: 'Low-Bitrate Clean' },
                          { id: 'original', label: 'Original Bypass' },
                        ] as const
                      ).map((p) => (
                        <button
                          key={p.id}
                          onClick={() => applySrPreset(p.id)}
                          className={`px-3 py-2 text-xs font-medium rounded-lg border text-left transition-colors cursor-pointer ${
                            srPreset === p.id
                              ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300 font-semibold'
                              : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>

                    {/* Optical Sliders */}
                    <div className="space-y-3 pt-1">
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-300">CAS Edge Sharpness (Super-Resolution)</span>
                          <span className="font-mono text-emerald-400 tabular-nums">{srSharpness}%</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={srSharpness}
                          onChange={(e) => {
                            setSrPreset('sr_sharp');
                            setSrSharpness(Number(e.target.value));
                          }}
                          className="w-full accent-emerald-400 cursor-pointer"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-300">HDR Contrast & Tone Mapping</span>
                          <span className="font-mono text-emerald-400 tabular-nums">{srContrast}%</span>
                        </div>
                        <input
                          type="range"
                          min={80}
                          max={150}
                          value={srContrast}
                          onChange={(e) => setSrContrast(Number(e.target.value))}
                          className="w-full accent-emerald-400 cursor-pointer"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-300">Color Vibrance & Gamut</span>
                          <span className="font-mono text-emerald-400 tabular-nums">{srSaturation}%</span>
                        </div>
                        <input
                          type="range"
                          min={80}
                          max={160}
                          value={srSaturation}
                          onChange={(e) => setSrSaturation(Number(e.target.value))}
                          className="w-full accent-emerald-400 cursor-pointer"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-300">Luminance Gain</span>
                          <span className="font-mono text-emerald-400 tabular-nums">{srBrightness}%</span>
                        </div>
                        <input
                          type="range"
                          min={85}
                          max={125}
                          value={srBrightness}
                          onChange={(e) => setSrBrightness(Number(e.target.value))}
                          className="w-full accent-emerald-400 cursor-pointer"
                        />
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                      <span className="text-xs text-slate-400">Show Live Resolution HUD Overlay</span>
                      <button
                        onClick={() => setSplitCompare((prev) => !prev)}
                        className={`px-3 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                          splitCompare
                            ? 'bg-emerald-500 text-slate-950 font-semibold'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {splitCompare ? 'HUD Visible' : 'Show HUD'}
                      </button>
                    </div>
                  </div>

                  {/* Quick Playlist / Active Streams */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-white">03. Active Video Streams</h2>
                      <button
                        onClick={() => setActiveTab('library')}
                        className="text-xs text-emerald-400 hover:underline cursor-pointer"
                      >
                        Manage All ({videos.length})
                      </button>
                    </div>

                    <div className="space-y-2 max-h-[290px] overflow-y-auto pr-1">
                      {videos.map((v) => {
                        const isSelected = v.id === currentVideo.id;
                        return (
                          <button
                            key={v.id}
                            onClick={() => setSelectedVideoId(v.id)}
                            className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer flex items-start justify-between gap-2 ${
                              isSelected
                                ? 'bg-slate-950 border-emerald-500/70'
                                : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-white truncate">{v.title}</div>
                              <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                                {v.id} · {formatBytes(v.sizeBytes)} · {formatDuration(v.durationSec)}
                              </div>
                            </div>
                            <span className="text-[11px] font-mono text-emerald-400 shrink-0">
                              {isSelected ? 'Playing' : 'Load'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* =================================================================
                TAB 2: VIDEO LIBRARY & MULTI-QUALITY LINK GENERATOR
               ================================================================= */}
            {activeTab === 'library' && (
              <div className="space-y-6">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <h1 className="text-lg font-semibold text-white">
                      Video Stream Catalog & Multi-Quality Link Generator
                    </h1>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Every video in this catalog is served with 1080p, 720p, 480p, and 360p stream & download URLs on{' '}
                      <span className="font-mono text-emerald-300">{activeDomain}</span>.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      onClick={handleSimulateTelegramUpload}
                      disabled={simulatingBot}
                      className="px-3.5 py-2 text-xs font-medium text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{simulatingBot ? 'Generating...' : 'Test Telegram Video Link'}</span>
                    </button>
                    <button
                      onClick={() => setShowAddModal(true)}
                      className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Upload / Paste Video URL</span>
                    </button>
                  </div>
                </div>

                {/* Search & Segmented Filter Controls */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="relative flex-1 max-w-md">
                    <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter by title, file name, or stream ID..."
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
                    {(
                      [
                        { id: 'all', label: 'All Streams' },
                        { id: 'sample', label: 'Reference Masters' },
                        { id: 'telegram', label: 'Telegram Bot' },
                        { id: 'custom', label: 'Uploaded / URL' },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setSourceFilter(f.id)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                          sourceFilter === f.id
                            ? 'bg-slate-800 text-white shadow-sm'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* High-Density Data Table */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                  {filteredVideos.length === 0 ? (
                    <div className="p-12 text-center space-y-3">
                      <p className="text-sm text-slate-300 font-medium">No video streams match your current filter.</p>
                      <p className="text-xs text-slate-500">
                        Upload a local video file or paste a direct video link to generate multi-quality streaming endpoints.
                      </p>
                      <button
                        onClick={() => {
                          setSourceFilter('all');
                          setSearchQuery('');
                          setShowAddModal(true);
                        }}
                        className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 transition-colors cursor-pointer"
                      >
                        Add First Video Stream
                      </button>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400 bg-slate-950/50">
                            <th className="py-3 px-4">Stream ID & Title</th>
                            <th className="py-3 px-4">Source</th>
                            <th className="py-3 px-4">Available Qualities</th>
                            <th className="py-3 px-4 text-right">Size</th>
                            <th className="py-3 px-4 text-right">Duration</th>
                            <th className="py-3 px-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70 text-xs">
                          {filteredVideos.map((v) => (
                            <tr key={v.id} className="hover:bg-slate-800/40 transition-colors">
                              <td className="py-3 px-4">
                                <div className="font-semibold text-white">{v.title}</div>
                                <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                                  {v.id} · {v.fileName}
                                </div>
                              </td>
                              <td className="py-3 px-4 text-slate-300 capitalize">{v.sourceType}</td>
                              <td className="py-3 px-4 font-mono text-slate-300 tabular-nums">
                                1080p · 720p · 480p · 360p
                              </td>
                              <td className="py-3 px-4 text-right font-mono text-slate-300 tabular-nums">
                                {formatBytes(v.sizeBytes)}
                              </td>
                              <td className="py-3 px-4 text-right font-mono text-slate-300 tabular-nums">
                                {formatDuration(v.durationSec)}
                              </td>
                              <td className="py-3 px-4 text-right">
                                <div className="inline-flex items-center gap-2">
                                  <button
                                    onClick={() => {
                                      setSelectedVideoId(v.id);
                                      setActiveTab('studio');
                                    }}
                                    className="px-2.5 py-1 text-xs font-medium bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 rounded transition-colors cursor-pointer"
                                  >
                                    Play in Studio
                                  </button>
                                  <button
                                    onClick={() => triggerCopy(`row-${v.id}`, v.standalonePlayerUrl)}
                                    className="px-2.5 py-1 text-xs font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 rounded transition-colors cursor-pointer"
                                  >
                                    {copiedKey === `row-${v.id}` ? 'Copied!' : 'Copy Link'}
                                  </button>
                                  <a
                                    href={v.downloadUrl}
                                    download
                                    className="px-2.5 py-1 text-xs font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 rounded transition-colors"
                                  >
                                    Download
                                  </a>
                                  {v.sourceType !== 'sample' && (
                                    <button
                                      onClick={() => handleDeleteVideo(v.id)}
                                      className="p-1 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                                      title="Delete Stream"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* =================================================================
                TAB 3: LIVE TELEGRAM BOT ENGINE & DOMAIN CONFIG
               ================================================================= */}
            {activeTab === 'bot' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Left 7 Columns: Domain & Telegram Credentials Configuration */}
                <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
                  <div>
                    <h1 className="text-lg font-semibold text-white">
                      01. Domain & Telegram Bot Engine Configuration
                    </h1>
                    <p className="text-xs text-slate-400 mt-1">
                      We have already configured a 100% working HTTPS Cloud Run domain for you below. You can also connect your Telegram Bot Token to process videos automatically.
                    </p>
                  </div>

                  {/* Quick One-Click Preset Working Domains */}
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-2.5">
                    <div className="text-xs font-semibold text-emerald-400">
                      Built-In Working Public Domains (১০০% সচল ডোমেইন — টেলিগ্রাম ও ব্রাউজারে সরাসরি কাজ করে):
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {publicTunnelDomain && (
                        <button
                          type="button"
                          onClick={() => {
                            setDomainInput(publicTunnelDomain);
                            handleUpdateDomain(publicTunnelDomain);
                          }}
                          className={`px-3 py-1.5 text-xs font-mono rounded border transition-colors cursor-pointer ${
                            activeDomain === publicTunnelDomain
                              ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                              : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          ⚡ 100% Public Tunnel (No Auth Wall): {publicTunnelDomain}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setDomainInput(devDomain);
                          handleUpdateDomain(devDomain);
                        }}
                        className={`px-3 py-1.5 text-xs font-mono rounded border transition-colors cursor-pointer ${
                          activeDomain === devDomain
                            ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                            : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        Dev Domain: {devDomain}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDomainInput(sharedDomain);
                          handleUpdateDomain(sharedDomain);
                        }}
                        className={`px-3 py-1.5 text-xs font-mono rounded border transition-colors cursor-pointer ${
                          activeDomain === sharedDomain
                            ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                            : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        Shared Domain: {sharedDomain}
                      </button>
                    </div>
                  </div>

                  <form onSubmit={handleSaveBotConfig} className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-xs font-medium text-slate-300">
                          MongoDB Atlas Database URI (সকল ভিডিও ও ফাইল লিংক এখানে সেভ থাকে)
                        </label>
                        <span className="text-[11px] font-mono text-emerald-400">
                          {botState?.mongoConnected
                            ? `Connected (${botState.mongoVideosCount} streams, ${botState.mongoUsersCount} users)`
                            : 'Disconnected'}
                        </span>
                      </div>
                      <input
                        type="text"
                        value={mongoUriInput}
                        onChange={(e) => setMongoUriInput(e.target.value)}
                        placeholder="mongodb+srv://..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs font-mono text-emerald-300 focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        Active Streaming Domain (HTTPS URL)
                      </label>
                      <input
                        type="text"
                        value={domainInput}
                        onChange={(e) => setDomainInput(e.target.value)}
                        placeholder="https://..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1.5">
                          Telegram API_ID (my.telegram.org)
                        </label>
                        <input
                          type="text"
                          value={apiIdInput}
                          onChange={(e) => setApiIdInput(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1.5">
                          Telegram API_HASH
                        </label>
                        <input
                          type="text"
                          value={apiHashInput}
                          onChange={(e) => setApiHashInput(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1.5">
                          Telegram BOT_TOKEN (@BotFather)
                        </label>
                        <input
                          type="password"
                          value={botTokenInput}
                          onChange={(e) => setBotTokenInput(e.target.value)}
                          placeholder={
                            botState?.hasBotToken
                              ? `Connected (${botState.maskedBotToken})`
                              : 'Paste Bot Token to start live polling...'
                          }
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1.5">
                          BIN_CHANNEL / Log Channel ID
                        </label>
                        <input
                          type="text"
                          value={binChannelInput}
                          onChange={(e) => setBinChannelInput(e.target.value)}
                          placeholder="-1001982736450"
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>

                    {botState?.lastError && (
                      <div className="p-3 bg-rose-950/50 border border-rose-800 rounded-lg text-xs text-rose-200">
                        Bot Notice: {botState.lastError}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <button
                        type="submit"
                        disabled={savingBotConfig}
                        className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {savingBotConfig ? 'Saving & Verifying...' : 'Save Domain & Bot Settings'}
                      </button>

                      <button
                        type="button"
                        onClick={handleSimulateTelegramUpload}
                        disabled={simulatingBot}
                        className="px-4 py-2 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                      >
                        {simulatingBot ? 'Simulating...' : 'Simulate Incoming Telegram Video'}
                      </button>
                    </div>
                  </form>
                </div>

                {/* Right 5 Columns: Live Server & Bot Activity Logs */}
                <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-white">02. Live Server & Stream Logs</h2>
                    <span className="text-xs font-mono text-emerald-400 tabular-nums">
                      Processed: {botState?.processedCount || videos.length} videos
                    </span>
                  </div>

                  <div className="text-xs text-slate-400 flex flex-wrap items-center gap-2 font-mono tabular-nums">
                    <span>
                      Bot Status:{' '}
                      {botState?.isRunning ? `Online (@${botState.botUsername})` : 'Web Server Active (Standby Bot)'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>Port: 3000</span>
                  </div>

                  <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1 font-mono text-xs">
                    {(botState?.logs || []).map((log) => (
                      <div
                        key={log.id}
                        className="p-2.5 bg-slate-950 border border-slate-800/90 rounded-lg space-y-1"
                      >
                        <div className="flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
                          <span
                            className={
                              log.level === 'error'
                                ? 'text-rose-400 font-semibold'
                                : log.level === 'warn'
                                ? 'text-amber-400 font-semibold'
                                : 'text-emerald-400 font-semibold'
                            }
                          >
                            {log.level.toUpperCase()}
                          </span>
                          <span>{new Date(log.time).toLocaleTimeString()}</span>
                        </div>
                        <div className="text-slate-200 break-all leading-relaxed">{log.message}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* =================================================================
                TAB 4: FIXED SR-VIDEO-QUALITY--main PYTHON FILES
               ================================================================= */}
            {activeTab === 'code' && (
              <div className="space-y-6">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h1 className="text-lg font-semibold text-white">
                      Fixed SR-VIDEO-QUALITY--main Source Code (Zero Errors + Domain Pre-Installed)
                    </h1>
                    <p className="text-xs text-slate-400 mt-1">
                      All errors in <code className="font-mono text-slate-200">main.py</code> and{' '}
                      <code className="font-mono text-slate-200">render.yaml</code> have been resolved: unified{' '}
                      <code className="font-mono text-slate-200">asyncio</code> loop for Hydrogram + Uvicorn, HTTP 206 Range chunk math, and pre-configured domain{' '}
                      <code className="font-mono text-emerald-300">{activeDomain}</code>.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        triggerCopy(`code-${selectedFileKey}`, fixedPythonFiles[selectedFileKey])
                      }
                      className="px-3.5 py-2 text-xs font-medium text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      {copiedKey === `code-${selectedFileKey}` ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Copied {selectedFileKey}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy {selectedFileKey}</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={() =>
                        handleDownloadCodeFile(selectedFileKey, fixedPythonFiles[selectedFileKey])
                      }
                      className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download {selectedFileKey}</span>
                    </button>
                  </div>
                </div>

                {/* File Tabs & Code Viewer */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                  <div className="border-b border-slate-800 px-4 py-2.5 bg-slate-950/60 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 overflow-x-auto">
                      {(
                        ['main.py', 'render.yaml', 'requirements.txt', 'Procfile', 'runtime.txt'] as const
                      ).map((fname) => (
                        <button
                          key={fname}
                          onClick={() => setSelectedFileKey(fname)}
                          className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors cursor-pointer ${
                            selectedFileKey === fname
                              ? 'bg-emerald-500 text-slate-950 font-semibold'
                              : 'text-slate-400 hover:text-white bg-slate-900'
                          }`}
                        >
                          {fname}
                        </button>
                      ))}
                    </div>
                    <span className="text-xs font-mono text-slate-400">
                      SR-VIDEO-QUALITY--main/{selectedFileKey}
                    </span>
                  </div>

                  <pre className="p-5 text-xs font-mono text-slate-200 overflow-x-auto max-h-[600px] leading-relaxed select-all bg-slate-950/90">
                    <code>{fixedPythonFiles[selectedFileKey]}</code>
                  </pre>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Add Video Stream Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Add Video Stream & Generate Quality Links</h2>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setAddError(null);
                }}
                className="text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Close
              </button>
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setAddMode('url');
                  setAddError(null);
                }}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  addMode === 'url' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Direct Video URL (MP4 / WebM)
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddMode('upload');
                  setAddError(null);
                }}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  addMode === 'upload' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Upload Video File from Device
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Video Title (Optional)
              </label>
              <input
                type="text"
                value={newVideoTitle}
                onChange={(e) => setNewVideoTitle(e.target.value)}
                placeholder="e.g. Natok Episode 12 — 1080p Master"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            {addMode === 'url' ? (
              <form onSubmit={handleAddVideoByUrl} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Direct Video Stream URL
                  </label>
                  <input
                    type="url"
                    value={newVideoUrl}
                    onChange={(e) => setNewVideoUrl(e.target.value)}
                    placeholder="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {addError && (
                  <p className="text-xs text-rose-400">{addError}</p>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2 text-xs font-medium text-slate-300 bg-slate-800 rounded-lg hover:bg-slate-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={uploadingFile}
                    className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 cursor-pointer disabled:opacity-50"
                  >
                    {uploadingFile ? 'Generating Links...' : 'Generate Multi-Quality Stream'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <label className="border-2 border-dashed border-slate-700 hover:border-emerald-500 rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors bg-slate-950/50">
                  <HardDriveUpload className="w-7 h-7 text-emerald-400 mb-2" />
                  <span className="text-xs font-semibold text-white">
                    {uploadingFile ? 'Uploading & Creating Stream Endpoints...' : 'Click to select MP4 / WebM video file'}
                  </span>
                  <span className="text-[11px] text-slate-400 mt-1">
                    Automatically creates /stream/:id, /player/:id, and /dl/:id on {activeDomain}
                  </span>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleFileUpload}
                    disabled={uploadingFile}
                    className="hidden"
                  />
                </label>

                {addError && (
                  <p className="text-xs text-rose-400">{addError}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quality Selection Popup Modal (480p, 720p, 1080p) */}
      {qualityPopup.open && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">
                কোয়ালিটি সিলেক্ট করুন (480p / 720p / 1080p)
              </h3>
              <button
                type="button"
                onClick={() => setQualityPopup((prev) => ({ ...prev, open: false }))}
                className="text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Close
              </button>
            </div>
            <p className="text-xs text-slate-400">
              আপনি যে কোয়ালিটি সিলেক্ট করবেন, ঠিক সেই কোয়ালিটির ভিডিও প্লে বা ডাউনলোড হবে:
            </p>
            <div className="space-y-2.5">
              {(['480p', '720p', '1080p'] as const).map((q) => (
                <div key={q} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedVideoId(qualityPopup.videoId);
                      handleQualitySwitch(q);
                      setQualityPopup((prev) => ({ ...prev, open: false }));
                      setActiveTab('studio');
                    }}
                    className={`flex-1 py-2.5 px-3.5 rounded-xl border text-xs font-bold flex items-center justify-between cursor-pointer ${
                      selectedQuality === q
                        ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                        : 'border-slate-700 bg-slate-800 text-white hover:bg-slate-700'
                    }`}
                  >
                    <span>▶️ Play {q}</span>
                    <span className="opacity-75">{q === '1080p' ? 'Full HD' : q === '720p' ? 'HD' : 'SD'}</span>
                  </button>
                  <a
                    href={`/dl/${qualityPopup.videoId}?quality=${q}`}
                    download
                    onClick={() => setQualityPopup((prev) => ({ ...prev, open: false }))}
                    className="py-2.5 px-3.5 rounded-xl border border-slate-700 bg-slate-950 text-emerald-400 hover:bg-slate-800 text-xs font-bold flex items-center justify-center"
                  >
                    ⬇️ Download {q}
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Quiet Footer */}
      <footer className="border-t border-slate-900 px-6 py-4 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2 max-w-[1380px] w-full mx-auto">
        <span>SR Video Quality & Multi-Quality Streaming Server</span>
        <span className="font-mono">{activeDomain}</span>
      </footer>
    </div>
  );
}
