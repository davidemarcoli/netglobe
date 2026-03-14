export function initMenu(onAction: (action: string) => void) {
  const btn = document.getElementById('menu-btn')!;
  const overlay = document.getElementById('menu-overlay')!;
  const panel = document.getElementById('menu-panel')!;

  function open() {
    overlay.classList.remove('hidden');
    panel.classList.remove('hidden');
  }

  function close() {
    overlay.classList.add('hidden');
    panel.classList.add('hidden');
  }

  function toggle() {
    if (panel.classList.contains('hidden')) open(); else close();
  }

  btn.addEventListener('click', toggle);
  overlay.addEventListener('click', close);

  // Menu action buttons
  panel.querySelectorAll('button[data-action]').forEach((el) => {
    el.addEventListener('click', () => {
      const action = (el as HTMLElement).dataset.action!;
      close();
      onAction(action);
    });
  });

  return { open, close, toggle, isOpen: () => !panel.classList.contains('hidden') };
}
