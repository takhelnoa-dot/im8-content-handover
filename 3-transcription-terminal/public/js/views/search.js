import { api } from '/js/lib/api.js';
import { toast, el, formatTime, openModal } from '/js/lib/ui.js';

export async function searchView(root) {
  const wrap = el('div', { class: 'search-layout' });
  root.appendChild(wrap);

  const filterPanel = el('aside', { class: 'filter-panel' });
  const main = el('div', { class: 'search-main' });
  wrap.appendChild(filterPanel);
  wrap.appendChild(main);

  const searchInput = el('input', { type: 'text', class: 'form-input', placeholder: 'Search transcripts, e.g. ingredients callout, David Beckham origin, morning routine' });
  const savedBtn = el('button', { class: 'btn btn-ghost btn-sm' }, 'Save this search');
  main.appendChild(el('div', { class: 'search-bar-row' }, searchInput, savedBtn));
  const savedRow = el('div', { class: 'saved-row' });
  main.appendChild(savedRow);
  const resultsEl = el('div', { class: 'results' });
  main.appendChild(resultsEl);

  const selectedSpeakers = new Set();
  const selectedCategories = new Set();
  const speakerGroup = el('div', { class: 'filter-group' }, el('h4', {}, 'Speakers'));
  const categoryGroup = el('div', { class: 'filter-group' }, el('h4', {}, 'Categories'));
  filterPanel.appendChild(speakerGroup);
  filterPanel.appendChild(categoryGroup);

  async function loadFilters() {
    speakerGroup.appendChild(el('div', { class: 'subtle filter-loading' }, 'Loading...'));
    categoryGroup.appendChild(el('div', { class: 'subtle filter-loading' }, 'Loading...'));
    let sp, cat;
    try {
      [sp, cat] = await Promise.all([api.get('/api/speakers?hideEmpty=0'), api.get('/api/categories')]);
    } catch (e) {
      speakerGroup.querySelector('.filter-loading').textContent = `Couldn't load (${e.message}). Retry.`;
      categoryGroup.querySelector('.filter-loading').textContent = `Couldn't load (${e.message}). Retry.`;
      const retryBtn = el('button', { class: 'btn btn-sm btn-ghost', onclick: () => { speakerGroup.innerHTML = '<h4>Speakers</h4>'; categoryGroup.innerHTML = '<h4>Categories</h4>'; loadFilters(); } }, 'Retry');
      speakerGroup.appendChild(retryBtn);
      return;
    }
    speakerGroup.querySelector('.filter-loading')?.remove();
    categoryGroup.querySelector('.filter-loading')?.remove();
    const speakers = (sp.speakers || []).slice(0, 50);
    const categories = (cat.categories || []).filter(c => c.status !== 'proposed');
    if (!speakers.length) speakerGroup.appendChild(el('div', { class: 'subtle' }, 'No speakers yet. Process some videos first.'));
    for (const s of speakers) {
      const cb = el('input', { type: 'checkbox' });
      cb.onchange = () => { cb.checked ? selectedSpeakers.add(s.id) : selectedSpeakers.delete(s.id); runSearch(); };
      speakerGroup.appendChild(el('label', { class: 'filter-row' }, cb, el('span', {}, `${s.name} (${s.video_count})`)));
    }
    if (!categories.length) categoryGroup.appendChild(el('div', { class: 'subtle' }, 'No categories yet.'));
    for (const c of categories) {
      const cb = el('input', { type: 'checkbox' });
      cb.onchange = () => { cb.checked ? selectedCategories.add(c.id) : selectedCategories.delete(c.id); runSearch(); };
      categoryGroup.appendChild(el('label', { class: 'filter-row' }, cb, el('span', {}, `${c.name} (${c.video_count})`)));
    }
  }

  async function loadSaved() {
    const r = await api.get('/api/saved-searches');
    savedRow.innerHTML = '';
    for (const s of r.saved) {
      const pill = el('button', { class: 'chip chip-saved' }, s.name);
      pill.onclick = () => {
        searchInput.value = s.query || '';
        try {
          const f = JSON.parse(s.filters_json || '{}');
          selectedSpeakers.clear(); (f.speakers || []).forEach(id => selectedSpeakers.add(id));
          selectedCategories.clear(); (f.categories || []).forEach(id => selectedCategories.add(id));
          speakerGroup.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = selectedSpeakers.has(cb.dataset.id));
          categoryGroup.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = selectedCategories.has(cb.dataset.id));
        } catch {}
        runSearch();
      };
      savedRow.appendChild(pill);
    }
  }

  savedBtn.onclick = async () => {
    const name = prompt('Name this search:');
    if (!name) return;
    await api.post('/api/saved-searches', {
      name,
      query: searchInput.value,
      filters: { speakers: Array.from(selectedSpeakers), categories: Array.from(selectedCategories) },
    });
    toast('Saved', 'success');
    loadSaved();
  };

  let debounceTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, 300);
  });

  async function runSearch() {
    resultsEl.innerHTML = 'Searching...';
    const params = new URLSearchParams();
    if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
    if (selectedSpeakers.size) params.set('speakers', Array.from(selectedSpeakers).join(','));
    if (selectedCategories.size) params.set('categories', Array.from(selectedCategories).join(','));
    params.set('limit', '30');
    try {
      const r = await api.get(`/api/search?${params}`);
      resultsEl.innerHTML = '';
      if (!r.results.length) {
        resultsEl.appendChild(el('p', { class: 'subtle' }, 'No matches.'));
        return;
      }
      for (const res of r.results) resultsEl.appendChild(renderCard(res));
    } catch (e) {
      resultsEl.innerHTML = '';
      toast(e.message, 'error');
    }
  }

  function renderCard(r) {
    const thumb = r.thumbnailPath ? el('img', { src: `/${r.thumbnailPath}` }) : el('div', { class: 'thumb-placeholder' });
    const meta = el('div', {},
      el('div', {}, el('strong', {}, r.videoTitle), ' - ', el('span', { class: 'chip chip-speaker' }, r.speakerName || 'Unknown'), ' - ', el('span', {}, formatTime(r.startSeconds))),
      el('div', { class: 'chips' }, ...(r.categories || []).map(c => el('span', { class: 'chip chip-category' }, c.name))),
      el('div', { class: 'seg-text' }, `"${r.text}"`),
      el('div', { class: 'result-actions' },
        el('button', { class: 'btn btn-sm btn-primary', onclick: () => openVideoModal(r) }, `Play at ${formatTime(r.startSeconds)}`),
        el('button', { class: 'btn btn-sm btn-ghost', onclick: () => { navigator.clipboard.writeText(formatTime(r.startSeconds)); toast('Timestamp copied', 'info'); } }, 'Copy timestamp'),
        el('a', { class: 'btn btn-sm btn-ghost', href: r.driveUrl, target: '_blank' }, 'Open in Drive'),
      )
    );
    return el('div', { class: 'result-card' }, thumb, meta);
  }

  function openVideoModal(r) {
    const box = el('div', {},
      el('h3', {}, r.videoTitle),
      el('div', { class: 'timestamp-banner' }, `Matched at ${formatTime(r.startSeconds)} - scrub to here`),
      el('iframe', { src: `https://drive.google.com/file/d/${r.driveFileId}/preview`, allow: 'autoplay', allowfullscreen: '' }),
      el('div', { class: 'seg-text', style: 'margin-top:1rem' }, `"${r.text}"`),
      el('a', { class: 'btn btn-sm btn-ghost', href: `#/video/${r.videoId}` }, 'Open full video detail')
    );
    openModal(box);
  }

  await loadFilters();
  await loadSaved();
  runSearch();
}
