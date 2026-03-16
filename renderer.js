/**
 * renderer.js — Renders analysis results to DOM
 */

const SPEAKER_COLORS = [
  { color: 'var(--sp0)', bg: 'var(--sp0-bg)' },
  { color: 'var(--sp1)', bg: 'var(--sp1-bg)' },
  { color: 'var(--sp2)', bg: 'var(--sp2-bg)' },
  { color: 'var(--sp3)', bg: 'var(--sp3-bg)' },
  { color: 'var(--sp4)', bg: 'var(--sp4-bg)' },
  { color: 'var(--sp5)', bg: 'var(--sp5-bg)' },
  { color: 'var(--sp6)', bg: 'var(--sp6-bg)' },
  { color: 'var(--sp7)', bg: 'var(--sp7-bg)' },
];

function getSpeakerColor(index) {
  return SPEAKER_COLORS[index % SPEAKER_COLORS.length];
}

function tsToSec(ts) {
  if (!ts) return 0;
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parseFloat(ts) || 0;
}

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

/** Build speaker ID → color index map */
function buildColorMap(speakers) {
  const map = {};
  speakers.forEach((sp, i) => { map[sp.id] = i; });
  return map;
}

/** Calculate total duration from all speakers' last segment */
function getTotalDuration(speakers) {
  let max = 0;
  speakers.forEach(sp => {
    sp.segments.forEach(seg => {
      const end = tsToSec(seg.end);
      if (end > max) max = end;
    });
  });
  return max || 1;
}

/** ===== Render Speakers Panel ===== */
export function renderSpeakers(speakers, container) {
  container.innerHTML = '';
  if (!speakers || speakers.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:24px">Không phát hiện được người nói.</p>';
    return;
  }

  const colorMap = buildColorMap(speakers);
  const totalDuration = getTotalDuration(speakers);

  speakers.forEach(speaker => {
    const idx = colorMap[speaker.id] ?? 0;
    const { color, bg } = getSpeakerColor(idx);

    const card = document.createElement('div');
    card.className = 'speaker-card';

    // Header
    const header = document.createElement('div');
    header.className = 'speaker-header';
    header.innerHTML = `
      <div class="speaker-avatar" style="background:${bg};color:${color};border:1.5px solid ${color}">${initials(speaker.name)}</div>
      <div>
        <div class="speaker-name">${speaker.name}</div>
        <div class="speaker-stats">${speaker.role || ''} ${speaker.totalTalkTime ? '· ' + speaker.totalTalkTime : ''}</div>
      </div>
    `;
    card.appendChild(header);

    // Timeline track
    const trackLabel = document.createElement('div');
    trackLabel.className = 'speaker-timeline-label';
    trackLabel.textContent = 'Timeline:';
    card.appendChild(trackLabel);

    const track = document.createElement('div');
    track.className = 'timeline-track';
    speaker.segments.forEach(seg => {
      const startPct = (tsToSec(seg.start) / totalDuration) * 100;
      const endPct = (tsToSec(seg.end) / totalDuration) * 100;
      const widthPct = Math.max(endPct - startPct, 1.2);
      const segment = document.createElement('div');
      segment.className = 'timeline-segment';
      segment.style.cssText = `left:${startPct}%;width:${widthPct}%;background:${color};`;
      segment.title = `${seg.start} – ${seg.end}: ${seg.text}`;
      track.appendChild(segment);
    });
    card.appendChild(track);

    // Timestamp chips
    const chips = document.createElement('div');
    chips.className = 'speaker-timestamps';
    speaker.segments.forEach(seg => {
      const chip = document.createElement('span');
      chip.className = 'ts-chip';
      chip.style.cssText = `color:${color};background:${bg};border-color:${color}40;`;
      chip.title = seg.text;
      chip.textContent = `${seg.start} – ${seg.end}`;
      chips.appendChild(chip);
    });
    card.appendChild(chips);

    // Key contributions
    if (speaker.keyContributions && speaker.keyContributions.length > 0) {
      const contribTitle = document.createElement('div');
      contribTitle.className = 'speaker-timeline-label';
      contribTitle.style.marginTop = '12px';
      contribTitle.textContent = 'Đóng góp chính:';
      card.appendChild(contribTitle);

      const ul = document.createElement('ul');
      ul.className = 'summary-list';
      ul.style.marginTop = '6px';
      speaker.keyContributions.forEach(c => {
        const li = document.createElement('li');
        li.textContent = c;
        ul.appendChild(li);
      });
      card.appendChild(ul);
    }

    container.appendChild(card);
  });
}

