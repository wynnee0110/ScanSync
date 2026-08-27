const PREFERENCE_PREFIX = 'attendance-manager.preference.';

export const SELECTED_EVENT_KEY = 'scanner.selected_event_id';

export async function getPreference(key: string): Promise<string | null> {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage.getItem(`${PREFERENCE_PREFIX}${key}`);
}

export async function setPreference(key: string, value: string): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(`${PREFERENCE_PREFIX}${key}`, value);
}