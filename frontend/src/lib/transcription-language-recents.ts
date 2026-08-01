export interface TranscriptionLanguageOption {
  code: string;
  name: string;
}

/** A language code is eligible as a "recent" only if it names a real language —
 *  the auto-detect pseudo-codes are modes, not languages. Single definition,
 *  shared by the MRU hook (what gets stored) and the grouping below (what gets shown). */
export function isRecentLanguage(code: unknown): code is string {
  return typeof code === 'string'
    && code.length > 0
    && code !== 'auto'
    && code !== 'auto-translate';
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
    if (!isRecentLanguage(code) || seen.has(code)) continue;
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
