
import React, { useState, useRef, useEffect } from 'react';
import { Note, Folder } from '../types';
import { reTitleNote, translateText, generateSpeech } from '../services/geminiService';
import { getAudioBlob } from '../services/storageService';

interface NoteCardProps {
  note: Note;
  folders: Folder[];
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onMoveToFolder: (noteId: string, folderId: string | undefined) => void;
  onUpdate: (id: string, updates: Partial<Note>) => void;
}

const LANGUAGES = [
  { name: 'English', code: 'en' },
  { name: 'Nepali', code: 'ne' },
  { name: 'Hindi', code: 'hi' },
  { name: 'Spanish', code: 'es' },
  { name: 'Japanese', code: 'ja' },
  { name: 'French', code: 'fr' },
  { name: 'German', code: 'de' },
];

const SPEED_OPTIONS = [0.5, 1.0, 1.5, 2.0];

// PCM Decoding Helpers as per Gemini SDK standards
function base64ToUint8Array(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeRawPcm(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const NoteCard: React.FC<NoteCardProps> = ({ note, folders, onDelete, onTogglePin, onMoveToFolder, onUpdate }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(note.duration || 0);
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showFolderMenu, setShowFolderMenu] = useState(false);
  const [showTranslateMenu, setShowTranslateMenu] = useState(false);
  const [isRetitling, setIsRetitling] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [localAudioUrl, setLocalAudioUrl] = useState<string>('');
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  // Read Aloud State
  const [ttsStatus, setTtsStatus] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [activeTtsSection, setActiveTtsSection] = useState<'summary' | 'transcription' | null>(null);
  const ttsAudioRef = useRef<AudioBufferSourceNode | null>(null);
  const ttsContextRef = useRef<AudioContext | null>(null);

  const [editTitle, setEditTitle] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);

  // Hydrate audio from IndexedDB
  useEffect(() => {
    let url = '';
    const loadAudio = async () => {
      const blob = await getAudioBlob(note.id);
      if (blob) {
        url = URL.createObjectURL(blob);
        setLocalAudioUrl(url);
      }
    };
    loadAudio();
    return () => {
      if (url) URL.revokeObjectURL(url);
      stopTts(); // Cleanup TTS on unmount
    };
  }, [note.id]);

  // Sync playback speed
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed, isPlaying]);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        stopTts(); // Pause TTS if we start playing recording
        audioRef.current.play().catch(console.error);
      }
      setIsPlaying(!isPlaying);
    }
  };

  const stopTts = () => {
    if (ttsAudioRef.current) {
      try { ttsAudioRef.current.stop(); } catch (e) {}
      ttsAudioRef.current = null;
    }
    setTtsStatus('idle');
    setActiveTtsSection(null);
  };

  const handleReadAloud = async (e: React.MouseEvent, section: 'summary' | 'transcription') => {
    e.stopPropagation();
    
    if (ttsStatus === 'playing' && activeTtsSection === section) {
      stopTts();
      return;
    }

    stopTts(); // Clear any existing TTS
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }

    setTtsStatus('loading');
    setActiveTtsSection(section);

    const textToRead = section === 'summary' 
      ? note.summary 
      : (note.translatedTranscription || note.transcription);

    if (!textToRead) {
      setTtsStatus('idle');
      return;
    }

    try {
      const base64Audio = await generateSpeech(textToRead);
      const uint8 = base64ToUint8Array(base64Audio);
      
      if (!ttsContextRef.current) {
        ttsContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      
      const audioBuffer = await decodeRawPcm(uint8, ttsContextRef.current, 24000, 1);
      const source = ttsContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ttsContextRef.current.destination);
      
      source.onended = () => {
        setTtsStatus('idle');
        setActiveTtsSection(null);
      };

      source.start();
      ttsAudioRef.current = source;
      setTtsStatus('playing');
    } catch (err) {
      console.error(err);
      alert("Failed to read aloud.");
      setTtsStatus('idle');
      setActiveTtsSection(null);
    }
  };

  const cycleSpeed = (e: React.MouseEvent) => {
    e.stopPropagation();
    const currentIndex = SPEED_OPTIONS.indexOf(playbackSpeed);
    const nextIndex = (currentIndex + 1) % SPEED_OPTIONS.length;
    setPlaybackSpeed(SPEED_OPTIONS[nextIndex]);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) setDuration(audioRef.current.duration);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const textToCopy = note.translatedTranscription || note.transcription;
      navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) { console.error('Failed to copy', err); }
  };

  const handleExport = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExporting(true);
    try {
      const blob = await getAudioBlob(note.id);
      if (!blob) {
        alert("Audio file not found.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const extension = blob.type.split('/')[1]?.split(';')[0] || 'webm';
      a.download = `${note.title || 'recording'}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed", err);
      alert("Export failed.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleReTitle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRetitling(true);
    try {
      const newTitle = await reTitleNote(note.transcription);
      onUpdate(note.id, { title: newTitle });
    } finally {
      setIsRetitling(false);
    }
  };

  const handleTranslate = async (langName: string) => {
    setIsTranslating(true);
    setShowTranslateMenu(false);
    try {
      const translated = await translateText(note.transcription, langName);
      onUpdate(note.id, { translatedTranscription: translated, translatedLanguage: langName });
    } catch (err) {
      alert("Translation failed.");
    } finally {
      setIsTranslating(false);
    }
  };

  const toggleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdate(note.id, { isFavorite: !note.isFavorite });
  };

  const saveTitle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (editTitle !== null) {
      onUpdate(note.id, { title: editTitle });
      setEditTitle(null);
    }
  };

  const formatDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  const currentFolder = folders.find(f => f.id === note.folderId);

  return (
    <div 
      onClick={() => editTitle === null && setIsExpanded(!isExpanded)}
      className={`theme-bg-card border ${note.isPinned ? 'border-[var(--accent)] shadow-[var(--accent-muted)]' : 'theme-border'} rounded-2xl p-6 shadow-lg transition-all cursor-pointer hover:border-[var(--accent)] hover:shadow-xl flex flex-col h-full relative group animate-in fade-in duration-300`}
    >
      <div className="absolute -top-2 -right-2 flex gap-1 z-10">
        {note.isPinned && (
          <div className="theme-bg-accent text-white w-7 h-7 rounded-full flex items-center justify-center shadow-lg border-2 theme-bg-card">
            <i className="fas fa-thumbtack text-[11px]"></i>
          </div>
        )}
        {note.isFavorite && (
          <div className="bg-amber-400 text-white w-7 h-7 rounded-full flex items-center justify-center shadow-lg border-2 theme-bg-card">
            <i className="fas fa-star text-[11px]"></i>
          </div>
        )}
      </div>

      <div className="flex justify-between items-start mb-4">
        <div className="flex-1 min-w-0 pr-2">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
             {editTitle !== null ? (
               <div className="flex items-center gap-2 w-full" onClick={e => e.stopPropagation()}>
                 <input autoFocus value={editTitle} onChange={e => setEditTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveTitle(e as any)} className="flex-1 theme-bg-input theme-border border rounded px-2 py-1 text-lg font-black theme-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                 <button onClick={saveTitle} className="text-[10px] theme-accent font-black uppercase tracking-widest px-2 py-1 theme-bg-accent-muted rounded">Save</button>
               </div>
             ) : (
               <h3 onClick={(e) => { e.stopPropagation(); setEditTitle(note.title); }} className="text-lg font-black theme-text-primary truncate tracking-tight hover:theme-accent transition-colors">
                  {note.title || "Untitled Session"}
                </h3>
             )}
             {currentFolder && (
               <span className="px-2 py-0.5 theme-bg-accent-muted theme-accent text-[9px] font-black uppercase tracking-widest rounded-md border border-[var(--accent)] border-opacity-20">
                 {currentFolder.name}
               </span>
             )}
          </div>
          <div className="flex items-center gap-2 mt-1 opacity-70">
            <p className="text-[10px] theme-text-secondary uppercase font-black tracking-widest">{formatDate(note.timestamp)}</p>
            <span className="text-[10px] theme-text-secondary">•</span>
            <p className="text-[10px] theme-accent font-black tracking-widest">{formatTime(duration)}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-0.5 -mt-1 -mr-1">
          <button onClick={toggleFavorite} className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${note.isFavorite ? 'text-amber-400 theme-bg-input' : 'theme-text-secondary hover:text-amber-400 hover:theme-bg-input'}`} title="Mark as Favorite">
            <i className={`fas fa-star text-xs ${note.isFavorite ? 'fill-current' : ''}`}></i>
          </button>
          <button onClick={handleReTitle} className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${isRetitling ? 'animate-pulse theme-accent' : 'theme-text-secondary hover:theme-accent hover:theme-bg-input'}`} title="AI Re-title">
            <i className={`fas ${isRetitling ? 'fa-spinner fa-spin' : 'fa-magic'} text-xs`}></i>
          </button>
          <div className="relative">
            <button onClick={(e) => { e.stopPropagation(); setShowTranslateMenu(!showTranslateMenu); }} className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${isTranslating ? 'animate-pulse theme-accent' : 'theme-text-secondary hover:theme-accent hover:theme-bg-input'}`} title="Translate Transcription">
              <i className={`fas ${isTranslating ? 'fa-spinner fa-spin' : 'fa-globe'} text-xs`}></i>
            </button>
            {showTranslateMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setShowTranslateMenu(false); }}></div>
                <div className="absolute right-0 mt-2 w-40 theme-bg-card border theme-border rounded-xl shadow-2xl p-1 z-50">
                  {LANGUAGES.map(lang => (
                    <button key={lang.code} onClick={(e) => { e.stopPropagation(); handleTranslate(lang.name); }} className="w-full text-left px-3 py-2 rounded-lg text-[10px] font-bold theme-text-secondary hover:theme-bg-input hover:theme-text-primary">{lang.name}</button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="relative">
            <button onClick={(e) => { e.stopPropagation(); setShowFolderMenu(!showFolderMenu); }} className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${showFolderMenu ? 'theme-accent theme-bg-accent-muted' : 'theme-text-secondary hover:theme-bg-input'}`} title="Change Folder">
              <i className="fas fa-folder-open text-xs"></i>
            </button>
            {showFolderMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setShowFolderMenu(false); }}></div>
                <div className="absolute right-0 mt-2 w-48 theme-bg-card border theme-border rounded-xl shadow-2xl p-1 z-50">
                  <button onClick={(e) => { e.stopPropagation(); onMoveToFolder(note.id, undefined); setShowFolderMenu(false); }} className="w-full text-left px-3 py-2 rounded-lg text-xs font-bold theme-text-secondary hover:theme-bg-input hover:theme-text-primary flex items-center gap-2">
                    <i className="fas fa-inbox w-4 text-center"></i> Uncategorized
                  </button>
                  {folders.map(f => (
                    <button key={f.id} onClick={(e) => { e.stopPropagation(); onMoveToFolder(note.id, f.id); setShowFolderMenu(false); }} className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-2 ${note.folderId === f.id ? 'theme-accent theme-bg-accent-muted' : 'theme-text-secondary hover:theme-bg-input'}`}><i className="fas fa-folder w-4 text-center"></i> {f.name}</button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button onClick={(e) => { e.stopPropagation(); onTogglePin(note.id); }} className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${note.isPinned ? 'theme-accent theme-bg-accent-muted' : 'theme-text-secondary hover:theme-accent hover:theme-bg-input'}`} title="Pin Note">
            <i className="fas fa-thumbtack text-xs"></i>
          </button>
          <button onClick={handleCopy} className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${copied ? 'text-green-500 theme-bg-input' : 'theme-text-secondary hover:theme-accent hover:theme-bg-input'}`} title="Copy Transcription">
            <i className={`fas ${copied ? 'fa-check' : 'fa-copy'} text-xs`}></i>
          </button>
          <button onClick={handleExport} className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${isExporting ? 'animate-pulse theme-accent' : 'theme-text-secondary hover:theme-accent hover:theme-bg-input'}`} title="Download Recording">
            <i className={`fas ${isExporting ? 'fa-spinner fa-spin' : 'fa-download'} text-xs`}></i>
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(note.id); }} className="w-8 h-8 flex items-center justify-center rounded-lg theme-text-secondary hover:text-red-500 hover:theme-bg-input transition-all" title="Delete Note">
            <i className="fas fa-trash-alt text-xs"></i>
          </button>
        </div>
      </div>

      <div className="flex-1">
        {isExpanded ? (
          <div className="space-y-5 mb-6">
            {note.summary && (
              <div className="p-4 theme-bg-accent-muted border border-[var(--accent)] border-opacity-20 rounded-xl relative">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-black theme-accent uppercase tracking-[0.2em] block">AI Summary</span>
                  <button 
                    onClick={(e) => handleReadAloud(e, 'summary')}
                    className={`w-6 h-6 flex items-center justify-center rounded-md transition-all ${activeTtsSection === 'summary' && ttsStatus !== 'idle' ? 'theme-bg-accent text-white' : 'theme-text-secondary hover:theme-accent hover:theme-bg-input'}`}
                  >
                    <i className={`fas ${activeTtsSection === 'summary' && ttsStatus === 'loading' ? 'fa-spinner fa-spin' : (activeTtsSection === 'summary' && ttsStatus === 'playing' ? 'fa-stop' : 'fa-volume-up')} text-[10px]`}></i>
                  </button>
                </div>
                <p className="text-sm theme-text-primary leading-relaxed font-medium">{note.summary}</p>
              </div>
            )}
            <div onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black theme-text-secondary uppercase tracking-[0.2em] block">
                  {note.translatedLanguage ? `Translation (${note.translatedLanguage})` : 'Transcription'}
                </span>
                <button 
                  onClick={(e) => handleReadAloud(e, 'transcription')}
                  className={`w-6 h-6 flex items-center justify-center rounded-md transition-all ${activeTtsSection === 'transcription' && ttsStatus !== 'idle' ? 'theme-bg-accent text-white' : 'theme-text-secondary hover:theme-accent hover:theme-bg-input'}`}
                >
                  <i className={`fas ${activeTtsSection === 'transcription' && ttsStatus === 'loading' ? 'fa-spinner fa-spin' : (activeTtsSection === 'transcription' && ttsStatus === 'playing' ? 'fa-stop' : 'fa-volume-up')} text-[10px]`}></i>
                </button>
              </div>
              <p className="text-sm theme-text-secondary leading-relaxed max-h-48 overflow-y-auto pr-2 custom-scrollbar font-medium">
                {note.translatedTranscription || note.transcription}
              </p>
            </div>
          </div>
        ) : (
          <div className="mb-6 space-y-3">
            {note.summary && (
              <p className="text-sm theme-text-primary font-bold line-clamp-2 leading-relaxed">{note.summary}</p>
            )}
            <p className="text-xs theme-text-secondary line-clamp-2 italic font-medium leading-relaxed opacity-80">
              {note.translatedTranscription || note.transcription}
            </p>
          </div>
        )}
      </div>

      <div className="mt-auto pt-5 border-t theme-border border-opacity-50">
        <div className="flex items-center gap-4">
          <button 
            disabled={!localAudioUrl}
            onClick={togglePlay} 
            className="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl theme-bg-input hover:theme-bg-accent hover:text-white theme-text-primary border theme-border transition-all shadow-sm disabled:opacity-30"
          >
            <i className={`fas ${isPlaying ? 'fa-pause' : 'fa-play'} text-sm`}></i>
          </button>
          
          <div className="flex-1 space-y-1.5">
            <div className="relative w-full h-1.5 theme-bg-input rounded-full overflow-hidden">
              <div className="absolute top-0 left-0 h-full theme-bg-accent transition-all duration-100" style={{ width: `${progressPercent}%` }} />
              <input type="range" min="0" max={duration || 0} step="0.01" value={currentTime} onChange={handleSeek} onClick={(e) => e.stopPropagation()} className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer z-10" />
            </div>
            <div className="flex justify-between items-center text-[9px] font-bold theme-text-secondary tabular-nums opacity-60">
              <span>{formatTime(currentTime)}</span>
              <button 
                onClick={cycleSpeed}
                className="px-2 py-0.5 theme-bg-input border theme-border rounded-full hover:theme-accent hover:border-[var(--accent)] transition-all uppercase tracking-tighter"
              >
                {playbackSpeed}x
              </button>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
        </div>
      </div>

      <audio ref={audioRef} src={localAudioUrl} onTimeUpdate={handleTimeUpdate} onLoadedMetadata={handleLoadedMetadata} onEnded={() => setIsPlaying(false)} className="hidden" />
    </div>
  );
};

export default NoteCard;
