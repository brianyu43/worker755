const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** The modifier key name players see in shortcut hints. */
export const MOD = isMac ? '⌘' : 'Ctrl';

/**
 * A phone or tablet, by its main pointer: focusing a text field there opens the on-screen keyboard,
 * so the cursor goes into the terminal only when the player taps it, never on its own.
 */
export const touchOnly = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;
