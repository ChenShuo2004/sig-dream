(() => {
  const form = $('#remix-form');
  if (!form) return;
  const mode = $('#remix-source-mode'), audioInput = $('#remix-file');
  const styleMode = $('#remix-style-mode');
  const durationSelect = $('#remix-duration');
  const durationHint = $('#remix-duration-hint');
  const melodyInput = $('#remix-melody-midi'), chordInput = $('#remix-chord-midi'), drumInput = $('#remix-drum-midi');
  const button = $('#remix-button'), status = $('#remix-model-status');
  const preview = $('#remix-preview'), player = preview.querySelector('audio');
  let previewUrl = '', modelsReady = false;
  const MAX_REMIX_SECONDS = 300;

  function draftKey() { return `remix-draft:${String(window.workbenchProjectId?.() || '__global__')}`; }
  function saveDraft() {
    const values = {};
    for (const field of form.elements) {
      const shared = typeof field.matches === 'function' && field.matches('[data-generation-memory],[data-generation-loading]');
      if (field.name && field.type !== 'file' && !shared) values[field.name] = field.value;
    }
    savedValue(draftKey(), JSON.stringify(values));
  }
  function restoreDraft() {
    let values = {};
    try { values = JSON.parse(savedValue(draftKey()) || '{}'); } catch {}
    for (const field of form.elements) {
      const shared = typeof field.matches === 'function' && field.matches('[data-generation-memory],[data-generation-loading]');
      if (field.name && field.type !== 'file' && !shared && values[field.name] !== undefined) field.value = values[field.name];
    }
    if (values.style_mode === undefined && ['topic','genre','instrument','mood'].some(key=>values[key])) styleMode.value = 'custom';
  }
  function switchProjectDraft() {
    for (const input of [audioInput, melodyInput, chordInput, drumInput]) clearLocalInputReference(input);
    form.reset();
    restoreDraft();
    updateStyleMode();
    updateSourceMode();
    updatePreview();
  }
  function sourceReady() {
    return mode.value === 'audio' ? inputHasSource(audioInput) : inputHasSource(melodyInput) && inputHasSource(chordInput);
  }
  function updateStyleMode() {
    const custom = styleMode.value === 'custom';
    for (const label of form.querySelectorAll('[data-remix-style]')) {
      label.classList.toggle('hidden', !custom);
      label.querySelector('input').disabled = !custom;
    }
    $('#remix-style-hint').textContent = custom
      ? '填写至少一项主题、流派、乐器或情绪；这些条件会影响新版本的编曲。'
      : '不额外指定流派、乐器或情绪；参考歌曲提供旋律、和弦与鼓点条件，生成结果仍可能改变原编曲和音色。';
  }
  function updateButtonState() {
    if (button.dataset.jobId) return;
    const readySource = sourceReady();
    button.disabled = !modelsReady || !readySource;
    if (!modelsReady) return;
    if (!readySource) {
      status.textContent = mode.value === 'audio'
        ? '请先上传参考歌曲（WAV/MP3 等），仅填歌词无法开始重新编曲。'
        : '请同时选择旋律 MIDI 和和弦 MIDI 后再开始。';
      return;
    }
    status.textContent = 'MuLaCover 模型已就绪；生成过程会依次载入转谱、曲风、编曲和解码组件。';
  }
  function formatClock(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  function referenceDurationSeconds() {
    const duration = Number(player?.duration);
    if (Number.isFinite(duration) && duration > 0) return duration;
    return 0;
  }
  function updateDurationHint() {
    if (!durationHint || !durationSelect) return;
    if (mode.value !== 'audio') {
      durationHint.textContent = '当前为 MIDI 来源：请选手动时长（无法自动读取参考歌长度）。';
      if (durationSelect.value === 'source') durationSelect.value = '60';
      return;
    }
    const secs = referenceDurationSeconds();
    if (durationSelect.value === 'source') {
      if (secs > 0) {
        const used = Math.min(MAX_REMIX_SECONDS, Math.max(15, Math.ceil(secs)));
        durationHint.textContent = secs > MAX_REMIX_SECONDS
          ? `参考歌约 ${formatClock(secs)}，将按上限 ${formatClock(used)} 生成。`
          : `将按参考歌时长约 ${formatClock(secs)}（提交时取 ${used} 秒）生成。`;
      } else {
        durationHint.textContent = '已选跟随参考歌：上传并加载试听后会显示具体秒数；超过 5 分钟会截到上限。';
      }
      return;
    }
    durationHint.textContent = '也可选「跟随参考歌曲时长」；超过 5 分钟会截到上限。MIDI 来源请选手动时长。';
  }
  function updateSourceMode() {
    const audio = mode.value === 'audio';
    $('#remix-audio-source').classList.toggle('hidden', !audio);
    $('#remix-midi-source').classList.toggle('hidden', audio);
    audioInput.disabled = !audio;
    for (const input of [melodyInput, chordInput, drumInput]) input.disabled = audio;
    melodyInput.required = chordInput.required = !audio;
    updateDurationHint();
    saveDraft(); updateButtonState();
  }
  function updatePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const file = audioInput.files[0], local = localInputReference(audioInput), present = Boolean(file || local);
    preview.classList.toggle('hidden', !present);
    $('#remix-drop-zone').classList.toggle('hidden', present);
    if (file) { previewUrl = URL.createObjectURL(file); player.src = previewUrl; }
    else if (local && audioInput.dataset.localPreview) { player.src = audioInput.dataset.localPreview; player.load(); previewUrl = ''; }
    else { player.removeAttribute('src'); player.load(); previewUrl = ''; }
    updateDurationHint();
    updateButtonState();
  }
  function waitForAudioDuration(timeoutMs = 8000) {
    const existing = referenceDurationSeconds();
    if (existing > 0) return Promise.resolve(existing);
    return new Promise(resolve => {
      let done = false;
      const finish = value => { if (done) return; done = true; cleanup(); resolve(value); };
      const onMeta = () => finish(referenceDurationSeconds());
      const timer = setTimeout(() => finish(referenceDurationSeconds()), timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        player.removeEventListener('loadedmetadata', onMeta);
        player.removeEventListener('durationchange', onMeta);
      };
      player.addEventListener('loadedmetadata', onMeta);
      player.addEventListener('durationchange', onMeta);
      try { player.load(); } catch {}
    });
  }
  async function refreshModelState() {
    try {
      const health = await api('/api/health'), state = health.ready?.mulacover_models;
      modelsReady = Boolean(health.ready?.capabilities?.mulacover);
      if (modelsReady) status.textContent = 'MuLaCover 模型已就绪；生成过程会依次载入转谱、曲风、编曲和解码组件。';
      else {
        const missing = Object.entries(state?.components || {}).filter(([, value]) => !value.ready).map(([name]) => name);
        status.textContent = `MuLaCover 模型未完整安装${missing.length ? `：${missing.join('、')}` : ''}。请在“模型与设置”中确认模型目录。`;
      }
    } catch (error) { status.textContent = `模型状态读取失败：${error.message}`; modelsReady = false; }
    updateButtonState();
  }

  restoreDraft(); updateStyleMode(); updateSourceMode(); updatePreview(); refreshModelState();
  window.mulacoverSaveDraft = saveDraft;
  window.mulacoverRestoreDraft = switchProjectDraft;
  mode.onchange = updateSourceMode;
  styleMode.onchange = () => { updateStyleMode(); saveDraft(); };
  durationSelect?.addEventListener('change', () => { updateDurationHint(); saveDraft(); });
  player?.addEventListener('loadedmetadata', updateDurationHint);
  player?.addEventListener('durationchange', updateDurationHint);
  audioInput.onchange = () => { clearLocalInputReference(audioInput); updatePreview(); };
  audioInput.addEventListener('local-source-change', updatePreview);
  for (const input of [melodyInput, chordInput, drumInput]) {
    input.onchange = () => { clearLocalInputReference(input); updateButtonState(); };
    input.addEventListener('local-source-change', updateButtonState);
  }
  $('#remix-replace').onclick = () => audioInput.click();
  form.addEventListener('input', event => { if (event.target.type !== 'file') saveDraft(); });
  window.addEventListener('beforeunload', () => { if (previewUrl) URL.revokeObjectURL(previewUrl); });

  form.onsubmit = async event => {
    event.preventDefault();
    const projectScope = String(window.workbenchProjectId?.() || '');
    const result = $('#remix-result');
    try {
      if (!modelsReady) throw new Error('MuLaCover 模型尚未安装完整');
      if (!sourceReady()) throw new Error(mode.value === 'audio' ? '请先选择参考歌曲' : '请同时选择旋律 MIDI 和和弦 MIDI');
      // Show feedback before the slow WAN upload; otherwise the pink button looks dead.
      setSubmitting(button);
      const sourceFile = mode.value === 'audio'
        ? (audioInput.files?.[0] || null)
        : (melodyInput.files?.[0] || chordInput.files?.[0] || null);
      const sizeMb = sourceFile ? Math.max(0.1, sourceFile.size / (1024 * 1024)) : 0;
      const waitHint = !sourceFile ? ''
        : sizeMb <= 1 ? '约 1 分钟内'
        : sizeMb <= 5 ? '约 1–2 分钟'
        : sizeMb <= 20 ? '约 2–5 分钟'
        : sizeMb <= 50 ? '约 5–10 分钟'
        : '约 10–15 分钟';
      button.textContent = mode.value === 'audio' ? '正在上传参考歌曲…' : '正在上传 MIDI…';
      status.textContent = mode.value === 'audio'
        ? `正在上传参考歌曲到云端（${sizeMb.toFixed(1)} MB，${waitHint}），随后由文件机提交 YuE2。`
        : `正在上传 MIDI 到云端（${waitHint || '请稍候'}）…`;
      if (result) result.innerHTML = `<div class="result-card"><p class="meta">${status.textContent}</p></div>`;
      const data = Object.fromEntries(new FormData(form).entries());
      const vocalGender = String(data.vocal_gender || '').trim();
      delete data.vocal_gender;
      // Resolve「跟随参考歌曲」before numeric coercion.
      if (String(data.duration_seconds) === 'source') {
        if (mode.value !== 'audio') throw new Error('MIDI 来源请选手动生成时长');
        const secs = await waitForAudioDuration();
        if (!(secs > 0)) throw new Error('还读不到参考歌时长，请先点开上方试听加载完成后再提交');
        data.duration_seconds = Math.min(MAX_REMIX_SECONDS, Math.max(15, Math.ceil(secs)));
        status.textContent = `按参考歌约 ${formatClock(secs)} 生成（实际提交 ${data.duration_seconds} 秒）· ${status.textContent}`;
      } else {
        data.duration_seconds = Number(data.duration_seconds);
      }
      for (const key of ['semitone_shift','octave_shift','topk']) data[key] = Number(data[key]);
      for (const key of ['cfg_scale','temperature']) data[key] = Number(data[key]);
      data.seed = safeSeed(data.seed); data.decode_seed = safeSeed(data.decode_seed);
      if (vocalGender === 'male' || vocalGender === 'female') {
        const tag = vocalGender === 'male' ? 'male vocal' : 'female vocal';
        data.style_mode = 'custom';
        const mood = String(data.mood || '').trim();
        data.mood = mood && !mood.toLowerCase().includes('vocal') ? `${mood}, ${tag}` : (mood || tag);
        // Ensure disabled custom fields still travel when only gender was chosen.
        for (const key of ['topic', 'genre', 'instrument', 'mood']) {
          if (data[key] == null) data[key] = '';
        }
        if (!data.genre) data.genre = 'Mandarin pop';
      }
      if (mode.value === 'audio') {
        data.source_path = await inputSourceValue(audioInput);
        if (!data.source_path) throw new Error('参考歌曲上传失败，请重试或换较小的音频文件');
      } else {
        const [melody, chord, drum] = await Promise.all([
          inputSourceValue(melodyInput), inputSourceValue(chordInput), inputSourceValue(drumInput)
        ]);
        data.melody_midi = melody; data.chord_midi = chord;
        if (drum) data.drum_midi = drum;
        if (!data.melody_midi || !data.chord_midi) throw new Error('MIDI 上传失败，请重试');
      }
      button.textContent = '正在提交重新编曲任务…';
      status.textContent = '参考素材已上传，正在提交 MuLaCover 任务…';
      saveDraft();
      const job = await submit('mulacover_remix', data, result, button, projectScope);
      if (String(window.workbenchProjectId?.() || '') !== projectScope) return;
      status.textContent = job?.status === 'complete'
        ? '重新编曲已完成，可在下方试听；需要指定某个人声时点「发送到音色转换」。'
        : '任务已结束。';
      updateButtonState();
    } catch (error) {
      restoreButton(button);
      updateButtonState();
      const message = error?.message || String(error);
      status.textContent = `提交失败：${message}`;
      renderScopedFailure(result, error, projectScope);
    }
  };
  setInterval(refreshModelState, 15000);
})();
