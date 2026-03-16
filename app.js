/**
 * app.js — Main Orchestrator
 * MeetingMind Web App
 */

import { getApiKey, setApiKey, isApiKeySet, transcribeAudio, analyzeTranscript, getDemoResult } from './openai.js';
import { renderSpeakers, renderTopics, renderSummary, renderActions, renderResultMeta } from './renderer.js';

// ─── State ────────────────────────────────────────────────────────────
let state = {
  currentResult: null,
  history: [],
  selectedFile: null,
  voiceTranscript: '',
  isRecording: false,
  recognition: null,
  isDemoMode: false,
};

// ─── Init ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadHistory();
  setupApiKeyModal();
  setupInputTabs();
  setupVoiceInput();
  setupFileUpload();
  setupResultTabs();
  setupAnalyzeBtn();
  setupDemoBtn();
  setupExportBtns();
  setupHistoryControls();
  setupSettingsBtn();
  checkApiStatus();
});

// ─── API Key Modal ─────────────────────────────────────────────────────
function setupApiKeyModal() {
  const modal = document.getElementById('apiKeyModal');
  const input = document.getElementById('apiKeyInput');
  const toggle = document.getElementById('toggleApiKey');
  const saveBtn = document.getElementById('saveApiKey');
  const skipBtn = document.getElementById('skipApiKey');

  // Pre-fill if key exists
  const existingKey = getApiKey();
  if (existingKey) {
    input.value = existingKey;
    modal.classList.remove('active');
  }

  toggle.addEventListener('click', () => {
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  saveBtn.addEventListener('click', () => {
    const val = input.value.trim();
    if (!val || !val.startsWith('sk-')) {
      input.style.borderColor = 'var(--danger)';
      setTimeout(() => { input.style.borderColor = ''; }, 1500);
      return;
    }
    setApiKey(val);
    state.isDemoMode = false;
    modal.classList.remove('active');
    checkApiStatus();
  });

  skipBtn.addEventListener('click', () => {
    state.isDemoMode = true;
    modal.classList.remove('active');
    checkApiStatus();
  });
}

function checkApiStatus() {
  const badge = document.getElementById('apiStatus');
  const text = document.getElementById('apiStatusText');
  if (isApiKeySet() && !state.isDemoMode) {
    badge.className = 'api-badge active';
    text.textContent = 'API Active';
  } else {
    badge.className = 'api-badge demo';
    text.textContent = 'Demo Mode';
  }
}

document.getElementById('settingsBtn')?.addEventListener('click', () => {
  const modal = document.getElementById('apiKeyModal');
  modal.classList.add('active');
});

function setupSettingsBtn() {
  // Wired by inline listener above (already mounted)
}

// ─── Input Tabs ────────────────────────────────────────────────────────
function setupInputTabs() {
  const tabs = document.querySelectorAll('.input-tab');
  const modes = document.querySelectorAll('.input-mode');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      modes.forEach(m => m.classList.remove('active'));
      tab.classList.add('active');
      const targetMode = document.getElementById('mode' + capitalize(tab.dataset.tab));
      if (targetMode) targetMode.classList.add('active');
    });
  });
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─── Voice Input ────────────────────────────────────────────────────────
function setupVoiceInput() {
  const voiceBtn = document.getElementById('voiceBtn');
  const voiceStatus = document.getElementById('voiceStatus');
  const waveform = document.getElementById('voiceWaveform');
  const transcriptDiv = document.getElementById('voiceTranscript');
  const langSelect = document.getElementById('voiceLang');

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    voiceBtn.disabled = true;
    voiceStatus.textContent = 'Trình duyệt không hỗ trợ Voice Input. Dùng Chrome/Edge.';
    voiceStatus.style.color = 'var(--danger)';
    return;
  }

  voiceBtn.addEventListener('click', () => {
    if (state.isRecording) {
      stopVoiceRecording();
    } else {
      startVoiceRecording();
    }
  });

  function startVoiceRecording() {
    state.recognition = new SpeechRecognition();
    state.recognition.continuous = true;
    state.recognition.interimResults = true;
    state.recognition.lang = langSelect.value;

    let finalTranscript = state.voiceTranscript || '';

    state.recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript + ' ';
          state.voiceTranscript = finalTranscript;
        } else {
          interim += result[0].transcript;
        }
      }
      transcriptDiv.textContent = finalTranscript + interim;
    };

    state.recognition.onerror = (e) => {
      console.error('Voice error:', e.error);
      voiceStatus.textContent = `Lỗi: ${e.error}`;
      stopVoiceRecording();
    };

    state.recognition.onend = () => {
      if (state.isRecording) state.recognition.start();
    };

    state.recognition.start();
    state.isRecording = true;
    voiceBtn.classList.add('recording');
    voiceBtn.querySelector('.voice-label').textContent = 'Đang ghi...';
    voiceStatus.textContent = '🔴 Đang ghi âm';
    voiceStatus.style.color = 'var(--danger)';
    waveform.classList.add('active');
    transcriptDiv.textContent = finalTranscript || '';
  }

  function stopVoiceRecording() {
    if (state.recognition) {
      state.recognition.onend = null;
      state.recognition.stop();
      state.recognition = null;
    }
    state.isRecording = false;
    voiceBtn.classList.remove('recording');
    voiceBtn.querySelector('.voice-label').textContent = 'Nhấn để nói';
    voiceStatus.textContent = 'Sẵn sàng';
    voiceStatus.style.color = '';
    waveform.classList.remove('active');
  }
}