/** ===== Render Topics Panel ===== */
export function renderTopics(topics, speakers, container) {
  container.innerHTML = '';
  if (!topics || topics.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:24px">Không phát hiện được chủ đề.</p>';
    return;
  }

  const colorMap = buildColorMap(speakers || []);
  const speakerMap = {};
  (speakers || []).forEach(sp => { speakerMap[sp.id] = sp; });

  const priorityLabel = { high: '🔴 Ưu tiên cao', medium: '🟡 Trung bình', low: '🟢 Thấp' };

  topics.forEach(topic => {
    const card = document.createElement('div');
    card.className = 'topic-card';

    const header = document.createElement('div');
    header.className = 'topic-header';
    header.innerHTML = `
      <div class="topic-title">🏷️ ${topic.title}</div>
      <span class="topic-badge">${priorityLabel[topic.priority] || topic.priority}</span>
    `;
    card.appendChild(header);

    if (topic.description) {
      const desc = document.createElement('div');
      desc.className = 'topic-desc';
      desc.textContent = topic.description;
      card.appendChild(desc);
    }

    // Speaker chips
    if (topic.speakerIds && topic.speakerIds.length > 0) {
      const speakerRow = document.createElement('div');
      speakerRow.innerHTML = '<div class="speaker-timeline-label">Người tham gia:</div>';
      const speakerChips = document.createElement('div');
      speakerChips.className = 'topic-speakers';
      topic.speakerIds.forEach(sid => {
        const sp = speakerMap[sid];
        if (!sp) return;
        const idx = colorMap[sid] ?? 0;
        const { color, bg } = getSpeakerColor(idx);
        const chip = document.createElement('span');
        chip.className = 'topic-speaker-chip';
        chip.style.cssText = `color:${color};background:${bg};border-color:${color}50;`;
        chip.textContent = sp.name;
        speakerChips.appendChild(chip);
      });
      speakerRow.appendChild(speakerChips);
      card.appendChild(speakerRow);
    }

    // Timestamps
    if (topic.timestamps && topic.timestamps.length > 0) {
      const tsSection = document.createElement('div');
      tsSection.style.marginTop = '10px';
      tsSection.innerHTML = '<div class="speaker-timeline-label">Thời điểm thảo luận:</div>';
      const tsChips = document.createElement('div');
      tsChips.className = 'topic-timestamps';
      topic.timestamps.forEach(ts => {
        const chip = document.createElement('span');
        chip.className = 'topic-ts-chip';
        chip.title = ts.summary || '';
        chip.textContent = `${ts.start} – ${ts.end}`;
        tsChips.appendChild(chip);
      });
      tsSection.appendChild(tsChips);
      if (topic.timestamps.some(t => t.summary)) {
        topic.timestamps.forEach(ts => {
          if (ts.summary) {
            const s = document.createElement('div');
            s.style.cssText = 'font-size:0.75rem;color:var(--text-muted);margin-top:6px;font-style:italic;';
            s.textContent = `"${ts.summary}"`;
            tsSection.appendChild(s);
          }
        });
      }
      card.appendChild(tsSection);
    }

    // Keywords
    if (topic.keywords && topic.keywords.length > 0) {
      const kwSection = document.createElement('div');
      kwSection.className = 'topic-keywords';
      topic.keywords.forEach(kw => {
        const chip = document.createElement('span');
        chip.className = 'keyword-chip';
        chip.textContent = '#' + kw;
        kwSection.appendChild(chip);
      });
      card.appendChild(kwSection);
    }

    container.appendChild(card);
  });
}

/** ===== Render PM Summary Panel ===== */
export function renderSummary(pmSummary, container) {
  container.innerHTML = '';
  if (!pmSummary) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:24px">Không có tóm tắt.</p>';
    return;
  }

  const sentimentLabel = { positive: '😊 Tích cực', neutral: '😐 Trung tính', negative: '😟 Tiêu cực' };
  const efficiencyLabel = { high: '⚡ Cao', medium: '📊 Trung bình', low: '🐢 Thấp' };

  // Meta grid
  const metaSection = document.createElement('div');
  metaSection.className = 'summary-section';
  metaSection.innerHTML = `
    <div class="summary-section-title">📊 Tổng quan</div>
    <div class="summary-meta-grid">
      <div class="summary-meta-item">
        <div class="summary-meta-label">Không khí</div>
        <div class="summary-meta-value">${sentimentLabel[pmSummary.overallSentiment] || pmSummary.overallSentiment || '–'}</div>
      </div>
      <div class="summary-meta-item">
        <div class="summary-meta-label">Hiệu quả họp</div>
        <div class="summary-meta-value">${efficiencyLabel[pmSummary.meetingEfficiency] || pmSummary.meetingEfficiency || '–'}</div>
      </div>
    </div>
  `;
  container.appendChild(metaSection);

  // Objective
  if (pmSummary.objective) {
    const s = document.createElement('div');
    s.className = 'summary-section';
    s.innerHTML = `<div class="summary-section-title">🎯 Mục tiêu cuộc họp</div><div class="summary-text">${pmSummary.objective}</div>`;
    container.appendChild(s);
  }

  // Key Decisions
  if (pmSummary.keyDecisions?.length) {
    const s = createListSection('✅ Quyết định đã đưa ra', pmSummary.keyDecisions);
    container.appendChild(s);
  }

  // Achievements
  if (pmSummary.achievements?.length) {
    const s = createListSection('🏆 Thành quả đạt được', pmSummary.achievements);
    container.appendChild(s);
  }

  // Blockers
  if (pmSummary.blockers?.length) {
    const s = createListSection('🚧 Vấn đề & Trở ngại', pmSummary.blockers);
    container.appendChild(s);
  }

  // Risks
  if (pmSummary.risks?.length) {
    const s = createListSection('⚠️ Rủi ro', pmSummary.risks);
    container.appendChild(s);
  }

  // Next meeting
  if (pmSummary.nextMeeting) {
    const s = document.createElement('div');
    s.className = 'summary-section';
    s.innerHTML = `<div class="summary-section-title">📅 Đề xuất họp tiếp theo</div><div class="summary-text">${pmSummary.nextMeeting}</div>`;
    container.appendChild(s);
  }

  // Notes
  if (pmSummary.notes) {
    const s = document.createElement('div');
    s.className = 'summary-section';
    s.innerHTML = `<div class="summary-section-title">📝 Ghi chú</div><div class="summary-text">${pmSummary.notes}</div>`;
    container.appendChild(s);
  }
}

