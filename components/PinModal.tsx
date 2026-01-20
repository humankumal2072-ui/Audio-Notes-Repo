
import React, { useState, useEffect } from 'react';

interface PinModalProps {
  mode: 'set' | 'enter';
  onConfirm: (pin: string) => void;
  onCancel: () => void;
  error?: string;
  title?: string;
}

const PinModal: React.FC<PinModalProps> = ({ mode, onConfirm, onCancel, error, title }) => {
  const [pin, setPin] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length === 4) {
      onConfirm(pin);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <div className="fixed inset-0 bg-black/80 backdrop-blur-md" onClick={onCancel}></div>
      <div className="relative w-full max-w-xs theme-bg-card border theme-border rounded-[2.5rem] p-8 shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 theme-bg-accent rounded-2xl flex items-center justify-center text-white shadow-xl mb-6">
            <i className={`fas ${mode === 'set' ? 'fa-lock' : 'fa-key'} text-2xl`}></i>
          </div>
          
          <h2 className="text-lg font-black uppercase tracking-widest mb-2">
            {title || (mode === 'set' ? 'Secure Folder' : 'Unlock Folder')}
          </h2>
          <p className="text-[10px] theme-text-secondary font-bold uppercase tracking-widest mb-8">
            {mode === 'set' ? 'Set a 4-digit PIN to protect your notes' : 'Enter PIN to access this collection'}
          </p>

          <form onSubmit={handleSubmit} className="w-full space-y-6">
            <div className="flex justify-center gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div 
                  key={i} 
                  className={`w-12 h-16 rounded-2xl border-2 flex items-center justify-center text-2xl font-black transition-all ${
                    pin.length > i ? 'theme-border theme-bg-accent text-white shadow-lg shadow-[var(--accent-muted)]' : 'theme-border theme-bg-input'
                  }`}
                >
                  {pin.length > i ? '•' : ''}
                </div>
              ))}
            </div>

            <input
              autoFocus
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '');
                if (val.length <= 4) setPin(val);
              }}
              className="absolute opacity-0 pointer-events-none"
            />

            {error && (
              <p className="text-red-500 text-[10px] font-black uppercase tracking-widest animate-bounce">{error}</p>
            )}

            <div className="flex gap-3">
              <button 
                type="button" 
                onClick={onCancel}
                className="flex-1 py-4 rounded-2xl theme-bg-input border theme-border text-[10px] font-black uppercase tracking-widest hover:theme-text-primary transition-all"
              >
                Cancel
              </button>
              <button 
                type="submit"
                disabled={pin.length < 4}
                className="flex-1 py-4 rounded-2xl theme-bg-accent text-white shadow-lg text-[10px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100"
              >
                Confirm
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default PinModal;
