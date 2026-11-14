(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.SpeechContinuationDemo = api;
    document.addEventListener('DOMContentLoaded', () => api.mount().catch(api.fatal));
  }
})(globalThis, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const clone = value => JSON.parse(JSON.stringify(value));
  const timestamp = () => new Date().toISOString();
  const storageKey = data => `speech_continuation_public_demo_v1_${data.study_id}_${data.build_id}`;
  const itemKey = (assignment, practice) => `${practice ? 'practice' : 'study'}:${assignment.cell_id}`;

  function shuffle(items, random = Math.random) {
    const output = [...items];
    for (let i = output.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [output[i], output[j]] = [output[j], output[i]];
    }
    return output;
  }

  function catalog(data) {
    if (!['question', 'turn'].includes(data.study_id) || typeof data.build_id !== 'string' ||
        !Number.isInteger(data.trials_per_session) || data.trials_per_session < 1 ||
        !Array.isArray(data.cells) || !Array.isArray(data.practice) || !Array.isArray(data.lists) || !data.lists.length) {
      throw Error('The demo materials are incomplete. Please try opening this page again later.');
    }
    const cells = new Map();
    for (const cell of [...data.cells, ...data.practice]) {
      if (!cell.cell_id || cells.has(cell.cell_id) || cell.phrase_id === undefined ||
          !['audio', 'text'].includes(cell.modality) || typeof cell.question !== 'string' ||
          !Array.isArray(cell.options) || cell.options.length !== 2 ||
          new Set(cell.options.map(option => option.id)).size !== 2 ||
          cell.options.some(option => typeof option.id !== 'string' || typeof option.text !== 'string')) {
        throw Error('A demo item is incomplete or repeated.');
      }
      if (cell.modality === 'audio') {
        let url;
        try { url = new URL(cell.audio_url); } catch (_) { throw Error('A demo recording has an invalid address.'); }
        if (url.protocol !== 'https:') throw Error('A demo recording needs a secure web address.');
      } else if (typeof cell.text !== 'string') throw Error('A text item is missing.');
      cells.set(cell.cell_id, cell);
    }
    const listIds = new Set();
    for (const list of data.lists) {
      if (list.id === undefined || listIds.has(String(list.id))) throw Error('An assignment list is missing or repeated.');
      listIds.add(String(list.id));
      verifyAssignments(list.assignments, data, cells);
    }
    return cells;
  }

  function optionOrder(cell, supplied) {
    const order = supplied || cell.options.map(option => option.id);
    if (!Array.isArray(order) || order.length !== cell.options.length || new Set(order).size !== order.length ||
        order.some(id => !cell.options.some(option => option.id === id))) throw Error('An item’s answer options could not be read.');
    return [...order];
  }

  function verifyAssignments(assignments, data, cells) {
    if (!Array.isArray(assignments) || assignments.length !== data.trials_per_session) throw Error('An assignment list has the wrong number of items.');
    const allowed = new Set(data.cells.map(cell => cell.cell_id));
    const phrases = new Set();
    return assignments.map(assignment => {
      const cell = cells.get(assignment.cell_id);
      if (!allowed.has(assignment.cell_id) || phrases.has(String(cell?.phrase_id))) throw Error('An assignment list repeats or omits a phrase.');
      phrases.add(String(cell.phrase_id));
      optionOrder(cell, assignment.option_order);
      return clone(assignment);
    });
  }

  function createSession(data, random = Math.random, startedAt = timestamp(), sessionId) {
    const cells = catalog(data);
    const selected = data.lists[Math.floor(random() * data.lists.length)];
    function prepare(assignment) {
      const cell = cells.get(assignment.cell_id);
      const options = optionOrder(cell, assignment.option_order);
      return {cell_id: cell.cell_id, option_order: assignment.option_order ? options : data.study_id === 'turn' ? shuffle(options, random) : options};
    }
    return {
      schema_version: SCHEMA_VERSION,
      study_id: data.study_id,
      build_id: data.build_id,
      session_id: sessionId || globalThis.crypto?.randomUUID?.() || `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      assignment_list: selected.id,
      started_at: startedAt,
      updated_at: startedAt,
      completed_at: null,
      preparation: {headphones_recommended: true, audio_setup_completed: false},
      assignments: shuffle(selected.assignments.map(prepare), random),
      practice_assignments: data.practice.map(cell => prepare({cell_id: cell.cell_id, option_order: cell.option_order})),
      responses: [],
      draft: null
    };
  }

  function sequence(state) {
    return [
      ...state.practice_assignments.map((assignment, index) => ({assignment, practice: true, position: index + 1})),
      ...state.assignments.map((assignment, index) => ({assignment, practice: false, position: index + 1}))
    ];
  }

  function validateState(state, data, cells = catalog(data)) {
    if (!state || state.schema_version !== SCHEMA_VERSION || state.study_id !== data.study_id || state.build_id !== data.build_id ||
        typeof state.session_id !== 'string' || !Array.isArray(state.responses) || !state.preparation) {
      throw Error('The saved demo does not match these materials. Download the saved data before starting again.');
    }
    const savedList = data.lists.find(list => String(list.id) === String(state.assignment_list));
    if (!savedList) throw Error('The saved assignment list could not be found.');
    verifyAssignments(state.assignments, data, cells);
    const expectedIds = savedList.assignments.map(item => item.cell_id).sort();
    if (JSON.stringify(expectedIds) !== JSON.stringify(state.assignments.map(item => item.cell_id).sort())) throw Error('The saved demo contains a different assignment list.');
    if (!Array.isArray(state.practice_assignments) ||
        JSON.stringify(state.practice_assignments.map(item => item.cell_id)) !== JSON.stringify(data.practice.map(cell => cell.cell_id))) {
      throw Error('The saved practice items do not match these materials.');
    }
    for (const assignment of [...state.practice_assignments, ...state.assignments]) optionOrder(cells.get(assignment.cell_id), assignment.option_order);
    const items = sequence(state);
    if (state.responses.length > items.length) throw Error('The saved demo contains unexpected responses.');
    state.responses.forEach((response, index) => {
      const item = items[index], cell = cells.get(item.assignment.cell_id);
      if (response.key !== itemKey(item.assignment, item.practice) ||
          response.cell_id !== cell.cell_id || response.is_practice !== item.practice ||
          (!response.technical_problem && !cell.options.some(option => option.id === response.choice))) {
        throw Error('A saved response does not match its assigned item.');
      }
    });
    if (state.draft) {
      const item = items[state.responses.length];
      if (!item || state.draft.key !== itemKey(item.assignment, item.practice)) throw Error('The saved unfinished response belongs to another item.');
    }
    if (state.completed_at && state.responses.length !== items.length) throw Error('The saved demo is marked complete but has unanswered items.');
    return state;
  }

  function ready(cell, draft) { return cell.modality === 'text' || draft.first_play_completed === true; }
  function canAdvance(cell, draft) {
    return Boolean(draft.technical_problem) || (ready(cell, draft) && cell.options.some(option => option.id === draft.choice));
  }
  function makeResponse(cell, draft, item, answeredAt = timestamp()) {
    if (!canAdvance(cell, draft)) throw Error('Listen to the complete recording and choose an answer, or report a technical problem.');
    return {
      key: itemKey(item.assignment, item.practice), cell_id: cell.cell_id, is_practice: item.practice,
      choice: draft.technical_problem ? null : draft.choice,
      technical_problem: draft.technical_problem || null,
      technical_note: (draft.technical_note || '').slice(0, 500),
      option_order: [...item.assignment.option_order], started_at: draft.started_at, responded_at: answeredAt,
      response_time_ms: Math.max(0, Math.round(Number(draft.elapsed_ms) || 0)),
      first_play_completed: cell.modality === 'audio' && draft.first_play_completed === true,
      play_count: draft.play_count || 0, playback_start_count: draft.playback_start_count || 0,
      complete_listen_count: draft.complete_listen_count || 0,
      playback_errors: clone(draft.playback_errors || [])
    };
  }

  function exportResults(state, data, cells = catalog(data), generatedAt = timestamp()) {
    const responses = new Map(state.responses.map(response => [response.key, response]));
    const rows = sequence(state).map((item, index) => {
      const key = itemKey(item.assignment, item.practice), cell = cells.get(item.assignment.cell_id);
      const answered = responses.get(key), draft = state.draft?.key === key ? state.draft : null;
      const value = answered || draft || {};
      const choice = value.technical_problem ? null : value.choice || null;
      return {
        demo_session: state.session_id, study: state.study_id, build_id: state.build_id,
        assignment_list: state.assignment_list, session_order: index + 1, is_practice: item.practice,
        item_number: item.position, paper_phrase_id: cell.paper_phrase_id ?? '', phrase_id: cell.phrase_id,
        cell_id: cell.cell_id, condition: cell.condition ?? cell.version ?? '', version: cell.version ?? '',
        gate: cell.gate ?? '', modality: cell.modality,
        question: cell.question, presented_text: cell.modality === 'text' ? cell.text : '',
        audio_url: cell.modality === 'audio' ? cell.audio_url : '',
        option_order: [...item.assignment.option_order],
        response_status: answered ? answered.technical_problem ? 'technical_problem' : 'answered' : draft ? 'in_progress' : 'unanswered',
        answer_id: choice, answer: cell.options.find(option => option.id === choice)?.text ?? '',
        technical_problem: value.technical_problem || '', technical_note: value.technical_note || '',
        listen_completed: value.first_play_completed === true,
        play_count: value.play_count || 0, playback_start_count: value.playback_start_count || 0,
        complete_listen_count: value.complete_listen_count || 0,
        response_time_ms: answered ? answered.response_time_ms : draft ? Math.round(draft.elapsed_ms || 0) : null,
        started_at: value.started_at || null, responded_at: answered?.responded_at || null
      };
    });
    return {
      schema_version: SCHEMA_VERSION, export_type: 'personal_public_demo', generated_at: generatedAt,
      study_id: state.study_id, title: data.title, build_id: data.build_id, demo_session: state.session_id,
      assignment_list: state.assignment_list, started_at: state.started_at, completed_at: state.completed_at,
      completed: Boolean(state.completed_at), main_items: state.assignments.length,
      practice_items: state.practice_assignments.length,
      submitted_main_items: state.responses.filter(response => !response.is_practice).length,
      submitted_practice_items: state.responses.filter(response => response.is_practice).length,
      response_time_definition: 'Time spent with each item open in this browser, excluding time while the page is closed. It includes listening and replay time.',
      preparation: clone(state.preparation), responses: rows
    };
  }

  function csvCell(value) {
    let text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }
  function toCSV(output) {
    if (!output.responses.length) return '';
    const headers = Object.keys(output.responses[0]);
    return '\uFEFF' + [headers.map(csvCell).join(','), ...output.responses.map(row => headers.map(header => csvCell(row[header])).join(','))].join('\r\n') + '\r\n';
  }

  function element(tag, text, attrs = {}) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node;
  }
  function button(text, action, className = '') {
    const node = element('button', text, {type: 'button', class: className});
    node.addEventListener('click', action);
    return node;
  }
  function download(text, type, filename) {
    const url = URL.createObjectURL(new Blob([text], {type}));
    const link = element('a', undefined, {href: url, download: filename});
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function fatal(error) {
    const app = document.querySelector('#demo');
    app.replaceChildren(element('h1', 'The demo could not open'), element('p', error.message || 'Please reload this page.', {class: 'error', role: 'alert'}), element('a', 'Return to study materials', {href: '../../'}));
  }

  async function mount() {
    const app = document.querySelector('#demo');
    if (!app) return;
    const fetched = await fetch('./data.json', {cache: 'no-cache'});
    if (!fetched.ok) throw Error('The demo materials could not be downloaded. Please try again later.');
    const data = await fetched.json(), cells = catalog(data), key = storageKey(data);
    let state = null, raw = null, storageAvailable = true, media = null, playback = null, saveTimer = null;
    let viewStarted = null, previousElapsed = 0, storageMessage = '', audioControls = () => {}, closed = false;
    let unlock = () => {};
    if (navigator.locks?.request) {
      unlock = await new Promise((resolve, reject) => {
        let release;
        const held = new Promise(done => { release = done; });
        navigator.locks.request(key, {mode: 'exclusive', ifAvailable: true}, lock => {
          if (!lock) { reject(Error('This demo is already open in another tab. Close that tab, then reload here to resume your responses.')); return; }
          resolve(release); return held;
        }).catch(reject);
      });
    }
    try { raw = localStorage.getItem(key); } catch (_) { storageAvailable = false; }
    if (raw) {
      try { state = validateState(JSON.parse(raw), data, cells); }
      catch (error) {
        app.replaceChildren(element('h1', 'Saved progress needs attention'), element('p', error.message, {class: 'error', role: 'alert'}));
        app.append(button('Download saved data', () => download(raw, 'application/json', `${data.study_id}-saved-demo.json`)));
        app.append(button('Discard saved demo and start again', () => {
          if (!confirm('Discard the saved responses for this demo? Download them first if you want to keep them.')) return;
          localStorage.removeItem(key); location.reload();
        }));
        unlock(); return;
      }
    }
    if (state?.draft) {
      // A resumed audio item must be heard again. Completed earlier responses are kept.
      state.draft.first_play_completed = false;
      state.draft.audio_started = false;
      state.draft.audio_ended = false;
    }

    function elapsed() {
      if (state?.draft && viewStarted !== null) state.draft.elapsed_ms = previousElapsed + Math.max(0, performance.now() - viewStarted);
    }
    function showStorageWarning() {
      const node = app.querySelector('.storage-warning');
      if (node) node.textContent = storageMessage;
    }
    function save() {
      if (!state || closed) return;
      elapsed(); state.updated_at = timestamp();
      try { localStorage.setItem(key, JSON.stringify(state)); storageAvailable = true; storageMessage = ''; }
      catch (_) {
        storageAvailable = false;
        storageMessage = 'This browser could not save progress. Keep this page open and download your responses before leaving.';
      }
      showStorageWarning();
    }
    function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 200); }
    function closeMedia() {
      elapsed(); viewStarted = null;
      clearTimeout(saveTimer);
      if (playback) { playback.destroy(); playback = null; }
      if (media) { media.pause(); media.removeAttribute('src'); media.load(); media = null; }
      audioControls = () => {};
    }
    function clear() {
      closeMedia(); app.replaceChildren();
      const warning = element('p', storageMessage, {class: 'storage-warning', role: 'alert'});
      app.append(warning);
    }
    function focusHeading() {
      const heading = app.querySelector('h1');
      if (heading) { heading.tabIndex = -1; heading.focus({preventScroll: true}); }
      app.scrollIntoView({block: 'start', behavior: 'instant'});
    }
    function privacy() { app.append(element('p', 'Your responses stay in this browser. You can download them when finished.', {class: 'privacy-note'})); }
    function announce(message) {
      let node = app.querySelector('.error');
      if (!node) { node = element('p', '', {class: 'error', role: 'alert'}); app.prepend(node); }
      node.textContent = message;
    }
    function downloads() {
      if (!state) return;
      const section = element('section', undefined, {class: 'download-area', 'aria-label': 'Download your responses'});
      section.append(element('h2', 'Your responses'));
      const actions = element('div', undefined, {class: 'actions'});
      const exportCurrent = type => {
        save();
        const output = exportResults(state, data, cells);
        const stem = `${data.study_id}-demo-list-${state.assignment_list}-${state.session_id.slice(0, 8)}`;
        download(type === 'csv' ? toCSV(output) : JSON.stringify(output, null, 2), type === 'csv' ? 'text/csv;charset=utf-8' : 'application/json', `${stem}.${type}`);
      };
      actions.append(button('Download CSV', () => exportCurrent('csv')), button('Download JSON', () => exportCurrent('json')));
      section.append(actions, element('p', 'Downloads contain only this demo session, including practice and any unanswered items. You can download partial results at any time.', {class: 'download-note'}));
      const restart = button('Try another random list', () => {
        restart.disabled = true;
        const box = element('div', undefined, {class: 'restart-box'});
        box.append(element('p', 'Download your current responses first if you want to keep them. Starting again replaces this demo session in this browser.'));
        const choices = element('div', undefined, {class: 'actions'});
        choices.append(button('Start another demo', start, 'primary'), button('Keep current results', () => { box.remove(); restart.disabled = false; restart.focus(); }));
        box.append(choices); section.append(box); choices.firstChild.focus();
      });
      const restartActions = element('div', undefined, {class: 'actions'}); restartActions.append(restart); section.append(restartActions);
      app.append(section);
    }
    function start() {
      const choices = state && data.lists.length > 1 ? {...data, lists: data.lists.filter(list => String(list.id) !== String(state.assignment_list))} : data;
      state = createSession(choices); save(); render();
    }
    function intro() {
      clear();
      app.append(element('p', 'Public demo', {class: 'eyebrow'}), element('h1', data.title || 'Listening-study demo'));
      (Array.isArray(data.instructions) ? data.instructions : []).forEach(line => app.append(element('p', line)));
      app.append(element('p', `The demo includes ${data.practice.length} practice ${data.practice.length === 1 ? 'item' : 'items'}, followed by ${data.trials_per_session} study items. One complete assignment list is selected at random, and its items are shown in a random order.`));
      app.append(element('p', 'Please use headphones in a quiet place and set a comfortable volume. You can replay recordings. There is no score.'));
      app.append(element('p', 'If you close or reload the page, this browser can resume your current list. Starting another demo replaces the current session after you confirm.', {class: 'muted'}));
      const actions = element('div', undefined, {class: 'actions'}); actions.append(button('Start demo', start, 'primary')); app.append(actions);
      privacy(); focusHeading();
    }
    function setup() {
      clear();
      app.append(element('p', 'Audio setup', {class: 'eyebrow'}), element('h1', 'Check your sound'));
      const sample = data.practice.find(cell => cell.modality === 'audio');
      if (!sample) {
        state.preparation.audio_setup_completed = true;
        state.preparation.audio_setup_status = 'no_audio_practice_available';
        save(); render(); return;
      }
      app.append(element('p', 'Play this practice recording and adjust your volume to a comfortable level. This sound check is separate from your practice answers.'));
      media = element('audio', undefined, {controls: '', preload: 'none', 'aria-label': 'Sound check recording'});
      media.src = sample.audio_url; app.append(media);
      const check = (label, checked = false) => {
        const node = element('label', undefined, {class: 'check'}), input = element('input', undefined, {type: 'checkbox'});
        input.checked = checked; node.append(input, document.createTextNode(label)); app.append(node); return input;
      };
      let heardComplete = false;
      const comfortable = check('I can hear the recording at a comfortable volume.');
      const problem = check('The recording will not play or I cannot hear it. Continue with a technical problem noted.');
      const status = element('p', 'Play the recording to the end, then confirm the volume.', {class: 'muted', role: 'status'}); app.append(status);
      const next = button('Continue to practice', () => {
        if (!(problem.checked || (heardComplete && comfortable.checked))) return;
        state.preparation = {...state.preparation, audio_setup_completed: true, audio_setup_cell_id: sample.cell_id,
          audio_setup_status: problem.checked ? 'technical_problem' : 'comfortable_volume_confirmed', audio_setup_completed_at: timestamp()};
        save(); render();
      }, 'primary');
      function update() { next.disabled = !(problem.checked || (heardComplete && comfortable.checked)); }
      media.addEventListener('ended', () => { heardComplete = true; status.textContent = 'Confirm that the volume is comfortable, then continue.'; update(); });
      media.addEventListener('error', () => { status.textContent = 'The recording could not load. You can retry, or select the technical-problem option to continue.'; });
      comfortable.addEventListener('change', update); problem.addEventListener('change', update); update();
      const actions = element('div', undefined, {class: 'actions'}); actions.append(next); app.append(actions); downloads(); privacy(); focusHeading();
    }
    function trial(item) {
      clear();
      const cell = cells.get(item.assignment.cell_id), total = item.practice ? state.practice_assignments.length : state.assignments.length;
      if (!state.draft) state.draft = {key: itemKey(item.assignment, item.practice), cell_id: cell.cell_id, started_at: timestamp(), elapsed_ms: 0, choice: null, technical_problem: null, technical_note: '', first_play_completed: false};
      const draft = state.draft;
      previousElapsed = Number(draft.elapsed_ms) || 0; viewStarted = performance.now();
      app.append(element('p', item.practice ? 'Practice' : 'Study items', {class: 'eyebrow'}), element('h1', `${item.practice ? 'Practice' : 'Item'} ${item.position} of ${total}`));
      app.append(element('p', item.practice ? 'Use this item to get familiar with the task. No score is shown.' : `Assignment list ${state.assignment_list}`, {class: 'progress-label'}));
      const progress = element('progress', undefined, {class: 'study-progress', max: total, value: item.position - 1, 'aria-label': item.practice ? 'Practice progress' : 'Study progress'}); app.append(progress);
      const audioStatus = element('p', '', {class: 'readiness', role: 'status', 'aria-live': 'polite'});
      const stimulus = element('div', undefined, {class: 'demo-card'});
      let playButton, pauseButton, replayButton, timeLabel, audioProgress;
      if (cell.modality === 'audio') {
        media = element('audio', undefined, {preload: 'none'}); media.src = cell.audio_url;
        const controls = element('div', undefined, {class: 'playback-controls'});
        playButton = button('Play recording', () => playback?.play(), 'primary');
        pauseButton = button('Pause', () => playback?.pause());
        replayButton = button('Replay from start', () => playback?.replay());
        controls.append(playButton, pauseButton, replayButton);
        audioProgress = element('progress', undefined, {class: 'audio-progress', max: 1, value: 0, 'aria-label': 'Recording progress'});
        const caption = element('div', undefined, {class: 'playback-caption'});
        timeLabel = element('p', '0:00', {'aria-hidden': 'true'}); caption.append(audioStatus, timeLabel);
        stimulus.append(media, controls, audioProgress, caption);
      } else {
        stimulus.append(element('p', 'Read the extract:', {class: 'muted'}), element('p', cell.text, {class: 'text-stimulus'}));
      }
      app.append(stimulus);
      const fieldset = element('fieldset', undefined, {class: 'answer-options'}); fieldset.append(element('legend', cell.question));
      const radios = [];
      for (const id of item.assignment.option_order) {
        const option = cell.options.find(candidate => candidate.id === id);
        const label = element('label', undefined, {class: 'answer-choice'});
        const input = element('input', undefined, {type: 'radio', name: 'answer', value: id}); input.checked = draft.choice === id;
        input.addEventListener('change', () => { draft.choice = id; save(); audioControls(); });
        label.append(input, element('span', option.text)); fieldset.append(label); radios.push(input);
      }
      app.append(fieldset);
      const technical = element('div', undefined, {class: 'technical-box'});
      const problemLabel = element('label', undefined, {class: 'check'}), problem = element('input', undefined, {type: 'checkbox'});
      problem.checked = Boolean(draft.technical_problem);
      problemLabel.append(problem, document.createTextNode('I had a technical problem with this item.'));
      const technicalFields = element('div', undefined, {class: 'technical-fields'});
      const reasonLabel = element('label', 'What happened?', {for: 'technical-reason'}), reason = element('select', undefined, {id: 'technical-reason'});
      const reasons = cell.modality === 'audio' ? [['audio_did_not_play', 'The recording did not play'], ['audio_not_audible', 'I could not hear the recording'], ['other', 'Another technical problem']] : [['text_not_displayed', 'The text did not display properly'], ['other', 'Another technical problem']];
      reasons.forEach(([id, label]) => reason.append(element('option', label, {value: id})));
      if (draft.technical_problem) reason.value = draft.technical_problem;
      const noteLabel = element('label', 'Optional note', {for: 'technical-note'}), note = element('textarea', undefined, {id: 'technical-note', maxlength: 500, rows: 2}); note.value = draft.technical_note || '';
      technicalFields.append(reasonLabel, reason, noteLabel, note); technical.append(problemLabel, technicalFields); app.append(technical);
      const isLast = !item.practice && item.position === total;
      const next = button(isLast ? 'Finish demo' : item.practice && item.position === total ? 'Continue to study items' : 'Next item', () => {
        if (!canAdvance(cell, draft)) { announce('Listen to the complete recording and choose an answer, or report a technical problem.'); return; }
        elapsed();
        state.responses.push(makeResponse(cell, draft, item));
        state.draft = null; viewStarted = null;
        if (state.responses.length === sequence(state).length) state.completed_at = timestamp();
        save(); render();
      }, 'primary');
      const actions = element('div', undefined, {class: 'actions'}); actions.append(next); app.append(actions);
      function technicalChange() {
        draft.technical_problem = problem.checked ? reason.value : null;
        draft.technical_note = note.value; save(); audioControls();
      }
      problem.addEventListener('change', technicalChange); reason.addEventListener('change', technicalChange); note.addEventListener('input', technicalChange);
      function formattedTime(value) { const seconds = Math.max(0, Math.floor(Number(value) || 0)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
      audioControls = () => {
        const canAnswer = ready(cell, draft) && !draft.technical_problem;
        radios.forEach(input => { input.disabled = !canAnswer; });
        technicalFields.hidden = !problem.checked;
        next.disabled = !canAdvance(cell, draft);
        if (cell.modality === 'audio' && media) {
          pauseButton.disabled = media.paused || media.ended;
          playButton.disabled = !media.paused && !media.ended;
          playButton.textContent = media.ended ? 'Play again' : media.currentTime > 0 ? 'Resume recording' : 'Play recording';
          replayButton.disabled = !draft.audio_started;
          const duration = Number.isFinite(media.duration) ? media.duration : 0;
          audioProgress.max = duration || 1; audioProgress.value = media.currentTime || 0;
          timeLabel.textContent = `${formattedTime(media.currentTime)}${duration ? ` / ${formattedTime(duration)}` : ''}`;
          const message = draft.first_play_completed ? 'Recording heard. You can choose an answer or replay.' : 'Listen to the complete recording before choosing an answer.';
          if (audioStatus.textContent !== message) audioStatus.textContent = message;
        }
      };
      if (cell.modality === 'audio') {
        playback = globalThis.SentenceFitPlayback.attach({media, draft, save: saveSoon, onChange: audioControls, onError: announce});
        media.addEventListener('loadedmetadata', audioControls);
      }
      audioControls(); save(); downloads(); privacy(); focusHeading();
    }
    function finished() {
      clear();
      const count = state.responses.filter(response => !response.is_practice).length;
      app.append(element('p', 'Demo complete', {class: 'eyebrow'}), element('h1', 'You’ve reached the end'),
        element('p', `You submitted ${count} study items and ${state.practice_assignments.length} practice ${state.practice_assignments.length === 1 ? 'item' : 'items'} from assignment list ${state.assignment_list}. Technical-problem reports are included in these counts.`, {class: 'completion-count'}));
      downloads();
      privacy(); focusHeading();
    }
    function render() {
      if (!state) return intro();
      if (!state.preparation.audio_setup_completed) return setup();
      const item = sequence(state)[state.responses.length];
      if (!item) return finished();
      return trial(item);
    }
    window.addEventListener('pagehide', () => { save(); closeMedia(); closed = true; unlock(); });
    window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
    window.addEventListener('storage', event => {
      if (event.key !== key || !state) return;
      closeMedia(); closed = true;
      app.replaceChildren(element('h1', 'The demo changed in another tab'), element('p', 'Reload this page to use the saved session. This tab has stopped to avoid replacing responses from another tab.', {class: 'error', role: 'alert'}));
      app.append(button('Download this tab’s responses', () => download(JSON.stringify(exportResults(state, data, cells), null, 2), 'application/json', `${data.study_id}-demo-this-tab.json`)), button('Reload saved session', () => location.reload()));
    });
    if (!storageAvailable) storageMessage = 'This browser could not read saved progress. Keep this page open and download your responses before leaving.';
    render();
  }

  return {shuffle, catalog, verifyAssignments, createSession, validateState, sequence, ready, canAdvance, makeResponse, exportResults, csvCell, toCSV, storageKey, mount, fatal};
});
