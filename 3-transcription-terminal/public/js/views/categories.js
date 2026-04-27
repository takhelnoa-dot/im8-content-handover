import { api } from '/js/lib/api.js';
import { toast, el } from '/js/lib/ui.js';

export async function categoriesView(root) {
  root.appendChild(el('h2', {}, 'Categories'));
  const retagAll = el('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
    if (!confirm('Re-tag every ready video? This can take a while and costs API credits.')) return;
    const r = await api.post('/api/categories/retag-all');
    toast(`${r.requeued} videos re-queued`, 'info');
  } }, 'Retag all videos');
  root.appendChild(retagAll);

  const cols = el('div', { class: 'cat-columns' });
  const officialCol = el('div', { class: 'cat-col' }, el('h3', {}, 'Official'));
  const proposedCol = el('div', { class: 'cat-col' }, el('h3', {}, 'Proposed'));
  cols.appendChild(officialCol);
  cols.appendChild(proposedCol);
  root.appendChild(cols);

  async function load() {
    officialCol.querySelectorAll('.cat-row').forEach(e => e.remove());
    proposedCol.querySelectorAll('.cat-row').forEach(e => e.remove());
    const { categories } = await api.get('/api/categories');
    for (const c of categories) {
      const col = c.status === 'proposed' ? proposedCol : officialCol;
      col.appendChild(renderRow(c));
    }
  }

  function renderRow(c) {
    const actions = el('div', { class: 'cat-actions' });
    if (c.status === 'proposed') {
      actions.appendChild(el('button', { class: 'btn btn-sm btn-primary', onclick: async () => { await api.post(`/api/categories/${c.id}/promote`); toast('Promoted', 'success'); load(); } }, 'Promote'));
      actions.appendChild(el('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { if (confirm(`Reject "${c.name}"?`)) { await api.post(`/api/categories/${c.id}/reject`); toast('Rejected', 'info'); load(); } } }, 'Reject'));
    } else {
      actions.appendChild(el('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { const d = prompt('Description:', c.description || ''); if (d != null) { await api.patch(`/api/categories/${c.id}`, { description: d }); load(); } } }, 'Edit description'));
    }
    return el('div', { class: 'cat-row' },
      el('div', {},
        el('strong', {}, c.name),
        ' ',
        el('span', { class: 'subtle' }, `(${c.video_count})`),
        el('div', { class: 'subtle' }, c.description || '(no description)')
      ),
      actions
    );
  }

  load();
}
