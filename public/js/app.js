(() => {
  const body = document.body;
  const sidebar = document.querySelector('[data-sidebar]');
  const backdrop = document.querySelector('[data-sidebar-backdrop]');
  const toggles = [...document.querySelectorAll('[data-sidebar-toggle]')];
  const closers = [...document.querySelectorAll('[data-sidebar-close]')];
  if (sidebar && toggles.length) {
    const setOpen = (open) => {
      sidebar.classList.toggle('-translate-x-full', !open);
      backdrop?.classList.toggle('hidden', !open);
      backdrop?.classList.toggle('opacity-0', !open);
      backdrop?.classList.toggle('opacity-100', open);
      body.classList.toggle('overflow-hidden', open && window.innerWidth < 1024);
      sidebar.setAttribute('aria-hidden', open ? 'false' : String(window.innerWidth < 1024));
      for (const toggle of toggles) {
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.setAttribute('aria-label', open ? 'Tutup menu navigasi' : 'Buka menu navigasi');
      }
      if (open && window.innerWidth < 1024) sidebar.querySelector('a,button')?.focus({ preventScroll: true });
    };
    const open = () => setOpen(true);
    const close = () => setOpen(false);
    for (const toggle of toggles) toggle.addEventListener('click', () => sidebar.classList.contains('-translate-x-full') ? open() : close());
    for (const closer of closers) closer.addEventListener('click', close);
    backdrop?.addEventListener('click', close);
    sidebar.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => { if (window.innerWidth < 1024) close(); }));
    window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && window.innerWidth < 1024) close(); });
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 1024) {
        body.classList.remove('overflow-hidden');
        backdrop?.classList.add('hidden','opacity-0');
        backdrop?.classList.remove('opacity-100');
        sidebar.classList.remove('-translate-x-full');
        sidebar.setAttribute('aria-hidden','false');
      } else if (!body.classList.contains('overflow-hidden')) {
        sidebar.classList.add('-translate-x-full');
        sidebar.setAttribute('aria-hidden','true');
        for (const toggle of toggles) toggle.setAttribute('aria-expanded','false');
      }
    }, { passive: true });
    if (window.innerWidth < 1024) setOpen(false);
  }

  document.querySelectorAll('[data-nav-group-toggle]').forEach((button) => {
    const target = document.getElementById(button.getAttribute('aria-controls') || '');
    if (!target) return;
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') !== 'false';
      button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      target.hidden = expanded;
      button.querySelector('[data-chevron]')?.classList.toggle('rotate-180', !expanded);
    });
  });

  document.querySelectorAll('[data-confirm]').forEach((el) => {
    el.addEventListener('click', (event) => {
      if (!window.confirm(el.getAttribute('data-confirm'))) event.preventDefault();
    });
  });
})();

(() => {
  const form = document.querySelector('[data-file-upload]');
  if (!form) return;
  const status = document.querySelector('[data-upload-status]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (status) status.textContent = 'Uploading…';
    try {
      const response = await fetch(form.dataset.action, { method: 'POST', headers: { 'x-csrf-token': form.dataset.csrf || '' }, body: new FormData(form), credentials: 'same-origin' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Upload gagal.');
      if (status) status.textContent = `Uploaded ${data.path}`;
      window.location.reload();
    } catch (error) { if (status) status.textContent = error.message || 'Upload gagal.'; }
  });
})();

(() => {
  const pre = document.querySelector('[data-log-source]');
  if (!pre) return;
  const source = pre.dataset.logSource;
  const csrf = pre.dataset.csrf || '';
  let stopped = false;
  async function refresh() {
    if (stopped || document.hidden) return;
    try {
      const r = await fetch(`/logs/tail?source=${encodeURIComponent(source)}&lines=250`, { headers: { accept: 'application/json', 'x-csrf-token': csrf }, credentials: 'same-origin' });
      if (r.ok) { const data = await r.json(); pre.textContent = data.logs || ''; pre.scrollTop = pre.scrollHeight; }
    } catch {}
  }
  const timer = setInterval(refresh, 5000);
  timer.unref?.();
  window.addEventListener('beforeunload', () => { stopped = true; clearInterval(timer); });
})();

(() => {
  const sourceCards = [...document.querySelectorAll('[data-project-source]')];
  const sourceInput = document.querySelector('[name="source_mode"]');
  if (!sourceCards.length || !sourceInput) return;
  function select(mode) {
    sourceInput.value = mode;
    for (const card of sourceCards) card.classList.toggle('project-source-active', card.dataset.projectSource === mode);
    document.querySelectorAll('[data-source-panel]').forEach((panel) => panel.hidden = panel.dataset.sourcePanel !== mode);
  }
  for (const card of sourceCards) card.addEventListener('click', () => select(card.dataset.projectSource));
  select(sourceInput.value || 'github');
})();

(() => {
  const repoButtons = document.querySelectorAll('[data-github-repo]');
  const repoInput = document.querySelector('[name="git_repo"]');
  const branchInput = document.querySelector('[name="git_branch"]');
  const status = document.querySelector('[data-repo-inspect-status]');
  if (!repoButtons.length || !repoInput) return;
  repoButtons.forEach((button) => button.addEventListener('click', async () => {
    repoButtons.forEach((x) => x.classList.remove('repo-card-active'));
    button.classList.add('repo-card-active');
    repoInput.value = button.dataset.githubRepo || '';
    if (branchInput && button.dataset.defaultBranch) branchInput.value = button.dataset.defaultBranch;
    if (status) status.textContent = 'Mendeteksi framework…';
    try {
      const r = await fetch(`/apps/github/inspect?repo=${encodeURIComponent(button.dataset.githubRepo || '')}`, { headers: { accept: 'application/json' }, credentials: 'same-origin' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Repository tidak dapat diperiksa.');
      const map = { install_command: data.installCommand, build_script: data.buildScript, start_mode: data.startMode, npm_script: data.npmScript, entry_file: data.entryFile, health_path: data.healthPath, template: 'existing' };
      for (const [name,value] of Object.entries(map)) { const el = document.querySelector(`[name="${name}"]`); if (el && value !== undefined && value !== null) el.value = value; }
      if (status) status.textContent = `${data.framework || 'Node.js'} · konfigurasi otomatis diterapkan`;
    } catch (error) { if (status) status.textContent = error.message; }
  }));
})();

(() => {
  const name = document.querySelector('[data-project-name]');
  const slug = document.querySelector('[data-project-slug]');
  const dir = document.querySelector('[data-project-dir]');
  if (!name || !slug) return;
  let edited = Boolean(slug.value);
  slug.addEventListener('input', () => { edited = true; if (dir) dir.value = `/nusantara-hostpanel/apps/${slug.value}`; });
  name.addEventListener('input', () => {
    if (edited) return;
    const value = name.value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
    slug.value = value;
    if (dir) dir.value = value ? `/nusantara-hostpanel/apps/${value}` : '';
  });
})();
