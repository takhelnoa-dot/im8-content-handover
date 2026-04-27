import { api } from '/js/lib/api.js';
import { toast, el, formatTime } from '/js/lib/ui.js';

export async function videoDetailView(root, videoId) {
  root.innerHTML = 'Loading...';
  try {
    const [{ video, segments, speakers, categories }, allSpeakersResp] = await Promise.all([
      api.get(`/api/videos/${videoId}`),
      api.get('/api/speakers?hideEmpty=0'),
    ]);
    const allSpeakers = (allSpeakersResp.speakers || []).filter(s => !s.is_unknown);
    root.innerHTML = '';

    const layout = el('div', { class: 'video-detail' });
    root.appendChild(layout);

    const left = el('div', {});
    const banner = el('div', { class: 'timestamp-banner' }, 'Click a segment below to preview its timestamp');
    const iframe = el('iframe', { src: video.preview_url, allow: 'autoplay', allowfullscreen: '' });
    left.appendChild(banner);
    left.appendChild(iframe);

    // Bulk select bar
    const bulkBar = el('div', { class: 'seg-bulk-bar', style: 'display:none' });
    const bulkLabel = el('span', { class: 'subtle' });
    const bulkBtn = el('button', { class: 'btn btn-sm btn-primary' }, 'Reassign selected speaker');
    bulkBar.appendChild(bulkLabel);
    bulkBar.appendChild(bulkBtn);
    left.appendChild(bulkBar);

    const segList = el('div', { class: 'seg-list' });
    const selectedSegs = new Set();

    function refreshBulkBar() {
      bulkBar.style.display = selectedSegs.size ? '' : 'none';
      bulkLabel.textContent = `${selectedSegs.size} segment(s) selected. `;
    }

    bulkBtn.onclick = async () => {
      if (!selectedSegs.size) return;
      const newName = await pickSpeakerName(allSpeakers);
      if (!newName) return;
      const speakerId = await ensureSpeaker(newName, allSpeakers);
      let n = 0;
      for (const segId of selectedSegs) {
        try { await api.patch(`/api/videos/${video.id}/segments/${segId}`, { speakerId }); n++; } catch {}
      }
      toast(`Reassigned ${n} segment(s) to ${newName}`, 'success');
      // Reload page to reflect changes
      videoDetailView(root, videoId);
    };

    for (const s of segments) {
      const cb = el('input', { type: 'checkbox', class: 'seg-cb' });
      cb.onclick = (e) => {
        e.stopPropagation();
        cb.checked ? selectedSegs.add(s.id) : selectedSegs.delete(s.id);
        refreshBulkBar();
      };
      const speakerSpan = el('span', { class: 'seg-speaker editable', title: 'Click to reassign' }, s.speaker_name || 'Unknown');
      speakerSpan.onclick = async (e) => {
        e.stopPropagation();
        const newName = await pickSpeakerName(allSpeakers, s.speaker_name);
        if (!newName || newName === s.speaker_name) return;
        const speakerId = await ensureSpeaker(newName, allSpeakers);
        await api.patch(`/api/videos/${video.id}/segments/${s.id}`, { speakerId });
        toast(`Reassigned to ${newName}`, 'success');
        speakerSpan.textContent = newName;
      };
      const row = el('div', { class: 'seg-row' },
        cb,
        el('span', { class: 'seg-time' }, formatTime(s.start_seconds)),
        speakerSpan,
        el('span', { class: 'seg-text' }, s.text)
      );
      row.onclick = () => {
        banner.textContent = `Scrub to ${formatTime(s.start_seconds)} - "${s.text.slice(0, 80)}..."`;
      };
      segList.appendChild(row);
    }
    left.appendChild(segList);
    layout.appendChild(left);

    const right = el('div', {},
      el('h3', {}, video.title),
      el('p', {},
        el('a', { href: video.drive_url, target: '_blank' }, 'Open in Drive')
      ),
      (() => {
        const block = el('div', {});
        block.appendChild(el('h4', {}, 'Speakers'));
        function renderSpeakerChips(list) {
          for (const old of block.querySelectorAll('.spk-row, .spk-add')) old.remove();
          for (const s of list) {
            const removeBtn = el('button', { class: 'chip-remove', title: 'Remove from this video' }, '×');
            removeBtn.onclick = async (e) => {
              e.stopPropagation();
              if (!confirm(`Remove ${s.name} from this video's speaker list? Segment assignments are kept.`)) return;
              await api.del(`/api/videos/${video.id}/speakers/${s.id}`);
              const idx = list.findIndex(x => x.id === s.id);
              if (idx >= 0) list.splice(idx, 1);
              renderSpeakerChips(list);
              toast('Removed', 'success');
            };
            block.appendChild(el('div', { class: 'spk-row' },
              el('span', { class: 'chip chip-speaker' }, s.name, ' ', removeBtn),
              ' ',
              el('span', { class: 'subtle' }, `${s.segment_count} segments`)
            ));
          }
          const addBtn = el('button', { class: 'btn btn-sm btn-ghost spk-add' }, '+ Add speaker');
          addBtn.onclick = async () => {
            const name = await pickSpeakerName(allSpeakers);
            if (!name) return;
            const sid = await ensureSpeaker(name, allSpeakers);
            await api.post(`/api/videos/${video.id}/speakers`, { speakerId: sid });
            list.push({ id: sid, name, segment_count: 0 });
            renderSpeakerChips(list);
            toast(`Added ${name}`, 'success');
          };
          block.appendChild(addBtn);
        }
        renderSpeakerChips(speakers.slice());
        return block;
      })(),
      el('div', {},
        el('h4', {}, 'Categories'),
        ...categories.map(c => el('span', { class: 'chip chip-category' }, c.name))
      ),
      el('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { await api.post(`/api/videos/${video.id}/retag`); toast('Re-tagging queued', 'info'); } }, 'Re-run auto-tag'),
      el('button', { class: 'btn btn-sm btn-danger', onclick: async () => {
        if (!confirm('Delete this video from the library? Drive file is untouched.')) return;
        await api.del(`/api/videos/${video.id}`);
        toast('Deleted', 'success');
        location.hash = '#/library';
      } }, 'Delete from library')
    );
    layout.appendChild(right);
  } catch (e) {
    root.innerHTML = `<p>Error: ${e.message}</p>`;
  }
}

// Prompts the user for a speaker name. Shows existing names as a hint;
// a new typed name will be created on submit.
async function pickSpeakerName(allSpeakers, current = '') {
  const list = allSpeakers.map(s => s.name).join(', ');
  const input = prompt(
    `Speaker name?\n\nExisting: ${list || '(none)'}\nType an existing name to reuse, or a new name to create one.`,
    current || ''
  );
  return input ? input.trim() : null;
}

async function ensureSpeaker(name, allSpeakers) {
  const existing = allSpeakers.find(s => s.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const r = await api.post('/api/speakers', { name });
  allSpeakers.push({ id: r.speaker.id, name });
  return r.speaker.id;
}
