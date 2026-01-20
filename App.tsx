
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Note, RecordingStatus, Folder } from './types';
import { transcribeAudio } from './services/geminiService';
import { saveAudioBlob, deleteAudioBlob } from './services/storageService';
import NoteCard from './components/NoteCard';
import AudioVisualizer from './components/AudioVisualizer';
import Snowfall from './components/Snowfall';
import PinModal from './components/PinModal';

const ACCENT_COLORS = [
  { name: 'Blue', value: '#3b82f6', hover: '#2563eb' },
  { name: 'Purple', value: '#a855f7', hover: '#9333ea' },
  { name: 'Emerald', value: '#10b981', hover: '#059669' },
  { name: 'Rose', value: '#f43f5e', hover: '#e11d48' },
  { name: 'Amber', value: '#f59e0b', hover: '#d97706' },
  { name: 'Slate', value: '#64748b', hover: '#475569' },
  { name: 'Indigo', value: '#6366f1', hover: '#4f46e5' },
  { name: 'Teal', value: '#14b8a6', hover: '#0d9488' },
  { name: 'Orange', value: '#f97316', hover: '#ea580c' },
  { name: 'Cyan', value: '#06b6d4', hover: '#0891b2' },
  { name: 'Violet', value: '#8b5cf6', hover: '#7c3aed' },
  { name: 'Pink', value: '#ec4899', hover: '#db2777' },
];

type SortOption = 'newest' | 'oldest' | 'longest' | 'shortest' | 'alphabetical';
type ActiveView = 'all' | 'uncategorized' | 'favorites' | string;

const STORAGE_KEY = 'voxnotes_persistent_data';
const FOLDERS_KEY = 'voxnotes_persistent_folders';
const THEME_KEY = 'voxnotes_theme';

const getSupportedMimeType = () => {
  const types = [
    'audio/webm;codecs=opus', 
    'audio/webm', 
    'audio/mp4', 
    'audio/aac', 
    'audio/ogg;codecs=opus'
  ];
  for (const type of types) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch (e) {
      continue;
    }
  }
  return '';
};

const generateId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
};

