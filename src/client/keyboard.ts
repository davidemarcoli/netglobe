export type KeyAction =
  | 'unmapped'
  | 'lan_local'
  | 'open_ports'
  | 'cache_terminal'
  | 'clear_cache'
  | 'recheck_geoip'
  | 'help'
  | 'about'
  | 'escape';

const KEY_MAP: Record<string, KeyAction> = {
  u: 'unmapped',
  l: 'lan_local',
  o: 'open_ports',
  t: 'cache_terminal',
  c: 'clear_cache',
  r: 'recheck_geoip',
  h: 'help',
  a: 'about',
  Escape: 'escape',
};

export function initKeyboard(handler: (action: KeyAction) => void) {
  document.addEventListener('keydown', (e) => {
    // Ignore if typing in an input/textarea
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const action = KEY_MAP[e.key];
    if (action) {
      e.preventDefault();
      handler(action);
    }
  });
}
