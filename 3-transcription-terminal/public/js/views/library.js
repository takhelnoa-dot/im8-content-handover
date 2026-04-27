import { api } from '/js/lib/api.js';
import { toast, el, formatTime } from '/js/lib/ui.js';

export async function libraryView(root) {
  root.appendChild(el('h2', {}, 'Library'));

  const bar = el('div', { class: 'library-bar' });
  const sortSel = el('select', { class: 'form-input' },
    el('option', { value: 'newest' }, 'Newest'),
    el('option', { value: 'oldest' }, 'Oldest'),
    el('option', { value: 'longest' }, 'Longest'),
  );
  sortSel.onchange = load;
  bar.appendChild(el('label', {}, 'Sort: ', sortSel));

  const selectAll = el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
    const allSelected = selected.size === currentVideos.length && currentVideos.length > 0;
    if (allSelected) selected.clear();
    else for (const v of currentVideos) selected.add(v.id);
    refreshSelectionUI();
  } }, 'Select all');
  bar.appendChild(selectAll);

  const selectionInfo = el('span', { class: 'selection-info subtle' });
  bar.appendChild(selectionInfo);

  const bulkDelete = el('button', { class: 'btn btn-sm btn-danger', style: 'display:none', onclick: async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} video(s) from the library? Drive files are untouched.`)) return;
    let n = 0;
    for (const id of ids) {
      try { await api.del(`/api/videos/${id}`); n++; } catch {}
    }
    toast(`Deleted ${n}`, 'success');
    selected.clear();
    load();
  } }, 'Delete selected');
  bar.appendChild(bulkDelete);
  root.appendChild(bar);

  const grid = el('div', { class: 'video-grid' });
  root.appendChild(grid);

  const selected = new Set();
  let currentVideos = [];

  function refreshSelectionUI() {
    const n = selected.size;
    selectionInfo.textContent = n ? `${n} selected` : '';
    bulkDelete.style.display = n ? '' : 'none';
    for (const card of grid.querySelectorAll('.video-card')) {
      const cb = card.querySelector('input.video-cb');
      if (cb) cb.checked = selected.has(cb.dataset.id);
      card.classList.toggle('is-selected', selected.has(cb?.dataset.id));
    }
  }

  async function load() {
    grid.innerHTML = 'Loading...';
    selected.clear();
    refreshSelectionUI();
    try {
      const r = await api.get(`/api/videos?sort=${sortSel.value}&status=ready`);
      currentVideos = r.videos || [];
      grid.innerHTML = '';
      if (!currentVideos.length) {
        grid.appendChild(el('p', { class: 'subtle' }, 'No transcribed videos yet. Check Upload to see queue progress.'));
        return;
      }
      for (const v of currentVideos) grid.appendChild(renderCard(v));
    } catch (e) { toast(e.message, 'error'); }
  }

  function renderCard(v) {
    const thumb = v.thumbnail_path ? el('img', { src: `/${v.thumbnail_path}` }) : el('div', { class: 'thumb-placeholder' });

    const cb = el('input', { type: 'checkbox', class: 'video-cb' });
    cb.dataset.id = v.id;
    cb.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      selected.has(v.id) ? selected.delete(v.id) : selected.add(v.id);
      refreshSelectionUI();
    };

    const trash = el('button', { class: 'video-trash', title: 'Delete this video' }, '×');
    trash.onclick = async (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!confirm(`Delete "${v.title}" from the library? Drive file is untouched.`)) return;
      try { await api.del(`/api/videos/${v.id}`); toast('Deleted', 'success'); load(); }
      catch (err) { toast(err.message, 'error'); }
    };

    const card = el('a', { class: 'video-card', href: `#/video/${v.id}` },
      el('div', { class: 'video-card-controls' }, cb, trash),
      thumb,
      el('div', { class: 'video-card-body' },
        el('strong', {}, v.title),
        el('div', { class: 'subtle' }, `${formatTime(v.duration_seconds)} · ${v.status}`),
        el('div', { class: 'chips' }, ...(v.speakers || []).slice(0, 3).map(s => el('span', { class: 'chip chip-speaker' }, s.name))),
        el('div', { class: 'chips' }, ...(v.categories || []).slice(0, 3).map(c => el('span', { class: 'chip chip-category' }, c.name))),
      )
    );
    return card;
  }

  load();
}
