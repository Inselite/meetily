export interface TranscriptionLanguageOption {
  code: string;
  name: string;
}

/** Resolves MRU codes against a naming catalog and removes displayed recents from the full list. */
export function groupTranscriptionLanguages<T extends TranscriptionLanguageOption>(
  recents: readonly string[],
  allOptions: readonly T[],
  nameOptions: readonly TranscriptionLanguageOption[],
): { recentLanguages: TranscriptionLanguageOption[]; allLanguages: T[] } {
  const namesByCode = new Map(nameOptions.map(option => [option.code, option]));
  const seen = new Set<string>();
  const recentLanguages: TranscriptionLanguageOption[] = [];

  for (const code of recents) {
    if (code === 'auto' || code === 'auto-translate' || seen.has(code)) continue;
    const option = namesByCode.get(code);
    if (!option) continue;
    seen.add(code);
    recentLanguages.push(option);
  }

  return {
    recentLanguages,
    allLanguages: allOptions.filter(option => !seen.has(option.code)),
  };
}
