"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';

export interface AudioPlayerHandle {
  /** Jump to a position (seconds) and start playing. */
  seekTo: (seconds: number) => void;
}

interface AudioPlayerProps {
  /** Meeting recording folder containing audio.mp4. */
  folderPath: string;
}

/**
 * Plays the meeting's recorded audio (audio.mp4 in the recording folder)
 * through the Tauri asset protocol. Renders nothing when the file is
 * missing or unreadable, so meetings without a recording look unchanged.
 */
export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(
  function AudioPlayer({ folderPath }, ref) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [available, setAvailable] = useState(true);
    const src = useMemo(() => convertFileSrc(`${folderPath}/audio.mp4`), [folderPath]);

    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => {
        const el = audioRef.current;
        if (!el) return;
        el.currentTime = Math.max(0, seconds);
        el.play().catch(() => {});
      },
    }), []);

    if (!available) return null;
    return (
      <audio
        ref={audioRef}
        src={src}
        controls
        preload="metadata"
        className="w-full h-9"
        onError={() => setAvailable(false)}
      />
    );
  },
);
