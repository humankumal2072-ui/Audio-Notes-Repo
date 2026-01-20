
import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  stream: MediaStream | null;
  isRecording: boolean;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ stream, isRecording }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const safeCloseContext = async () => {
      // Clear animation first
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      
      // Capture reference and clear it immediately to prevent double calls
      const ctx = audioCtxRef.current;
      if (ctx) {
        audioCtxRef.current = null; 
        
        // Only attempt close if not already closed
        if (ctx.state !== 'closed') {
          try {
            await ctx.close();
          } catch (e) {
            // Silence "already closed" or state transition errors
            // as the end state (closed) is what we desire anyway.
          }
        }
      }
    };

    if (!isRecording || !stream) {
      safeCloseContext();
      return;
    }

    let isAborted = false;

    const initAudio = async () => {
      try {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        
        // Handle race condition where recording stopped while initializing context
        if (isAborted) {
          try { 
            if (audioContext.state !== 'closed') await audioContext.close(); 
          } catch (e) {}
          return;
        }
        
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }
        
        audioCtxRef.current = audioContext;

        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3b82f6';

        const draw = () => {
          if (isAborted || !audioCtxRef.current) return;
          
          animationRef.current = requestAnimationFrame(draw);
          analyser.getByteFrequencyData(dataArray);

          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const barWidth = (canvas.width / bufferLength) * 2.5;
          let x = 0;

          for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * canvas.height;
            ctx.fillStyle = accentColor;
            ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
          }
        };

        draw();
      } catch (e) {
        console.error("Visualizer setup failed:", e);
      }
    };

    initAudio();

    return () => {
      isAborted = true;
      safeCloseContext();
    };
  }, [isRecording, stream]);

  return (
    <canvas 
      ref={canvasRef} 
      className="w-full h-12 rounded-lg theme-bg-input opacity-80" 
      width={400} 
      height={48}
    />
  );
};

export default AudioVisualizer;
