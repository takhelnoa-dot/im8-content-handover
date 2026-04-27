import { api } from '/js/lib/api.js';
import { el } from '/js/lib/ui.js';

export async function settingsView(root) {
  root.appendChild(el('h2', {}, 'Settings'));
  const s = await api.get('/api/settings');
  const statusRow = (name, ok) => el('div', {}, `${name}: `, el('span', { class: ok ? 'chip chip-ok' : 'chip chip-fail' }, ok ? 'connected' : 'not configured'));
  root.appendChild(el('div', { class: 'card' },
    el('h3', {}, 'API Status'),
    statusRow('OpenAI', s.apiStatus.openai),
    statusRow('AssemblyAI', s.apiStatus.assemblyai),
    statusRow('Anthropic (Claude)', s.apiStatus.anthropic),
    statusRow('Google Drive service account', s.apiStatus.drive),
    statusRow('Direct upload target folder', s.apiStatus.upload_folder)
  ));
  root.appendChild(el('div', { class: 'card' },
    el('h3', {}, 'Search Weights'),
    el('p', {}, `Lexical: ${s.searchWeightLexical} - Semantic: ${s.searchWeightSemantic}`),
    el('p', { class: 'subtle' }, 'Adjust via environment variables SEARCH_WEIGHT_LEXICAL and SEARCH_WEIGHT_SEMANTIC, then restart the server.')
  ));
}