const App: React.FC = () => {
  const [notes, setNotes] = useState<Note[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  });

  const [folders, setFolders] = useState<Folder[]>(() => {
    const saved = localStorage.getItem(FOLDERS_KEY);
    return saved ? JSON.parse(saved) : [];
  });

  const [activeView, setActiveView] = useState<ActiveView>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [status, setStatus] = useState<RecordingStatus>(RecordingStatus.IDLE);
  const [timer, setTimer] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) {
      try {
        return JSON.parse(saved).dark ?? false;
      } catch (e) { return false; }
    }
    return false;
  });
  
  const [accentColor, setAccentColor] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) {
      try {
        const val = JSON.parse(saved).accent;
        return ACCENT_COLORS.find(c => c.value === val) || ACCENT_COLORS[0];
      } catch (e) { return ACCENT_COLORS[0]; }
    }
    return ACCENT_COLORS[0];
  });

  const [isSnowing, setIsSnowing] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) {
      try {
        return JSON.parse(saved).snowing ?? false;
      } catch (e) { return false; }
    }
    return false;
  });

  const [showSettings, setShowSettings] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const [unlockedFolderIds, setUnlockedFolderIds] = useState<string[]>([]);
  const [pinModal, setPinModal] = useState<{ mode: 'set' | 'enter', folderId: string, error?: string } | null>(null);

  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)); }, [notes]);
  useEffect(() => { localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders)); }, [folders]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, JSON.stringify({
      dark: isDarkMode,
      accent: accentColor.value,
      snowing: isSnowing
    }));

    if (isDarkMode) document.body.classList.remove('light-theme');
    else document.body.classList.add('light-theme');
    
    document.documentElement.style.setProperty('--accent', accentColor.value);
    document.documentElement.style.setProperty('--accent-hover', accentColor.hover);
    document.documentElement.style.setProperty('--accent-muted', `${accentColor.value}1A`);
  }, [isDarkMode, accentColor, isSnowing]);

  const handleReset = () => {
    if (confirm("Reset Default Mode? This will erase all notes, folders, and settings.")) {
      localStorage.clear();
      const deleteRequest = window.indexedDB.deleteDatabase('VoxNotesDB');
      const reload = () => window.location.reload();
      deleteRequest.onsuccess = reload;
      deleteRequest.onerror = reload;
      deleteRequest.onblocked = reload;
      setTimeout(reload, 1000);
    }
  };

  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      } catch (err: any) {
        console.debug('Wake lock restricted:', err.message);
      }
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      } catch (err) {}
    }
  };

  const startRecording = async () => {
    let audioStream: MediaStream;
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: any) {
      alert(`Microphone Access Error: ${err.name}\n${err.message}`);
      return;
    }

    const mimeType = getSupportedMimeType();
    if (!mimeType) {
      audioStream.getTracks().forEach(t => t.stop());
      alert("Format Error: Browser incompatible.");
      return;
    }

    try {
      const recorder = new MediaRecorder(audioStream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      setStream(audioStream);
      
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };

      recorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: mimeType });
        const finalDuration = startTimeRef.current ? Math.floor((Date.now() - startTimeRef.current) / 1000) : 0;
        const targetFolder = (activeView === 'all' || activeView === 'uncategorized' || activeView === 'favorites') ? undefined : activeView;
        const noteId = generateId();
        
        setStatus(RecordingStatus.TRANSCRIBING);
        try {
          await saveAudioBlob(noteId, audioBlob);
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            const base64Audio = (reader.result as string).split(',')[1];
            try {
              const data = await transcribeAudio(base64Audio, mimeType);
              setNotes(prev => [{
                id: noteId,
                title: data.suggestedTitle,
                transcription: data.transcription,
                summary: data.summary,
                actionItems: data.actionItems,
                tags: data.tags,
                audioUrl: '', 
                timestamp: Date.now(),
                duration: finalDuration,
                isPinned: false,
                isFavorite: false,
                folderId: targetFolder
              }, ...prev]);
            } catch (transcribeErr: any) {
              alert(`Transcription failed: ${transcribeErr.message}`);
            }
            setStatus(RecordingStatus.IDLE);
            setTimer(0);
          };
        } catch (error: any) {
          alert(`Analysis Error: ${error.message}`);
          setStatus(RecordingStatus.IDLE);
          setTimer(0);
        }
      };

      recorder.start(1000);
      setStatus(RecordingStatus.RECORDING);
      requestWakeLock();
      
      startTimeRef.current = Date.now();
      setTimer(0);
      timerRef.current = setInterval(() => {
        if (startTimeRef.current) setTimer(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500); 
    } catch (err: any) { 
      audioStream.getTracks().forEach(t => t.stop());
      alert(`Initialization Error: ${err.message}`); 
      setStatus(RecordingStatus.IDLE);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && status === RecordingStatus.RECORDING) {
      mediaRecorderRef.current.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      if (stream) { stream.getTracks().forEach(t => t.stop()); setStream(null); }
      releaseWakeLock();
    }
  };

  const deleteNote = async (id: string) => {
    if (confirm("Permanently delete this recording?")) {
      await deleteAudioBlob(id);
      setNotes(prev => prev.filter(n => n.id !== id));
    }
  };

  // Helper to check if a folder is currently locked
  const isFolderLocked = (folderId?: string) => {
    if (!folderId) return false;
    const folder = folders.find(f => f.id === folderId);
    return !!(folder?.pin && !unlockedFolderIds.includes(folderId));
  };

  const filteredAndSortedNotes = useMemo(() => {
    let result = [...notes];
    
    // Globally filter out any notes belonging to locked folders regardless of current view
    const lockedFolderIds = folders.filter(f => f.pin && !unlockedFolderIds.includes(f.id)).map(f => f.id);
    
    if (activeView === 'all') {
      result = result.filter(n => !n.folderId || !lockedFolderIds.includes(n.folderId));
    } else if (activeView === 'uncategorized') {
      result = result.filter(n => !n.folderId);
    } else if (activeView === 'favorites') {
      // Hide favorites if their folder is locked
      result = result.filter(n => n.isFavorite && (!n.folderId || !lockedFolderIds.includes(n.folderId)));
    } else {
      // Direct folder view: block all notes if folder is locked
      if (lockedFolderIds.includes(activeView)) {
        return [];
      }
      result = result.filter(n => n.folderId === activeView);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(n => n.title.toLowerCase().includes(q) || n.transcription.toLowerCase().includes(q));
    }
    
    result.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      switch (sortBy) {
        case 'oldest': return a.timestamp - b.timestamp;
        case 'longest': return b.duration - a.duration;
        case 'shortest': return a.duration - b.duration;
        case 'alphabetical': return a.title.localeCompare(b.title);
        default: return b.timestamp - a.timestamp;
      }
    });
    return result;
  }, [notes, activeView, searchQuery, sortBy, folders, unlockedFolderIds]);

  const createFolder = () => {
    if (newFolderName.trim()) {
      const id = generateId();
      setFolders(prev => [...prev, { id, name: newFolderName.trim(), timestamp: Date.now() }]);
      setActiveView(id);
      setNewFolderName('');
      setIsAddingFolder(false);
    } else {
      setIsAddingFolder(false);
    }
  };

  const handleFolderClick = (folder: Folder) => {
    // Switch the view immediately. Security is handled by the visual conditional in the main view.
    setActiveView(folder.id);
    if (folder.pin && !unlockedFolderIds.includes(folder.id)) {
      setPinModal({ mode: 'enter', folderId: folder.id });
    }
  };

  const toggleFolderLock = (folder: Folder, e: React.MouseEvent) => {
    e.stopPropagation();
    if (folder.pin) {
      if (confirm("Remove PIN protection from this folder?")) {
        setFolders(prev => prev.map(f => f.id === folder.id ? { ...f, pin: undefined } : f));
        setUnlockedFolderIds(prev => prev.filter(id => id !== folder.id));
      }
    } else {
      setPinModal({ mode: 'set', folderId: folder.id });
    }
  };

  const handlePinConfirm = (pin: string) => {
    if (!pinModal) return;
    const { mode, folderId } = pinModal;
    
    if (mode === 'set') {
      setFolders(prev => prev.map(f => f.id === folderId ? { ...f, pin } : f));
      setUnlockedFolderIds(prev => [...prev, folderId]);
      setPinModal(null);
    } else {
      const folder = folders.find(f => f.id === folderId);
      if (folder?.pin === pin) {
        setUnlockedFolderIds(prev => [...prev, folderId]);
        setPinModal(null);
      } else {
        setPinModal(prev => prev ? { ...prev, error: 'Incorrect PIN' } : null);
      }
    }
  };

  const deleteFolder = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Delete folder? Notes inside will become uncategorized.")) {
      setFolders(prev => prev.filter(f => f.id !== id));
      setNotes(prev => prev.map(n => n.folderId === id ? { ...n, folderId: undefined } : n));
      if (activeView === id) setActiveView('all');
    }
  };

  const updateNote = (id: string, updates: Partial<Note>) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n));
  };

  const getActiveViewTitle = () => {
    if (activeView === 'all') return 'Library';
    if (activeView === 'uncategorized') return 'Uncategorized';
    if (activeView === 'favorites') return 'Favorites';
    return folders.find(f => f.id === activeView)?.name || 'Library';
  };

  const currentActiveFolder = folders.find(f => f.id === activeView);
  const isViewLocked = currentActiveFolder?.pin && !unlockedFolderIds.includes(activeView);

  return (
    <div className="min-h-screen theme-bg-app theme-text-primary flex flex-col md:flex-row transition-colors duration-300 relative overflow-hidden">
      {isSnowing && <Snowfall />}
      {pinModal && (
        <PinModal 
          mode={pinModal.mode} 
          error={pinModal.error}
          onConfirm={handlePinConfirm} 
          onCancel={() => {
            setPinModal(null);
            // If we cancel the enter PIN modal while viewing that folder, revert to All Notes
            if (pinModal.mode === 'enter') setActiveView('all');
          }} 
        />
      )}
      
      {!isSidebarOpen && (
        <button onClick={() => setIsSidebarOpen(true)} className="fixed left-4 top-4 z-40 w-10 h-10 rounded-xl theme-bg-card border theme-border shadow-lg flex items-center justify-center hover:theme-accent transition-all animate-in fade-in slide-in-from-left-4 duration-300">
          <i className="fas fa-bars"></i>
        </button>
      )}

      <aside className={`${isSidebarOpen ? 'w-full md:w-72' : 'w-0'} transition-all duration-300 border-r theme-border theme-bg-card flex flex-col z-50 overflow-hidden shrink-0 h-screen sticky top-0`}>
        <div className="p-6 border-b theme-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 theme-bg-accent rounded-xl flex items-center justify-center text-white shadow-lg">
                <i className="fas fa-layer-group text-lg"></i>
             </div>
             <span className="font-black uppercase tracking-widest text-xs">VoxNotes</span>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="text-lg opacity-50 hover:opacity-100 transition-opacity"><i className="fas fa-chevron-left"></i></button>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
          <button onClick={() => setActiveView('all')} className={`w-full flex items-center gap-4 px-4 py-3 rounded-2xl transition-all font-black text-xs uppercase tracking-widest ${activeView === 'all' ? 'theme-bg-accent text-white shadow-lg' : 'theme-text-secondary hover:theme-bg-input'}`}>
            <i className="fas fa-globe-americas w-5 text-center"></i> All Notes
          </button>
          <button onClick={() => setActiveView('favorites')} className={`w-full flex items-center gap-4 px-4 py-3 rounded-2xl transition-all font-black text-xs uppercase tracking-widest ${activeView === 'favorites' ? 'bg-amber-400 text-white shadow-lg' : 'theme-text-secondary hover:theme-bg-input'}`}>
            <i className="fas fa-star w-5 text-center"></i> Favorites
          </button>
          <button onClick={() => setActiveView('uncategorized')} className={`w-full flex items-center gap-4 px-4 py-3 rounded-2xl transition-all font-black text-xs uppercase tracking-widest ${activeView === 'uncategorized' ? 'theme-bg-accent text-white shadow-lg' : 'theme-text-secondary hover:theme-bg-input'}`}>
            <i className="fas fa-inbox w-5 text-center"></i> Uncategorized
          </button>

          <div className="pt-6 pb-2 px-4 flex items-center justify-between">
            <span className="text-[10px] font-black theme-text-secondary uppercase tracking-[0.3em] opacity-50">Collections</span>
            <button onClick={() => setIsAddingFolder(true)} className="w-8 h-8 rounded-lg theme-bg-input theme-text-secondary hover:theme-accent transition-all flex items-center justify-center"><i className="fas fa-plus text-[10px]"></i></button>
          </div>

          {isAddingFolder && (
            <div className="px-2 py-1 animate-in slide-in-from-top-2 duration-200">
               <div className="flex items-center gap-2 theme-bg-input border theme-border p-2 rounded-xl">
                 <input ref={newFolderInputRef} type="text" placeholder="Name..." value={newFolderName} onChange={e => setNewFolderName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createFolder()} className="flex-1 bg-transparent theme-text-primary text-xs font-bold outline-none" />
                 <button onMouseDown={createFolder} className="theme-accent p-1"><i className="fas fa-check"></i></button>
               </div>
            </div>
          )}

          {folders.map(folder => {
            const isLocked = folder.pin && !unlockedFolderIds.includes(folder.id);
            return (
              <button key={folder.id} onClick={() => handleFolderClick(folder)} className={`w-full group flex items-center gap-4 px-4 py-3 rounded-2xl transition-all font-black text-xs uppercase tracking-widest ${activeView === folder.id ? 'theme-bg-accent text-white shadow-lg' : 'theme-text-secondary hover:theme-bg-input'}`}>
                <i className={`fas ${isLocked ? 'fa-lock' : 'fa-folder'} w-5 text-center`}></i>
                <span className="truncate flex-1 text-left">{folder.name}</span>
                <div className="flex items-center gap-2">
                  <i onClick={(e) => toggleFolderLock(folder, e)} className={`fas ${folder.pin ? 'fa-key' : 'fa-shield-halved'} opacity-0 group-hover:opacity-100 transition-opacity hover:theme-accent text-[10px]`}></i>
                  <i onClick={(e) => deleteFolder(folder.id, e)} className="fas fa-trash-alt opacity-0 group-hover:opacity-100 hover:text-red-400 text-[10px]"></i>
                </div>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t theme-border shrink-0">
           <div className="p-4 theme-bg-input rounded-2xl flex items-center gap-4">
              <div className="w-8 h-8 rounded-full theme-bg-accent flex items-center justify-center text-white text-[10px] font-black">AI</div>
              <p className="text-[9px] theme-text-secondary font-bold uppercase tracking-widest">{notes.length} Records</p>
           </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
        <header className="px-6 py-5 border-b theme-border theme-bg-header backdrop-blur-xl z-20 shrink-0">
          <div className={`max-w-5xl mx-auto flex flex-col md:flex-row items-center gap-4 justify-between transition-all ${!isSidebarOpen ? 'md:pl-12' : ''}`}>
            <h1 className="text-xl font-black tracking-tighter truncate">
              {getActiveViewTitle()}
            </h1>
            <div className="flex items-center gap-3 flex-1 md:justify-end">
              <div className="relative flex-1 max-w-sm">
                <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 theme-text-secondary text-xs"></i>
                <input type="text" placeholder="Search insights..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="block w-full pl-11 pr-4 py-2.5 theme-bg-input border theme-border rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-accent transition-all" />
              </div>
              <button onClick={() => setShowSort(!showSort)} className="w-10 h-10 flex items-center justify-center rounded-xl theme-bg-input border theme-border theme-text-secondary hover:theme-accent transition-all"><i className="fas fa-sort-amount-down"></i></button>
              <button onClick={() => setShowSettings(true)} className="w-10 h-10 flex items-center justify-center rounded-xl theme-bg-input border theme-border theme-text-secondary hover:theme-accent transition-all"><i className="fas fa-palette"></i></button>
            </div>
          </div>
        </header>

        <section className="flex-1 overflow-y-auto p-6 custom-scrollbar pb-32">
          <div className="max-w-5xl mx-auto">
            {isViewLocked ? (
              <div className="py-32 flex flex-col items-center justify-center text-center animate-in fade-in zoom-in-95 duration-500">
                <div className="w-24 h-24 theme-bg-input border theme-border rounded-3xl flex items-center justify-center text-3xl theme-accent shadow-xl mb-8">
                  <i className="fas fa-lock"></i>
                </div>
                <h2 className="text-2xl font-black uppercase tracking-widest mb-4">Collection Locked</h2>
                <p className="text-xs theme-text-secondary font-bold uppercase tracking-[0.2em] max-w-xs leading-loose">
                  Enter your 4-digit PIN to access the notes in this protected collection.
                </p>
                <button 
                  onClick={() => currentActiveFolder && setPinModal({ mode: 'enter', folderId: currentActiveFolder.id })}
                  className="mt-10 px-8 py-4 theme-bg-accent text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl hover:scale-105 active:scale-95 transition-all"
                >
                  Enter PIN to Unlock
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {filteredAndSortedNotes.map(note => (
                  <NoteCard key={note.id} note={note} folders={folders} onDelete={deleteNote} onTogglePin={(id) => updateNote(id, { isPinned: !notes.find(n => n.id === id)?.isPinned })} onMoveToFolder={(noteId, folderId) => updateNote(noteId, { folderId })} onUpdate={updateNote} />
                ))}
                {filteredAndSortedNotes.length === 0 && (
                  <div className="col-span-full py-32 text-center opacity-30">
                    <i className="fas fa-microphone-slash text-4xl mb-4"></i>
                    <p className="font-black uppercase tracking-widest text-xs">No entries found</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-xl px-4">
          <div className="theme-bg-card backdrop-blur-2xl border-2 theme-border rounded-3xl p-4 shadow-2xl flex items-center gap-4 ring-1 ring-white/10">
            {status === RecordingStatus.IDLE ? (
              <>
                <div className="flex-1 px-2">
                  <p className="text-[9px] font-black uppercase tracking-[0.3em] theme-accent mb-1">Ready to Capture</p>
                  <p className="text-xs theme-text-secondary font-bold truncate">New session will be stored in {getActiveViewTitle() === 'Library' || getActiveViewTitle() === 'Uncategorized' || getActiveViewTitle() === 'Favorites' ? 'Library' : getActiveViewTitle()}</p>
                </div>
                <button onClick={startRecording} className="w-14 h-14 theme-bg-accent rounded-2xl flex items-center justify-center text-white text-xl shadow-xl hover:scale-105 active:scale-95 transition-all"><i className="fas fa-microphone"></i></button>
              </>
            ) : status === RecordingStatus.RECORDING ? (
              <>
                <div className="flex-1">
                   <div className="flex items-center gap-3 mb-2 px-2">
                     <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                     <span className="text-sm font-black theme-text-primary ml-auto tabular-nums">{Math.floor(timer/60)}:{(timer%60).toString().padStart(2,'0')}</span>
                   </div>
                   <AudioVisualizer stream={stream} isRecording={true} />
                </div>
                <button onClick={stopRecording} className="w-14 h-14 bg-red-500 rounded-2xl flex items-center justify-center text-white text-xl shadow-xl animate-pulse active:scale-95 transition-all"><i className="fas fa-stop"></i></button>
              </>
            ) : (
              <div className="flex-1 flex items-center gap-4 py-2 px-2 animate-pulse">
                <div className="w-10 h-10 theme-bg-accent rounded-xl flex items-center justify-center text-white">
                  <i className="fas fa-wand-magic-sparkles fa-spin"></i>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest theme-accent">Gemini Intelligence</p>
                  <p className="text-xs font-bold opacity-60">Extracting insights and action items...</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {showSettings && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowSettings(false)}></div>
            <div className="relative w-full max-w-md theme-bg-card border theme-border rounded-[2.5rem] p-8 animate-in zoom-in-95 duration-200 shadow-2xl">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-xl font-black uppercase tracking-widest">Theme</h2>
                <button onClick={() => setShowSettings(false)} className="w-8 h-8 flex items-center justify-center theme-text-secondary hover:theme-text-primary transition-colors"><i className="fas fa-times"></i></button>
              </div>
              
              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 theme-bg-input rounded-2xl border theme-border">
                   <span className="text-sm font-black uppercase tracking-widest">{isDarkMode ? 'Dark mode' : 'Light mode'}</span>
                   <button onClick={() => setIsDarkMode(!isDarkMode)} className={`w-14 h-8 rounded-full relative transition-all ${isDarkMode ? 'theme-bg-accent' : 'bg-gray-400'}`}>
                     <div className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all shadow-md ${isDarkMode ? 'left-7' : 'left-1'}`}></div>
                   </button>
                </div>

                <div className="p-4 theme-bg-input rounded-2xl border theme-border">
                   <p className="text-sm font-black uppercase tracking-widest mb-4">Color Palette</p>
                   <div className="flex flex-wrap gap-4">
                     {ACCENT_COLORS.map(c => (
                       <button 
                         key={c.name} 
                         onClick={() => setAccentColor(c)} 
                         className={`w-10 h-10 rounded-xl border-4 transition-transform hover:scale-110 ${accentColor.value === c.value ? 'border-white shadow-lg' : 'border-transparent opacity-60 hover:opacity-100'}`} 
                         style={{ backgroundColor: c.value }} 
                         title={c.name}
                       />
                     ))}
                   </div>
                </div>

                <button 
                  onClick={() => setIsSnowing(!isSnowing)} 
                  className={`w-full py-4 rounded-2xl border transition-all text-xs font-black uppercase tracking-widest flex items-center justify-center gap-3 ${isSnowing ? 'theme-bg-accent text-white border-transparent shadow-lg' : 'theme-bg-input border-theme-border theme-text-primary hover:theme-accent hover:border-accent'}`}
                >
                  <i className={`fas ${isSnowing ? 'fa-snowflake animate-spin' : 'fa-snowflake'}`}></i>
                  {isSnowing ? 'Stop Snowing' : 'Let it Snow'}
                </button>

                <div className="pt-4 mt-4 border-t theme-border opacity-50"></div>

                <button 
                  onClick={handleReset} 
                  className="w-full py-4 rounded-2xl border border-red-500/50 text-red-500 text-xs font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all flex items-center justify-center gap-3"
                >
                  <i className="fas fa-trash-arrow-up"></i>
                  Reset Default Mode
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
