const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** The modifier key name players see in shortcut hints. */
export const MOD = isMac ? '⌘' : 'Ctrl';
