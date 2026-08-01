import { useCallback, useEffect, useState } from 'react';

const MRU_KEY = 'transcription_language_recents';
const MRU_EVENT = 'meetily:transcription-language-recents-changed';
const MAX_RECENTS = 5;
let lastCommittedValues: string[] = [];

function isRecentLanguage(code: unknown): code is string {
  return typeof code === 'string'
    && code.length > 0
    && code !== 'auto'
    && code !== 'auto-translate';
}

function readStorageResult(): { values: string[]; accessible: boolean } {
  if (typeof window === 'undefined') return { values: [], accessible: false };
  try {
    const raw = window.localStorage.getItem(MRU_KEY);
    if (!raw) return { values: [], accessible: true };
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { values: [], accessible: true };
    const recents: string[] = [];
    for (const item of parsed) {
      if (!isRecentLanguage(item) || recents.includes(item)) continue;
      recents.push(item);
      if (recents.length >= MAX_RECENTS) break;
    }
    return { values: recents, accessible: true };
  } catch {
    return { values: [], accessible: false };
  }
}

function readFromStorage(): string[] {
  return readStorageResult().values;
}

function normalize(values: unknown[]): string[] {
  const normalized: string[] = [];
  for (const item of values) {
    if (!isRecentLanguage(item) || normalized.includes(item)) continue;
    normalized.push(item);
    if (normalized.length >= MAX_RECENTS) break;
  }
  return normalized;
}

function writeToStorage(values: string[]): string[] {
  const committed = normalize(values);
  lastCommittedValues = committed;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(MRU_KEY, JSON.stringify(committed));
    } catch {
      // The same-document event still keeps mounted pickers coherent.
    }
  }
  return committed;
}

/** MRU list of recently used transcription languages (max 5, localStorage). */
export function useRecentTranscriptionLanguages() {
  const [recents, setRecents] = useState<string[]>(() => readFromStorage());

  useEffect(() => {
    lastCommittedValues = readFromStorage();
    const onStorage = (event: StorageEvent) => {
      if (event.key === MRU_KEY) {
        const values = readFromStorage();
        lastCommittedValues = values;
        setRecents(values);
      }
    };
    const onSameDocumentUpdate = (event: Event) => {
      const values = (event as CustomEvent<string[]>).detail;
      if (Array.isArray(values)) {
        lastCommittedValues = normalize(values);
        setRecents(lastCommittedValues);
      }
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(MRU_EVENT, onSameDocumentUpdate);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(MRU_EVENT, onSameDocumentUpdate);
    };
  }, []);

  const addRecent = useCallback((code: unknown) => {
    if (!isRecentLanguage(code)) return;
    const persisted = readStorageResult();
    const latest = persisted.accessible ? persisted.values : lastCommittedValues;
    const committed = writeToStorage([code, ...latest.filter((item) => item !== code)]);
    setRecents(committed);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<string[]>(MRU_EVENT, { detail: committed }));
    }
  }, []);

  return { recents, addRecent };
}
