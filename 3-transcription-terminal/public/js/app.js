import { searchView } from '/js/views/search.js';
import { libraryView } from '/js/views/library.js';
import { uploadView } from '/js/views/upload.js';
import { speakersView } from '/js/views/speakers.js';
import { categoriesView } from '/js/views/categories.js';
import { settingsView } from '/js/views/settings.js';
import { videoDetailView } from '/js/views/video-detail.js';

const views = {
  search: searchView,
  library: libraryView,
  upload: uploadView,
  speakers: speakersView,
  categories: categoriesView,
  settings: settingsView,
};

const main = document.getElementById('main-content');

async function navigate(name) {
  for (const a of document.querySelectorAll('#main-nav a[data-view]')) {
    a.classList.toggle('active', a.dataset.view === name);
  }
  const render = views[name];
  if (!render) {
    main.innerHTML = '<p style="padding:2rem">Unknown view.</p>';
    return;
  }
  main.innerHTML = '';
  await render(main);
}

document.querySelectorAll('#main-nav a[data-view]').forEach(a => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    location.hash = `#/${a.dataset.view}`;
  });
});

window.addEventListener('hashchange', handleHash);

async function handleHash() {
  const h = location.hash.replace(/^#\//, '');
  const [name, arg] = h.split('/');
  if (name === 'video' && arg) {
    main.innerHTML = '';
    await videoDetailView(main, arg);
    return;
  }
  await navigate(name || 'search');
}

handleHash();