// ─── File Upload ────────────────────────────────────────────────────────
function setupFileUpload() {
  const dropZone = document.getElementById('fileDropZone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseFileBtn');
  const fileInfo = document.getElementById('fileInfo');
  const fileName = document.getElementById('fileName');
  const fileSize = document.getElementById('fileSize');
  const removeBtn = document.getElementById('removeFile');

  browseBtn.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('click', (e) => {
    if (e.target !== browseBtn) fileInput.click();
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) setFile(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) setFile(fileInput.files[0]);
  });

  removeBtn.addEventListener('click', () => {
    state.selectedFile = null;
    fileInput.value = '';
    fileInfo.classList.add('hidden');
    dropZone.style.display = '';
  });

  function setFile(file) {
    state.selectedFile = file;
    fileName.textContent = file.name;
    fileSize.textContent = formatBytes(file.size);
    fileInfo.classList.remove('hidden');
    dropZone.style.display = 'none';
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// ─── Result Tabs ────────────────────────────────────────────────────────
function setupResultTabs() {
  const tabs = document.querySelectorAll('.result-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.result-content').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById('panel' + capitalize(tab.dataset.panel));
      if (panel) panel.classList.add('active');
    });
  });
}

// ─── Analyze ────────────────────────────────────────────────────────────
function setupAnalyzeBtn() {
  document.getElementById('analyzeBtn').addEventListener('click', handleAnalyze);
}

async function handleAnalyze() {
  const activeTab = document.querySelector('.input-tab.active')?.dataset?.tab;
  let transcript = '';
  let fileLang = 'vi';

  try {
    if (activeTab === 'text') {
      transcript = document.getElementById('textInput').value.trim();
      if (!transcript) { showError('Vui lòng nhập transcript hoặc nội dung cần phân tích.'); return; }
    } else if (activeTab === 'voice') {
      transcript = document.getElementById('voiceTranscript').textContent.trim();
      if (!transcript || transcript === 'Transcript sẽ xuất hiện ở đây...') {
        showError('Vui lòng ghi âm hoặc nhập nội dung trước.'); return;
      }
    } else if (activeTab === 'file') {
      if (!state.selectedFile) { showError('Vui lòng chọn file cần phân tích.'); return; }
      fileLang = document.getElementById('fileLang').value;
    }

    const context = document.getElementById('contextInput').value.trim();
    setAnalyzeLoading(true);
    showLoadingOverlay(true, 'Đang chuẩn bị...', '', 5);

    // Demo mode
    if (state.isDemoMode || !isApiKeySet()) {
      await simulateDemoAnalysis();
      return;
    }

    // File mode → transcribe first
    if (activeTab === 'file' && state.selectedFile) {
      const ext = state.selectedFile.name.split('.').pop().toLowerCase();
      if (['txt', 'srt', 'md'].includes(ext)) {
        // Read as text
        transcript = await readFileAsText(state.selectedFile);
        if (ext === 'srt') transcript = parseSRT(transcript);
        showLoadingOverlay(true, 'Đọc file văn bản...', '', 30);
      } else {
        // Audio/Video → Whisper
        showLoadingOverlay(true, 'Transcribing với Whisper API...', 'Có thể mất 1-2 phút với file dài', 10);
        const result = await transcribeAudio(state.selectedFile, fileLang, (pct, msg) => {
          showLoadingOverlay(true, msg, '', pct);
        });
        transcript = buildTranscriptFromSegments(result);
        showLoadingOverlay(true, 'Transcription xong!', '', 60);
      }
    }

    showLoadingOverlay(true, 'Phân tích với GPT-4o...', 'Đang nhận dạng speakers, topics, actions...', 65);
    const analysisResult = await analyzeTranscript(transcript, context, (pct, msg) => {
      showLoadingOverlay(true, msg, '', pct);
    });

    showLoadingOverlay(true, 'Đang hiển thị kết quả...', '', 95);
    await sleep(400);
    displayResult(analysisResult);

  } catch (err) {
    console.error('Analysis error:', err);
    showError(err.message || 'Đã xảy ra lỗi. Vui lòng thử lại.');
  } finally {
    setAnalyzeLoading(false);
    showLoadingOverlay(false);
  }
}

