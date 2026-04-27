import { api } from '/js/lib/api.js';
import { toast, el } from '/js/lib/ui.js';

export async function uploadView(root) {
  const container = el('div', { class: 'upload-view' });
  root.appendChild(container);

  container.appendChild(el('h2', {}, 'Upload'));

  const linkCard = el('div', { class: 'card' },
    el('h3', {}, 'Paste a Google Drive link'),
    el('p', { class: 'subtle' }, 'File or folder URL. For folders, you can pick which videos to ingest.'),
  );
  const urlInput = el('input', { type: 'text', class: 'form-input', placeholder: 'https://drive.google.com/...' });
  const inspectBtn = el('button', { class: 'btn btn-primary' }, 'Inspect');
  linkCard.appendChild(urlInput);
  linkCard.appendChild(inspectBtn);
  const inspectResult = el('div', { class: 'inspect-result' });
  linkCard.appendChild(inspectResult);
  container.appendChild(linkCard);

  inspectBtn.onclick = async () => {
    const url = urlInput.value.trim();
    if (!url) return;
    inspectResult.innerHTML = 'Inspecting...';
    try {
      const r = await api.post('/api/upload/inspect', { url });
      inspectResult.innerHTML = '';
      if (r.type === 'file') {
        inspectResult.appendChild(el('p', {}, `Found file: ${r.file.name}`));
        const ingestBtn = el('button', { class: 'btn btn-primary' }, 'Ingest this video');
        ingestBtn.onclick = async () => {
          await api.post('/api/upload/ingest', { fileIds: [r.file.id] });
          toast('Queued', 'success');
          urlInput.value = '';
          inspectResult.innerHTML = '';
          renderQueue();
        };
        inspectResult.appendChild(ingestBtn);
      } else if (r.type === 'folder') {
        inspectResult.appendChild(el('p', {}, `Folder contains ${r.files.length} video file(s). Select which to ingest:`));
        const list = el('div', { class: 'folder-list' });
        const checks = [];
        for (const f of r.files) {
          const cb = el('input', { type: 'checkbox', checked: 'checked' });
          checks.push({ cb, id: f.id });
          list.appendChild(el('label', { class: 'folder-row' }, cb, el('span', {}, f.name)));
        }
        inspectResult.appendChild(list);
        const ingestBtn = el('button', { class: 'btn btn-primary' }, 'Ingest selected');
        ingestBtn.onclick = async () => {
          const ids = checks.filter(c => c.cb.checked).map(c => c.id);
          if (!ids.length) return toast('Nothing selected', 'warn');
          await api.post('/api/upload/ingest', { fileIds: ids });
          toast(`Queued ${ids.length} video(s)`, 'success');
          urlInput.value = '';
          inspectResult.innerHTML = '';
          renderQueue();
        };
        inspectResult.appendChild(ingestBtn);
      }
    } catch (e) {
      inspectResult.innerHTML = '';
      toast(e.message, 'error');
    }
  };

  const dropCard = el('div', { class: 'card' }, el('h3', {}, 'Or drag a video file'));
  const dropZone = el('div', { class: 'upload-zone', id: 'drop-zone' },
    el('p', {}, 'Drop MP4 here. Will be uploaded to Drive, then ingested.')
  );
  dropCard.appendChild(dropZone);
  const fileInput = el('input', { type: 'file', accept: 'video/*', style: 'display:none' });
  dropCard.appendChild(fileInput);
  dropZone.onclick = () => fileInput.click();
  ['dragenter', 'dragover'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.remove('dragging'); }));
  dropZone.addEventListener('drop', e => {
    if (e.dataTransfer?.files?.[0]) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.onchange = () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); };
  async function handleFile(file) {
    const fd = new FormData();
    fd.append('video', file);
    toast(`Uploading ${file.name}...`, 'info');
    try {
      await api.postForm('/api/upload/file', fd);
      toast(`Queued ${file.name}`, 'success');
      renderQueue();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  container.appendChild(dropCard);

  const queueSection = el('div', { class: 'card' },
    el('h3', {}, 'Queue'),
    el('div', { id: 'queue-body' })
  );
  container.appendChild(queueSection);

  async function renderQueue() {
    try {
      const r = await api.get('/api/upload/queue');
      const body = queueSection.querySelector('#queue-body');
      body.innerHTML = '';
      if (!r.queue.length) {
        body.appendChild(el('p', { class: 'subtle' }, 'No pending videos.'));
        return;
      }
      for (const v of r.queue) {
        const row = el('div', { class: 'queue-row' },
          el('div', {},
            el('a', { href: `#/video/${v.id}` }, v.title || v.id),
            el('div', { class: 'subtle' }, v.status + (v.error_message ? ` - ${v.error_message}` : ''))
          ),
          v.status === 'failed'
            ? el('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { await api.post(`/api/upload/retry/${v.id}`); renderQueue(); } }, 'Retry')
            : el('span', {})
        );
        body.appendChild(row);
      }
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  renderQueue();

  const poll = setInterval(() => {
    if (!root.isConnected) return clearInterval(poll);
    renderQueue();
  }, 4000);
}
