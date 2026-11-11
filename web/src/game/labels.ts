// Display names for manager models, filled from the model list on the start screen.
// Kept in sessionStorage so a reload mid-shift still shows the name.
const KEY = 'w755-model-labels';

function load(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function rememberLabels(models: { id: string; label: string }[]) {
  const all = load();
  for (const m of models) all[m.id] = m.label;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
}

export function modelLabel(id: string) {
  return load()[id] ?? (id.includes('/') ? id.slice(id.indexOf('/') + 1) : id);
}