async function simulateDemoAnalysis() {
  const steps = [
    [10, 'Đang transcribe audio...', 'Whisper API (demo)'],
    [40, 'Nhận dạng người nói...', 'Speaker diarization'],
    [60, 'Phân tích chủ đề...', 'Topic clustering'],
    [80, 'Tạo PM Summary...', 'GPT-4o analysis'],
    [95, 'Trích xuất hành động...', 'Action extraction'],
  ];
  for (const [pct, step, sub] of steps) {
    showLoadingOverlay(true, step, sub, pct);
    await sleep(600);
  }
  displayResult(getDemoResult());
}

function buildTranscriptFromSegments(whisperResult) {
  if (!whisperResult.segments || whisperResult.segments.length === 0) {
    return whisperResult.text;
  }
  return whisperResult.segments
    .map(s => `[${formatSeconds(s.start)} – ${formatSeconds(s.end)}] ${s.text}`)
    .join('\n');
}

function formatSeconds(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function parseSRT(srtText) {
  const lines = srtText.split('\n');
  const result = [];
  let i = 0;
  while (i < lines.length) {
    if (/^\d+$/.test(lines[i]?.trim())) {
      const timestamp = lines[i + 1] || '';
      const match = timestamp.match(/(\d{2}:\d{2}:\d{2})/);
      const start = match ? match[1].slice(3) : ''; // MM:SS
      const textLines = [];
      i += 2;
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i]);
        i++;
      }
      if (textLines.length > 0) {
        result.push(`[${start}] ${textLines.join(' ')}`);
      }
    }
    i++;
  }
  return result.join('\n') || srtText;
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file, 'utf-8');
  });
}

// ─── Display Result ────────────────────────────────────────────────────
function displayResult(result) {
  state.currentResult = result;
  saveToHistory(result);

  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('resultsPanel').classList.remove('hidden');

  renderResultMeta(result);
  renderSpeakers(result.speakers || [], document.getElementById('speakersList'));
  renderTopics(result.topics || [], result.speakers || [], document.getElementById('topicsList'));
  renderSummary(result.pmSummary, document.getElementById('summaryContent'));
  renderActions(result.actions || [], document.getElementById('actionsList'));

  // Switch to first tab
  document.querySelector('.result-tab[data-panel="speakers"]').click();
}

// ─── Demo ────────────────────────────────────────────────────────────
function setupDemoBtn() {
  document.getElementById('demoBtn').addEventListener('click', () => {
    // Switch to text tab and fill demo transcript
    document.querySelector('.input-tab[data-tab="text"]').click();
    document.getElementById('textInput').value =
`[00:00] John: Chào buổi sáng mọi người, hôm nay chúng ta họp về dự án XYZ.
[00:30] Mary: Tôi thấy sprint này cần hoàn thành module payment trước.
[01:00] John: Đồng ý. Action: John sẽ review code payment vào thứ 4.
[02:00] Tom: Về phía design, tôi cần feedback về mockup màn hình dashboard.
[02:30] Mary: Tôi sẽ review mockup và gửi feedback trước thứ 6.
[03:00] John: Chúng ta cũng cần discuss về budget. Tom, bạn có thể chuẩn bị báo cáo?
[04:00] Tom: OK, tôi sẽ chuẩn bị báo cáo budget vào thứ 5.`;
    document.getElementById('contextInput').value = 'Sprint planning dự án XYZ, Q1 2026';
  });
}

// ─── Export ────────────────────────────────────────────────────────────
function setupExportBtns() {
  document.getElementById('copyResultBtn').addEventListener('click', () => {
    if (!state.currentResult) return;
    navigator.clipboard.writeText(resultToMarkdown(state.currentResult))
      .then(() => showToast('Đã copy!'));
  });

  document.getElementById('exportMdBtn').addEventListener('click', () => {
    if (!state.currentResult) return;
    const md = resultToMarkdown(state.currentResult);
    downloadFile(md, `meetingmind-${Date.now()}.md`, 'text/markdown');
  });

  document.getElementById('exportPdfBtn').addEventListener('click', () => {
    window.print();
  });
}

