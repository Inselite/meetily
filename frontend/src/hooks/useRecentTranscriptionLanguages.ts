import { useCallback, useEffect, useState } from 'react';

const MRU_KEY = 'transcription_language_recents';
const MAX_RECENTS = 5;

function isRecentLanguage(code: unknown): code is string {
  return typeof code === 'string'
    && code.length > 0
    && code !== 'auto'
    && code !== 'auto-translate';
}

function readFromStorage(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(MRU_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const recents: string[] = [];
    for (const item of parsed) {
      if (!isRecentLanguage(item) || recents.includes(item)) continue;
      recents.push(item);
      if (recents.length >= MAX_RECENTS) break;
    }
    return recents;
  } catch {
    return [];
  }
}

function writeToStorage(values: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MRU_KEY, JSON.stringify(values));
  } catch {
    // Cosmetic list only, silent if storage is unavailable.
  }
}

/** MRU list of recently used transcription languages (max 5, localStorage). */
export function useRecentTranscriptionLanguages() {
  const [recents, setRecents] = useState<string[]>(() => readFromStorage());

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === MRU_KEY) setRecents(readFromStorage());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const addRecent = useCallback((code: unknown) => {
    if (!isRecentLanguage(code)) return;
    setRecents((previous) => {
      const updated = [code, ...previous.filter((item) => item !== code)].slice(0, MAX_RECENTS);
      writeToStorage(updated);
      return updated;
    });
  }, []);

  return { recents, addRecent };
}