function createListSection(title, items) {
  const s = document.createElement('div');
  s.className = 'summary-section';
  const titleEl = document.createElement('div');
  titleEl.className = 'summary-section-title';
  titleEl.textContent = title;
  s.appendChild(titleEl);
  const ul = document.createElement('ul');
  ul.className = 'summary-list';
  items.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item;
    ul.appendChild(li);
  });
  s.appendChild(ul);
  return s;
}

/** ===== Render Actions Panel ===== */
export function renderActions(actions, container) {
  container.innerHTML = '';
  if (!actions || actions.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:24px">Không tìm thấy hành động nào.</p>';
    return;
  }

  const agreed = actions.filter(a => a.type === 'agreed');
  const suggested = actions.filter(a => a.type === 'suggested');
  const priorityIcon = { high: '🔴', medium: '🟡', low: '🟢' };

  if (agreed.length > 0) {
    const section = document.createElement('div');
    section.className = 'actions-section';
    const title = document.createElement('div');
    title.className = 'actions-section-title';
    title.innerHTML = '✅ <span>Đã Thống Nhất</span> <span style="font-size:0.75rem;font-weight:400;text-transform:none;letter-spacing:0">(được cam kết trong cuộc họp)</span>';
    section.appendChild(title);
    agreed.forEach(a => section.appendChild(createActionCard(a, priorityIcon)));
    container.appendChild(section);
  }

  if (suggested.length > 0) {
    const section = document.createElement('div');
    section.className = 'actions-section';
    section.style.marginTop = '24px';
    const title = document.createElement('div');
    title.className = 'actions-section-title';
    title.innerHTML = '💡 <span>AI Gợi Ý</span> <span style="font-size:0.75rem;font-weight:400;text-transform:none;letter-spacing:0">(chưa được cam kết, AI đề xuất)</span>';
    section.appendChild(title);
    suggested.forEach(a => section.appendChild(createActionCard(a, priorityIcon)));
    container.appendChild(section);
  }
}

function createActionCard(action, priorityIcon) {
  const card = document.createElement('div');
  card.className = `action-card ${action.type}`;

  const icon = document.createElement('div');
  icon.className = 'action-icon';
  icon.textContent = action.type === 'agreed' ? '✅' : '💡';
  card.appendChild(icon);

  const body = document.createElement('div');
  body.className = 'action-body';

  const text = document.createElement('div');
  text.className = 'action-text';
  text.textContent = `${priorityIcon[action.priority] || ''} ${action.text}`;
  body.appendChild(text);

  const meta = document.createElement('div');
  meta.className = 'action-meta';

  if (action.assignee) {
    const a = document.createElement('span');
    a.className = 'action-assignee';
    a.textContent = `👤 ${action.assignee}`;
    meta.appendChild(a);
  }
  if (action.deadline) {
    const d = document.createElement('span');
    d.className = 'action-deadline';
    d.textContent = `⏰ ${action.deadline}`;
    meta.appendChild(d);
  }
  if (action.type === 'agreed' && action.source) {
    const s = document.createElement('span');
    s.className = 'action-source';
    s.textContent = action.source;
    meta.appendChild(s);
  }
  if (action.type === 'suggested' && action.reason) {
    const r = document.createElement('span');
    r.className = 'action-source';
    r.style.color = 'var(--accent-bright)';
    r.textContent = `💬 ${action.reason}`;
    meta.appendChild(r);
  }
  body.appendChild(meta);
  card.appendChild(body);

  const badge = document.createElement('span');
  badge.className = `action-badge ${action.type}`;
  badge.textContent = action.type === 'agreed' ? 'Thống nhất' : 'Gợi ý';
  card.appendChild(badge);

  return card;
}

/** ===== Render Result Meta ===== */
export function renderResultMeta(result) {
  document.getElementById('resultTitle').textContent = result.meetingTitle || 'Phân tích cuộc họp';
  document.getElementById('resultDate').textContent = new Date().toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  document.getElementById('resultDuration').textContent = result.duration || '';
  const speakerCount = result.speakers?.length || 0;
  document.getElementById('resultSpeakers').textContent = `${speakerCount} người nói`;
}