function resultToMarkdown(r) {
  const lines = [];
  lines.push(`# ${r.meetingTitle || 'Biên bản cuộc họp'}`);
  lines.push(`**Ngày:** ${new Date().toLocaleDateString('vi-VN')} | **Thời lượng:** ${r.duration || '–'} | **Ngôn ngữ:** ${r.language || '–'}`);
  lines.push('');

  // Speakers
  lines.push('## 👤 Người Tham Dự');
  (r.speakers || []).forEach(sp => {
    lines.push(`### ${sp.name} (${sp.role || '–'})`);
    lines.push(`- Thời gian nói: ${sp.totalTalkTime || '–'}`);
    (sp.keyContributions || []).forEach(c => lines.push(`- ${c}`));
  });
  lines.push('');

  // Topics
  lines.push('## 🏷️ Chủ Đề Thảo Luận');
  (r.topics || []).forEach(t => {
    lines.push(`### ${t.title}`);
    lines.push(t.description || '');
    if (t.timestamps?.length) {
      lines.push('**Thời điểm:** ' + t.timestamps.map(ts => `${ts.start}–${ts.end}`).join(', '));
    }
  });
  lines.push('');

  // PM Summary
  const pm = r.pmSummary || {};
  lines.push('## 📋 Tóm Tắt PM');
  if (pm.objective) lines.push(`**Mục tiêu:** ${pm.objective}`);
  if (pm.keyDecisions?.length) {
    lines.push('\n### Quyết định');
    pm.keyDecisions.forEach(d => lines.push(`- ${d}`));
  }
  if (pm.blockers?.length) {
    lines.push('\n### Vấn đề & Trở ngại');
    pm.blockers.forEach(b => lines.push(`- ${b}`));
  }
  lines.push('');

  // Actions
  lines.push('## ✅ Hành Động Tiếp Theo');
  const agreed = (r.actions || []).filter(a => a.type === 'agreed');
  const suggested = (r.actions || []).filter(a => a.type === 'suggested');
  if (agreed.length) {
    lines.push('\n### Đã Thống Nhất');
    agreed.forEach(a => lines.push(`- [ ] **${a.text}** | 👤 ${a.assignee || '–'} | ⏰ ${a.deadline || '–'}`));
  }
  if (suggested.length) {
    lines.push('\n### AI Gợi Ý');
    suggested.forEach(a => lines.push(`- [ ] ${a.text} *(${a.reason || ''})*`));
  }

  return lines.join('\n');
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── History ────────────────────────────────────────────────────────────
function setupHistoryControls() {
  document.getElementById('clearHistoryBtn').addEventListener('click', () => {
    state.history = [];
    localStorage.removeItem('mm_history');
    renderHistoryList();
  });
}

function saveToHistory(result) {
  const item = {
    id: Date.now(),
    title: result.meetingTitle || 'Phân tích cuộc họp',
    date: new Date().toISOString(),
    result,
  };
  state.history.unshift(item);
  if (state.history.length > 20) state.history = state.history.slice(0, 20);
  localStorage.setItem('mm_history', JSON.stringify(state.history));
  renderHistoryList();
}

function loadHistory() {
  try {
    state.history = JSON.parse(localStorage.getItem('mm_history') || '[]');
  } catch { state.history = []; }
  renderHistoryList();
}

function renderHistoryList() {
  const container = document.getElementById('historyList');
  if (state.history.length === 0) {
    container.innerHTML = '<div class="history-empty">Chưa có phân tích nào</div>';
    return;
  }
  container.innerHTML = '';
  state.history.forEach(item => {
    const el = document.createElement('div');
    el.className = 'history-item';
    el.innerHTML = `
      <div class="history-item-icon">📋</div>
      <div class="history-item-title" title="${item.title}">${item.title}</div>
      <div class="history-item-date">${new Date(item.date).toLocaleDateString('vi-VN')}</div>
    `;
    el.addEventListener('click', () => displayResult(item.result));
    container.appendChild(el);
  });
}

// ─── UI Helpers ────────────────────────────────────────────────────────
function setAnalyzeLoading(loading) {
  const btn = document.getElementById('analyzeBtn');
  const text = document.getElementById('analyzeBtnText');
  const loader = document.getElementById('analyzeBtnLoader');
  btn.disabled = loading;
  text.style.display = loading ? 'none' : '';
  loader.classList.toggle('hidden', !loading);
}

function showLoadingOverlay(show, step = '', substep = '', pct = 0) {
  const overlay = document.getElementById('loadingOverlay');
  overlay.classList.toggle('hidden', !show);
  if (show) {
    document.getElementById('loadingStep').textContent = step;
    document.getElementById('loadingSubstep').textContent = substep;
    document.getElementById('loadingFill').style.width = pct + '%';
  }
}

function showError(msg) {
  showToast(msg, 'error');
}

function showToast(msg, type = 'success') {
  const existing = document.getElementById('mm-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'mm-toast';
  toast.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:9999;
    background:${type === 'error' ? 'rgba(239,68,68,0.95)' : 'rgba(34,197,94,0.95)'};
    color:#fff;padding:12px 20px;border-radius:10px;
    font-family:var(--font);font-size:0.85rem;font-weight:500;
    box-shadow:0 4px 20px rgba(0,0,0,0.4);
    animation: slideIn 0.3s ease;
    max-width:320px;word-break:break-word;
  `;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
