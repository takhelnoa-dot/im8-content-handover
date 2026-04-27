import { api } from '/js/lib/api.js';
import { toast, el } from '/js/lib/ui.js';

export async function speakersView(root) {
  root.appendChild(el('h2', {}, 'Speakers'));

  const bar = el('div', { class: 'library-bar' });
  const hideEmptyCb = el('input', { type: 'checkbox', checked: 'checked' });
  bar.appendChild(el('label', { class: 'inline-toggle' }, hideEmptyCb, el('span', {}, ' Hide speakers with no segments')));
  bar.appendChild(el('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
    if (!confirm('Delete all "Unknown Speaker" entries with no associated segments?')) return;
    const r = await api.post('/api/speakers/cleanup-orphans');
    toast(`Cleaned up ${r.deleted} orphan entries`, 'success');
    load();
  } }, 'Cleanup orphans'));
  root.appendChild(bar);

  const table = el('table', { class: 'data-table speakers-table' },
    el('thead', {}, el('tr', {},
      el('th', {}, ''),
      el('th', {}, ''),
      el('th', {}, 'Name'),
      el('th', {}, 'Videos'),
      el('th', {}, 'Segments'),
      el('th', {}, 'Notes'),
      el('th', {}, 'Actions')
    ))
  );
  const tbody = el('tbody');
  table.appendChild(tbody);
  root.appendChild(table);

  const mergeBtn = el('button', { class: 'btn btn-primary' }, 'Merge selected...');
  mergeBtn.disabled = true;
  root.appendChild(mergeBtn);

  const checked = new Set();
  hideEmptyCb.onchange = load;

  async function load() {
    tbody.innerHTML = '';
    checked.clear();
    mergeBtn.disabled = true;
    const url = '/api/speakers' + (hideEmptyCb.checked ? '?hideEmpty=1' : '');
    const { speakers } = await api.get(url);
    for (const s of speakers) {
      const cb = el('input', { type: 'checkbox' });
      cb.onchange = () => { cb.checked ? checked.add(s.id) : checked.delete(s.id); mergeBtn.disabled = checked.size < 2; };
      const avatar = s.image_url
        ? el('img', { src: s.image_url, class: 'speaker-avatar', referrerpolicy: 'no-referrer', alt: s.name })
        : el('div', { class: 'speaker-avatar speaker-avatar-empty' }, (s.name || '?').charAt(0).toUpperCase());
      tbody.appendChild(el('tr', {},
        el('td', {}, cb),
        el('td', { class: 'speaker-avatar-cell' }, avatar),
        el('td', {}, s.name + (s.is_starred ? ' *' : '')),
        el('td', {}, String(s.video_count)),
        el('td', {}, String(s.segment_count)),
        el('td', {}, s.notes || ''),
        el('td', { class: 'speaker-actions' },
          el('button', { class: 'btn btn-sm btn-ghost', onclick: async () => {
            const n = prompt('New name:', s.name);
            if (n) { await api.patch(`/api/speakers/${s.id}`, { name: n }); load(); }
          } }, 'Rename'),
          el('button', { class: 'btn btn-sm btn-ghost', onclick: async () => {
            const u = prompt('Image URL (paste a public photo URL):', s.image_url || '');
            if (u != null) { await api.patch(`/api/speakers/${s.id}`, { image_url: u }); load(); }
          } }, 'Image'),
          el('button', { class: 'btn btn-sm btn-ghost', onclick: async () => {
            await api.patch(`/api/speakers/${s.id}`, { is_starred: !s.is_starred }); load();
          } }, s.is_starred ? 'Unstar' : 'Star')
        )
      ));
    }
  }

  mergeBtn.onclick = async () => {
    const ids = Array.from(checked);
    const targetName = prompt(`Merging ${ids.length} speakers. Target display name?`);
    if (!targetName) return;
    const { speaker } = await api.post('/api/speakers', { name: targetName });
    await api.post('/api/speakers/merge', { sourceIds: ids, targetId: speaker.id });
    toast('Merged', 'success');
    load();
  };

  load();
}
