/**
 * MeetingMind — app-bundle.js
 * Supports: OpenAI (Whisper + GPT-4o) & Google Gemini (audio + analysis)
 */

// ═══════════════════════════════════════════════
//  SETTINGS / PROVIDER MANAGEMENT
// ═══════════════════════════════════════════════
const OPENAI_BASE = 'https://api.openai.com/v1';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function getProvider()  { return localStorage.getItem('mm_provider') || 'openai'; }
function setProvider(p) { localStorage.setItem('mm_provider', p); }
function getApiKey()    { return localStorage.getItem('mm_key_' + getProvider()) || ''; }
function getRawKey(p)   { return localStorage.getItem('mm_key_' + p) || ''; }
function setApiKey(key) { localStorage.setItem('mm_key_' + getProvider(), key.trim()); }

function isApiKeySet() {
  const k = getApiKey(); const p = getProvider();
  if (p === 'openai')  return k && k.startsWith('sk-') && k.length > 20;
  if (p === 'gemini')  return k && k.length > 20;
  return false;
}

// ═══════════════════════════════════════════════
//  OPENAI MODULE
// ═══════════════════════════════════════════════
async function openaiTranscribe(file, language, onProgress) {
  const key = getRawKey('openai');
  if (!key) throw new Error('Chưa có OpenAI API Key');
  const formData = new FormData();
  formData.append('file', file, file.name);
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');
  if (language && language !== 'auto') formData.append('language', language);
  onProgress && onProgress(10, 'Đang gửi file lên Whisper API...');
  const res = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}` },
    body: formData,
  });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e?.error?.message || `Whisper lỗi: ${res.status}`); }
  onProgress && onProgress(55, 'Transcription xong, đang phân tích...');
  const data = await res.json();
  return { text: data.text, language: data.language, duration: data.duration,
    segments: (data.segments||[]).map(s=>({start:s.start,end:s.end,text:s.text.trim()})), };
}

async function openaiAnalyze(transcript, context, onProgress) {
  const key = getRawKey('openai');
  if (!key) throw new Error('Chưa có OpenAI API Key');
  onProgress && onProgress(65, 'Đang phân tích với GPT-4o...');
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: getAnalysisSystemPrompt() },
                 { role: 'user', content: buildUserPrompt(transcript, context) }],
      temperature: 0.3, response_format: { type: 'json_object' }, max_tokens: 4000,
    }),
  });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e?.error?.message || `GPT-4o lỗi: ${res.status}`); }
  onProgress && onProgress(90, 'Đang xử lý kết quả...');
  const data = await res.json();
  try { return JSON.parse(data.choices[0].message.content); }
  catch { throw new Error('Không parse được kết quả GPT-4o.'); }
}

const GEMINI_UPLOAD_BASE = 'https://generativelanguage.googleapis.com/upload/v1beta';
const GEMINI_MODEL = 'gemini-2.5-flash';
const INLINE_SIZE_LIMIT = 15 * 1024 * 1024; // 15MB threshold

/**
 * Gemini handles BOTH transcription + analysis in ONE call.
 * - File < 15MB  → inline base64 (fast, no extra step)
 * - File ≥ 15MB  → Gemini File API resumable upload (supports up to 2GB)
 */
async function geminiAnalyzeAudio(file, context, language, onProgress) {
  const key = getRawKey('gemini');
  if (!key) throw new Error('Chưa có Google Gemini API Key');
  const mimeType = getMimeType(file.name);

  const langInstruction = language && language !== 'auto'
    ? `Ngôn ngữ chính trong audio: ${language === 'vi' ? 'Tiếng Việt' : 'English'}.` : '';

  const prompt = `${langInstruction}
Hãy phân tích file audio/video cuộc họp này. Thực hiện đồng thời:
1. Transcribe toàn bộ nội dung (với timestamps MM:SS cho mỗi đoạn)
2. Nhận dạng từng người nói dựa vào giọng nói khác nhau
3. Phân tích và trả về JSON theo schema bên dưới
${context ? `\nNgữ cảnh: ${context}` : ''}
${getAnalysisSystemPrompt()}
Chú ý: Detect người nói dựa vào giọng nói. Dùng "Người A", "Người B"... nếu không nghe rõ tên.`;

  let filePart;

  if (file.size <= INLINE_SIZE_LIMIT) {
    // ── Nhỏ: inline base64 ──
    onProgress && onProgress(10, `Đang đọc file (${formatBytes(file.size)})...`);
    const base64 = await readFileAsBase64(file);
    onProgress && onProgress(30, 'Đang gửi lên Gemini...');
    filePart = { inline_data: { mime_type: mimeType, data: base64 } };
  } else {
    // ── Lớn: dùng Gemini File API ──
    onProgress && onProgress(5, `File lớn (${formatBytes(file.size)}) → dùng Gemini File API...`);
    const fileUri = await geminiUploadFile(file, mimeType, key, (uploadPct) => {
      // Upload progress: 5% → 50%
      const mapped = 5 + Math.round(uploadPct * 0.45);
      onProgress && onProgress(mapped, `Đang upload file... ${uploadPct}%`);
    });
    onProgress && onProgress(55, 'Upload xong! Đang phân tích với Gemini...');
    filePart = { file_data: { mime_type: mimeType, file_uri: fileUri } };
  }

  const res = await fetch(`${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, filePart] }],
      generationConfig: { temperature: 0.3, responseMimeType: 'application/json', maxOutputTokens: 8192 }
    }),
  });

  if (!res.ok) {
    const e = await res.json().catch(()=>({}));
    throw new Error(e?.error?.message || `Gemini API lỗi: ${res.status}`);
  }

  onProgress && onProgress(88, 'Đang xử lý kết quả Gemini...');
  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error('Gemini không trả về kết quả. Thử lại nhé.');

  try {
    const cleaned = content.replace(/^```json\s*|^```\s*|\s*```$/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    throw new Error('Không parse được kết quả từ Gemini. Thử lại nhé.');
  }
}

/**
 * Upload file lên Gemini File API (resumable upload).
 * Hỗ trợ file tới 2GB. Trả về file URI để dùng trong generateContent.
 */
async function geminiUploadFile(file, mimeType, key, onUploadProgress) {
  const displayName = file.name.replace(/[^\w.-]/g, '_');

  // Step 1: Khởi tạo resumable upload session
  const initRes = await fetch(
    `${GEMINI_UPLOAD_BASE}/files?key=${key}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': file.size,
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
    }
  );

  if (!initRes.ok) {
    const e = await initRes.json().catch(()=>({}));
    throw new Error(e?.error?.message || `Không thể khởi tạo upload: ${initRes.status}`);
  }

  const uploadUrl = initRes.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) throw new Error('Gemini không trả về upload URL.');

  // Step 2: Upload file với XHR để track progress
  const fileUri = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);
    xhr.setRequestHeader('Content-Length', file.size);
    xhr.setRequestHeader('X-Goog-Upload-Offset', '0');
    xhr.setRequestHeader('X-Goog-Upload-Command', 'upload, finalize');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        onUploadProgress && onUploadProgress(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const resp = JSON.parse(xhr.responseText);
          const uri = resp?.file?.uri;
          if (!uri) reject(new Error('Không tìm thấy file URI trong response.'));
          else resolve(uri);
        } catch {
          reject(new Error('Không parse được response upload.'));
        }
      } else {
        reject(new Error(`Upload thất bại: HTTP ${xhr.status} – ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => reject(new Error('Lỗi mạng khi upload file.'));
    xhr.send(file);
  });

  // Step 3: Chờ file được xử lý xong (trạng thái ACTIVE)
  let attempts = 0;
  while (attempts < 30) {
    const statusRes = await fetch(`${GEMINI_BASE}/files/${fileUri.split('/').pop()}?key=${key}`);
    if (statusRes.ok) {
      const statusData = await statusRes.json();
      if (statusData?.state === 'ACTIVE') break;
      if (statusData?.state === 'FAILED') throw new Error('Gemini xử lý file thất bại.');
    }
    await new Promise(r => setTimeout(r, 2000));
    attempts++;
  }

  return fileUri;
}

function getMimeType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const map = { mp3:'audio/mpeg', mp4:'video/mp4', m4a:'audio/mp4', wav:'audio/wav',
                webm:'audio/webm', ogg:'audio/ogg', flac:'audio/flac', mkv:'video/x-matroska',
                avi:'video/x-msvideo', mov:'video/quicktime' };
  return map[ext] || 'audio/mpeg';
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function geminiAnalyzeText(transcript, context, onProgress) {
  const key = getRawKey('gemini');
  if (!key) throw new Error('Chưa có Google Gemini API Key');
  onProgress && onProgress(40, 'Đang phân tích với Gemini...');
  const res = await fetch(`${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: getAnalysisSystemPrompt() + '\n\n' + buildUserPrompt(transcript, context) }] }],
      generationConfig: { temperature: 0.3, responseMimeType: 'application/json', maxOutputTokens: 8192 }
    }),
  });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e?.error?.message || `Gemini lỗi: ${res.status}`); }
  onProgress && onProgress(85, 'Đang xử lý kết quả...');
  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error('Gemini không trả về kết quả.');
  try {
    const cleaned = content.replace(/^```json\s*|^```\s*|\s*```$/g, '').trim();
    return JSON.parse(cleaned);
  } catch { throw new Error('Không parse được kết quả Gemini.'); }
}



// ═══════════════════════════════════════════════
//  SHARED PROMPT TEMPLATES
// ═══════════════════════════════════════════════
function getAnalysisSystemPrompt() {
  return `Bạn là AI chuyên phân tích hội thoại/cuộc họp theo phong cách quản trị dự án. Trả về JSON hợp lệ theo schema sau. KHÔNG thêm text ngoài JSON.

Schema:
{
  "meetingTitle": "string",
  "duration": "string",
  "language": "string",
  "speakers": [{
    "id": "string",
    "name": "string",
    "role": "string",
    "segments": [{"start":"MM:SS","end":"MM:SS","text":"string"}],
    "totalTalkTime": "string",
    "keyContributions": ["string"]
  }],
  "topics": [{
    "id": "string",
    "title": "string",
    "description": "string",
    "speakerIds": ["string"],
    "timestamps": [{"start":"string","end":"string","summary":"string"}],
    "keywords": ["string"],
    "priority": "high|medium|low"
  }],
  "pmSummary": {
    "objective": "string",
    "keyDecisions": ["string"],
    "blockers": ["string"],
    "achievements": ["string"],
    "risks": ["string"],
    "nextMeeting": "string",
    "overallSentiment": "positive|neutral|negative",
    "meetingEfficiency": "high|medium|low",
    "notes": "string"
  },
  "actions": [{
    "id": "string",
    "text": "string",
    "type": "agreed|suggested",
    "assignee": "string",
    "deadline": "string hoặc null",
    "priority": "high|medium|low",
    "source": "string hoặc null",
    "reason": "string hoặc null"
  }]
}
Quy tắc: agreed=được cam kết rõ ràng trong audio/transcript. suggested=AI gợi ý thêm dựa trên ngữ cảnh. Ưu tiên tiếng Việt.`;
}

function buildUserPrompt(transcript, context) {
  return `${context ? `Ngữ cảnh: ${context}\n\n` : ''}Transcript:\n\n${transcript}`;
}

// ═══════════════════════════════════════════════
//  DEMO DATA
// ═══════════════════════════════════════════════
function getDemoResult() {
  return {
    meetingTitle: 'Sprint Planning Q1 2026 – Dự án XYZ',
    duration: '15 phút', language: 'Tiếng Việt',
    speakers: [
      { id:'sp1', name:'John', role:'Project Manager',
        segments:[{start:'00:00',end:'00:28',text:'Chào buổi sáng mọi người, hôm nay chúng ta họp về dự án XYZ.'},{start:'01:00',end:'01:55',text:'Đồng ý. John sẽ review code payment vào thứ 4.'},{start:'03:00',end:'03:58',text:'Chúng ta cũng cần discuss về budget. Tom, bạn có thể chuẩn bị báo cáo?'}],
        totalTalkTime:'~3 phút', keyContributions:['Điều phối cuộc họp','Đồng ý review code payment','Yêu cầu báo cáo budget'] },
      { id:'sp2', name:'Mary', role:'Tech Lead',
        segments:[{start:'00:30',end:'00:58',text:'Sprint này cần hoàn thành module payment trước.'},{start:'02:30',end:'02:58',text:'Tôi sẽ review mockup và gửi feedback trước thứ 6.'}],
        totalTalkTime:'~1 phút', keyContributions:['Đề xuất ưu tiên payment','Cam kết review design'] },
      { id:'sp3', name:'Tom', role:'Designer',
        segments:[{start:'02:00',end:'02:28',text:'Về phía design, tôi cần feedback về mockup dashboard.'},{start:'04:00',end:'04:45',text:'OK, tôi sẽ chuẩn bị báo cáo budget vào thứ 5.'}],
        totalTalkTime:'~1.5 phút', keyContributions:['Yêu cầu feedback design','Cam kết báo cáo budget'] },
    ],
    topics: [
      { id:'t1', title:'Module Payment', priority:'high', description:'Ưu tiên hoàn thành payment trong sprint và plan review code.', speakerIds:['sp1','sp2'], timestamps:[{start:'00:30',end:'01:55',summary:'Mary đề xuất ưu tiên, John cam kết review thứ 4'}], keywords:['payment','module','review','sprint'] },
      { id:'t2', title:'Design & UI Dashboard', priority:'medium', description:'Tom cần feedback về mockup, Mary sẽ review và phản hồi.', speakerIds:['sp2','sp3'], timestamps:[{start:'02:00',end:'02:58',summary:'Tom yêu cầu, Mary cam kết gửi feedback thứ 6'}], keywords:['design','mockup','dashboard','feedback'] },
      { id:'t3', title:'Budget & Tài chính', priority:'medium', description:'John yêu cầu Tom chuẩn bị báo cáo budget.', speakerIds:['sp1','sp3'], timestamps:[{start:'03:00',end:'04:45',summary:'John yêu cầu, Tom đồng ý chuẩn bị thứ 5'}], keywords:['budget','báo cáo','tài chính'] },
    ],
    pmSummary: {
      objective:'Sprint planning Q1 2026 – phân công tasks, xác định ưu tiên.',
      keyDecisions:['Module payment là ưu tiên cao nhất','John: code review | Mary: design review','Báo cáo budget cần trong tuần'],
      blockers:['Mockup chưa có feedback','Budget cần thêm dữ liệu'],
      achievements:['Backlog được ưu tiên hóa','Phân công rõ ràng 3 items'],
      risks:['Review trễ ảnh hưởng payment deadline','Budget report quyết định resource'],
      nextMeeting:'Daily standup – cập nhật tiến độ payment và design feedback',
      overallSentiment:'positive', meetingEfficiency:'high',
      notes:'Họp ngắn gọn, tập trung, ra quyết định rõ cho cả 3 chủ đề.',
    },
    actions: [
      { id:'a1', text:'Review code module payment', type:'agreed', assignee:'John', deadline:'Thứ 4', priority:'high', source:'"John sẽ review code payment vào thứ 4"', reason:null },
      { id:'a2', text:'Review mockup dashboard và gửi feedback cho Tom', type:'agreed', assignee:'Mary', deadline:'Thứ 6', priority:'medium', source:'"Tôi sẽ review mockup và gửi feedback trước thứ 6"', reason:null },
      { id:'a3', text:'Chuẩn bị báo cáo budget dự án', type:'agreed', assignee:'Tom', deadline:'Thứ 5', priority:'medium', source:'"Tôi sẽ chuẩn bị báo cáo budget vào thứ 5"', reason:null },
      { id:'a4', text:'Lên risk mitigation plan cho payment nếu review bị trễ', type:'suggested', assignee:'John', deadline:null, priority:'medium', source:null, reason:'Payment là ưu tiên cao nhất nhưng thiếu backup plan.' },
      { id:'a5', text:'Chia sẻ nguồn dữ liệu với Tom trước khi làm báo cáo budget', type:'suggested', assignee:'John', deadline:null, priority:'low', source:null, reason:'Tom cần đủ dữ liệu nhưng nguồn chưa được đề cập.' },
    ],
  };
}

// ═══════════════════════════════════════════════
//  RENDERER
// ═══════════════════════════════════════════════
const SP_COLORS = [
  {color:'#7c5cbf',bg:'rgba(124,92,191,0.15)'},{color:'#38bdf8',bg:'rgba(56,189,248,0.15)'},
  {color:'#22c55e',bg:'rgba(34,197,94,0.15)'},{color:'#f59e0b',bg:'rgba(245,158,11,0.15)'},
  {color:'#f43f5e',bg:'rgba(244,63,94,0.15)'},{color:'#a78bfa',bg:'rgba(167,139,250,0.15)'},
  {color:'#34d399',bg:'rgba(52,211,153,0.15)'},{color:'#fb923c',bg:'rgba(251,146,60,0.15)'},
];
function spColor(i){return SP_COLORS[i%SP_COLORS.length];}
function tsToSec(ts){if(!ts)return 0;const p=ts.split(':').map(Number);if(p.length===3)return p[0]*3600+p[1]*60+p[2];if(p.length===2)return p[0]*60+p[1];return parseFloat(ts)||0;}
function initials(n){return n.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);}
function buildColorMap(speakers){const m={};(speakers||[]).forEach((s,i)=>{m[s.id]=i;});return m;}
function getTotalDuration(speakers){let max=0;(speakers||[]).forEach(sp=>sp.segments.forEach(s=>{const e=tsToSec(s.end);if(e>max)max=e;}));return max||1;}

function renderSpeakers(speakers,container){
  container.innerHTML='';
  if(!speakers||!speakers.length){container.innerHTML='<p style="color:var(--text-muted);text-align:center;padding:24px">Không phát hiện được người nói.</p>';return;}
  const cm=buildColorMap(speakers);const total=getTotalDuration(speakers);
  speakers.forEach(sp=>{
    const {color,bg}=spColor(cm[sp.id]??0);
    const card=document.createElement('div');card.className='speaker-card';
    card.innerHTML=`<div class="speaker-header"><div class="speaker-avatar" style="background:${bg};color:${color};border:1.5px solid ${color}">${initials(sp.name)}</div><div><div class="speaker-name">${sp.name}</div><div class="speaker-stats">${sp.role||''} ${sp.totalTalkTime?'· '+sp.totalTalkTime:''}</div></div></div>`;
    const tl=document.createElement('div');tl.className='speaker-timeline-label';tl.textContent='Timeline:';card.appendChild(tl);
    const track=document.createElement('div');track.className='timeline-track';
    sp.segments.forEach(seg=>{const s=(tsToSec(seg.start)/total)*100;const w=Math.max(((tsToSec(seg.end)-tsToSec(seg.start))/total)*100,1.5);const el=document.createElement('div');el.className='timeline-segment';el.style.cssText=`left:${s}%;width:${w}%;background:${color};`;el.title=`${seg.start}–${seg.end}: ${seg.text}`;track.appendChild(el);});
    card.appendChild(track);
    const chips=document.createElement('div');chips.className='speaker-timestamps';
    sp.segments.forEach(seg=>{const chip=document.createElement('span');chip.className='ts-chip';chip.style.cssText=`color:${color};background:${bg};border-color:${color}40;`;chip.title=seg.text;chip.textContent=`${seg.start} – ${seg.end}`;chips.appendChild(chip);});
    card.appendChild(chips);
    if(sp.keyContributions&&sp.keyContributions.length){const kl=document.createElement('div');kl.className='speaker-timeline-label';kl.style.marginTop='12px';kl.textContent='Đóng góp chính:';card.appendChild(kl);const ul=document.createElement('ul');ul.className='summary-list';ul.style.marginTop='6px';sp.keyContributions.forEach(c=>{const li=document.createElement('li');li.textContent=c;ul.appendChild(li);});card.appendChild(ul);}
    container.appendChild(card);
  });
}

function renderTopics(topics,speakers,container){
  container.innerHTML='';
  if(!topics||!topics.length){container.innerHTML='<p style="color:var(--text-muted);text-align:center;padding:24px">Không phát hiện được chủ đề.</p>';return;}
  const cm=buildColorMap(speakers);const sm={};(speakers||[]).forEach(s=>{sm[s.id]=s;});
  const pl={high:'🔴 Ưu tiên cao',medium:'🟡 Trung bình',low:'🟢 Thấp'};
  topics.forEach(t=>{
    const card=document.createElement('div');card.className='topic-card';
    card.innerHTML=`<div class="topic-header"><div class="topic-title">🏷️ ${t.title}</div><span class="topic-badge">${pl[t.priority]||t.priority}</span></div>`;
    if(t.description){const d=document.createElement('div');d.className='topic-desc';d.textContent=t.description;card.appendChild(d);}
    if(t.speakerIds&&t.speakerIds.length){const row=document.createElement('div');row.innerHTML='<div class="speaker-timeline-label">Người tham gia:</div>';const sc=document.createElement('div');sc.className='topic-speakers';t.speakerIds.forEach(sid=>{const sp=sm[sid];if(!sp)return;const{color,bg}=spColor(cm[sid]??0);const chip=document.createElement('span');chip.className='topic-speaker-chip';chip.style.cssText=`color:${color};background:${bg};border-color:${color}50;`;chip.textContent=sp.name;sc.appendChild(chip);});row.appendChild(sc);card.appendChild(row);}
    if(t.timestamps&&t.timestamps.length){const ts=document.createElement('div');ts.style.marginTop='10px';ts.innerHTML='<div class="speaker-timeline-label">Thời điểm thảo luận:</div>';const tsc=document.createElement('div');tsc.className='topic-timestamps';t.timestamps.forEach(x=>{const c=document.createElement('span');c.className='topic-ts-chip';c.title=x.summary||'';c.textContent=`${x.start} – ${x.end}`;tsc.appendChild(c);});ts.appendChild(tsc);t.timestamps.forEach(x=>{if(x.summary){const s=document.createElement('div');s.style.cssText='font-size:0.75rem;color:var(--text-muted);margin-top:6px;font-style:italic;';s.textContent=`"${x.summary}"`;ts.appendChild(s);}});card.appendChild(ts);}
    if(t.keywords&&t.keywords.length){const kw=document.createElement('div');kw.className='topic-keywords';t.keywords.forEach(k=>{const c=document.createElement('span');c.className='keyword-chip';c.textContent='#'+k;kw.appendChild(c);});card.appendChild(kw);}
    container.appendChild(card);
  });
}

function renderSummary(pm,container){
  container.innerHTML='';
  if(!pm){container.innerHTML='<p style="color:var(--text-muted);text-align:center;padding:24px">Không có tóm tắt.</p>';return;}
  const sl={positive:'😊 Tích cực',neutral:'😐 Trung tính',negative:'😟 Tiêu cực'};
  const el={high:'⚡ Cao',medium:'📊 Trung bình',low:'🐢 Thấp'};
  const meta=document.createElement('div');meta.className='summary-section';
  meta.innerHTML=`<div class="summary-section-title">📊 Tổng quan</div><div class="summary-meta-grid"><div class="summary-meta-item"><div class="summary-meta-label">Không khí</div><div class="summary-meta-value">${sl[pm.overallSentiment]||pm.overallSentiment||'–'}</div></div><div class="summary-meta-item"><div class="summary-meta-label">Hiệu quả họp</div><div class="summary-meta-value">${el[pm.meetingEfficiency]||pm.meetingEfficiency||'–'}</div></div></div>`;
  container.appendChild(meta);
  if(pm.objective){const s=document.createElement('div');s.className='summary-section';s.innerHTML=`<div class="summary-section-title">🎯 Mục tiêu</div><div class="summary-text">${pm.objective}</div>`;container.appendChild(s);}
  if(pm.keyDecisions?.length)container.appendChild(makeListSection('✅ Quyết định đã đưa ra',pm.keyDecisions));
  if(pm.achievements?.length)container.appendChild(makeListSection('🏆 Thành quả đạt được',pm.achievements));
  if(pm.blockers?.length)container.appendChild(makeListSection('🚧 Vấn đề & Trở ngại',pm.blockers));
  if(pm.risks?.length)container.appendChild(makeListSection('⚠️ Rủi ro',pm.risks));
  if(pm.nextMeeting){const s=document.createElement('div');s.className='summary-section';s.innerHTML=`<div class="summary-section-title">📅 Đề xuất họp tiếp theo</div><div class="summary-text">${pm.nextMeeting}</div>`;container.appendChild(s);}
  if(pm.notes){const s=document.createElement('div');s.className='summary-section';s.innerHTML=`<div class="summary-section-title">📝 Ghi chú</div><div class="summary-text">${pm.notes}</div>`;container.appendChild(s);}
}

function makeListSection(title,items){const s=document.createElement('div');s.className='summary-section';const h=document.createElement('div');h.className='summary-section-title';h.textContent=title;s.appendChild(h);const ul=document.createElement('ul');ul.className='summary-list';items.forEach(i=>{const li=document.createElement('li');li.textContent=i;ul.appendChild(li);});s.appendChild(ul);return s;}

function renderActions(actions,container){
  container.innerHTML='';
  if(!actions||!actions.length){container.innerHTML='<p style="color:var(--text-muted);text-align:center;padding:24px">Không tìm thấy hành động.</p>';return;}
  const ag=actions.filter(a=>a.type==='agreed');const sg=actions.filter(a=>a.type==='suggested');
  const pi={high:'🔴',medium:'🟡',low:'🟢'};
  if(ag.length){const s=document.createElement('div');s.className='actions-section';const t=document.createElement('div');t.className='actions-section-title';t.innerHTML='✅ <span>Đã Thống Nhất</span> <span style="font-size:0.75rem;font-weight:400;text-transform:none;letter-spacing:0">(được cam kết trong cuộc họp)</span>';s.appendChild(t);ag.forEach(a=>s.appendChild(makeActionCard(a,pi)));container.appendChild(s);}
  if(sg.length){const s=document.createElement('div');s.className='actions-section';s.style.marginTop='24px';const t=document.createElement('div');t.className='actions-section-title';t.innerHTML='💡 <span>AI Gợi Ý</span> <span style="font-size:0.75rem;font-weight:400;text-transform:none;letter-spacing:0">(chưa được cam kết, AI đề xuất)</span>';s.appendChild(t);sg.forEach(a=>s.appendChild(makeActionCard(a,pi)));container.appendChild(s);}
}

function makeActionCard(a,pi){
  const card=document.createElement('div');card.className=`action-card ${a.type}`;
  const icon=document.createElement('div');icon.className='action-icon';icon.textContent=a.type==='agreed'?'✅':'💡';card.appendChild(icon);
  const body=document.createElement('div');body.className='action-body';
  const text=document.createElement('div');text.className='action-text';text.textContent=`${pi[a.priority]||''} ${a.text}`;body.appendChild(text);
  const meta=document.createElement('div');meta.className='action-meta';
  if(a.assignee){const x=document.createElement('span');x.className='action-assignee';x.textContent=`👤 ${a.assignee}`;meta.appendChild(x);}
  if(a.deadline){const x=document.createElement('span');x.className='action-deadline';x.textContent=`⏰ ${a.deadline}`;meta.appendChild(x);}
  if(a.type==='agreed'&&a.source){const x=document.createElement('span');x.className='action-source';x.textContent=a.source;meta.appendChild(x);}
  if(a.type==='suggested'&&a.reason){const x=document.createElement('span');x.className='action-source';x.style.color='var(--accent-bright)';x.textContent=`💬 ${a.reason}`;meta.appendChild(x);}
  body.appendChild(meta);card.appendChild(body);
  const badge=document.createElement('span');badge.className=`action-badge ${a.type}`;badge.textContent=a.type==='agreed'?'Thống nhất':'Gợi ý';card.appendChild(badge);
  return card;
}

function renderResultMeta(result){
  document.getElementById('resultTitle').textContent=result.meetingTitle||'Phân tích cuộc họp';
  document.getElementById('resultDate').textContent=new Date().toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  document.getElementById('resultDuration').textContent=result.duration||'';
  document.getElementById('resultSpeakers').textContent=`${result.speakers?.length||0} người nói`;
}

// ═══════════════════════════════════════════════
//  MAIN APP STATE
// ═══════════════════════════════════════════════
const appState = {
  currentResult:null, history:[], selectedFile:null,
  voiceTranscript:'', isRecording:false, recognition:null, isDemoMode:false,
};

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

function showToast(msg,type='success'){
  const old=document.getElementById('mm-toast');if(old)old.remove();
  const t=document.createElement('div');t.id='mm-toast';
  t.style.cssText=`position:fixed;bottom:24px;right:24px;z-index:9999;background:${type==='error'?'rgba(239,68,68,0.95)':'rgba(34,197,94,0.95)'};color:#fff;padding:12px 20px;border-radius:10px;font-family:var(--font);font-size:0.85rem;font-weight:500;box-shadow:0 4px 20px rgba(0,0,0,0.4);max-width:360px;word-break:break-word;`;
  t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),5000);
}

function setAnalyzeLoading(on){
  const btn=document.getElementById('analyzeBtn');
  btn.disabled=on;
  document.getElementById('analyzeBtnText').style.display=on?'none':'';
  document.getElementById('analyzeBtnLoader').classList.toggle('hidden',!on);
}

function showLoadingOverlay(show,step='',sub='',pct=0){
  document.getElementById('loadingOverlay').classList.toggle('hidden',!show);
  if(show){document.getElementById('loadingStep').textContent=step;document.getElementById('loadingSubstep').textContent=sub;document.getElementById('loadingFill').style.width=pct+'%';}
}

function checkApiStatus(){
  const badge=document.getElementById('apiStatus');const text=document.getElementById('apiStatusText');
  if(isApiKeySet()&&!appState.isDemoMode){
    const p=getProvider();
    badge.className='api-badge active';
    text.textContent=p==='gemini'?'💎 Gemini Active':'⚡ OpenAI Active';
  } else {
    badge.className='api-badge demo';text.textContent='Demo Mode';
  }
}

// ── Modal / Settings ──
const PROVIDER_HINTS = {
  openai: 'Whisper + GPT-4o · <a href="https://platform.openai.com/api-keys" target="_blank">Lấy key →</a>',
  gemini: 'Gemini 2.0 Flash · Miễn phí tại <a href="https://aistudio.google.com/app/apikey" target="_blank">AI Studio →</a>',
};
const PROVIDER_PLACEHOLDERS = { openai:'sk-...', gemini:'AIza...' };

function setupApiKeyModal(){
  const modal=document.getElementById('apiKeyModal');
  const input=document.getElementById('apiKeyInput');
  const toggle=document.getElementById('toggleApiKey');
  const saveBtn=document.getElementById('saveApiKey');
  const skipBtn=document.getElementById('skipApiKey');
  const hint=document.getElementById('providerHint');

  // Restore saved provider & key
  let currentProvider=getProvider();
  document.querySelectorAll('.provider-tab').forEach(tab=>{
    tab.classList.toggle('active',tab.dataset.provider===currentProvider);
  });
  input.value=getRawKey(currentProvider);
  input.placeholder=PROVIDER_PLACEHOLDERS[currentProvider];
  hint.innerHTML=PROVIDER_HINTS[currentProvider];

  // If key already exists, skip modal
  if(isApiKeySet()) modal.classList.remove('active');

  // Provider switch
  document.querySelectorAll('.provider-tab').forEach(tab=>{
    tab.onclick=()=>{
      document.querySelectorAll('.provider-tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      currentProvider=tab.dataset.provider;
      setProvider(currentProvider);
      input.value=getRawKey(currentProvider);
      input.placeholder=PROVIDER_PLACEHOLDERS[currentProvider];
      hint.innerHTML=PROVIDER_HINTS[currentProvider];
    };
  });

  toggle.onclick=()=>{input.type=input.type==='password'?'text':'password';};

  saveBtn.onclick=()=>{
    const val=input.value.trim();
    if(!val||val.length<10){input.style.borderColor='var(--danger)';setTimeout(()=>{input.style.borderColor='';},1500);return;}
    setProvider(currentProvider);setApiKey(val);
    appState.isDemoMode=false;modal.classList.remove('active');checkApiStatus();
    showToast(`✅ ${currentProvider==='gemini'?'Gemini':'OpenAI'} API Key đã lưu!`);
  };

  skipBtn.onclick=()=>{appState.isDemoMode=true;modal.classList.remove('active');checkApiStatus();};
  document.getElementById('settingsBtn').onclick=()=>modal.classList.add('active');
}

// ── Input Tabs ──
function setupInputTabs(){
  document.querySelectorAll('.input-tab').forEach(tab=>{
    tab.onclick=()=>{
      document.querySelectorAll('.input-tab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.input-mode').forEach(m=>m.classList.remove('active'));
      tab.classList.add('active');
      const el=document.getElementById('mode'+tab.dataset.tab.charAt(0).toUpperCase()+tab.dataset.tab.slice(1));
      if(el)el.classList.add('active');
    };
  });
}

// ── Voice ──
function setupVoiceInput(){
  const voiceBtn=document.getElementById('voiceBtn');
  const voiceStatus=document.getElementById('voiceStatus');
  const waveform=document.getElementById('voiceWaveform');
  const transcriptDiv=document.getElementById('voiceTranscript');
  const langSelect=document.getElementById('voiceLang');
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){voiceBtn.disabled=true;voiceStatus.textContent='Dùng Chrome/Edge để dùng tính năng này.';voiceStatus.style.color='var(--danger)';return;}
  voiceBtn.onclick=()=>{appState.isRecording?stopRec():startRec();};
  function startRec(){
    appState.recognition=new SR();appState.recognition.continuous=true;appState.recognition.interimResults=true;appState.recognition.lang=langSelect.value;
    let final=appState.voiceTranscript||'';
    appState.recognition.onresult=e=>{let interim='';for(let i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal){final+=e.results[i][0].transcript+' ';appState.voiceTranscript=final;}else interim+=e.results[i][0].transcript;}transcriptDiv.textContent=final+interim;};
    appState.recognition.onerror=e=>{showToast('Lỗi voice: '+e.error,'error');stopRec();};
    appState.recognition.onend=()=>{if(appState.isRecording)appState.recognition.start();};
    appState.recognition.start();appState.isRecording=true;voiceBtn.classList.add('recording');voiceBtn.querySelector('.voice-label').textContent='Đang ghi...';voiceStatus.textContent='🔴 Đang ghi âm';voiceStatus.style.color='var(--danger)';waveform.classList.add('active');
  }
  function stopRec(){if(appState.recognition){appState.recognition.onend=null;appState.recognition.stop();appState.recognition=null;}appState.isRecording=false;voiceBtn.classList.remove('recording');voiceBtn.querySelector('.voice-label').textContent='Nhấn để nói';voiceStatus.textContent='Sẵn sàng';voiceStatus.style.color='';waveform.classList.remove('active');}
}

// ── File Upload ──
function setupFileUpload(){
  const dropZone=document.getElementById('fileDropZone');
  const fileInput=document.getElementById('fileInput');
  const browseBtn=document.getElementById('browseFileBtn');
  const fileInfo=document.getElementById('fileInfo');
  const removeBtn=document.getElementById('removeFile');
  browseBtn.onclick=e=>{e.stopPropagation();fileInput.click();};
  dropZone.onclick=e=>{if(e.target!==browseBtn)fileInput.click();};
  dropZone.ondragover=e=>{e.preventDefault();dropZone.classList.add('drag-over');};
  dropZone.ondragleave=()=>dropZone.classList.remove('drag-over');
  dropZone.ondrop=e=>{e.preventDefault();dropZone.classList.remove('drag-over');if(e.dataTransfer.files[0])setFile(e.dataTransfer.files[0]);};
  fileInput.onchange=()=>{if(fileInput.files[0])setFile(fileInput.files[0]);};
  removeBtn.onclick=()=>{appState.selectedFile=null;fileInput.value='';fileInfo.classList.add('hidden');dropZone.style.display='';};
  function setFile(f){appState.selectedFile=f;document.getElementById('fileName').textContent=f.name;document.getElementById('fileSize').textContent=formatBytes(f.size);fileInfo.classList.remove('hidden');dropZone.style.display='none';}
}

function formatBytes(b){if(b<1024)return b+' B';if(b<1048576)return(b/1024).toFixed(1)+' KB';return(b/1048576).toFixed(1)+' MB';}

// ── Result Tabs ──
function setupResultTabs(){
  document.querySelectorAll('.result-tab').forEach(tab=>{
    tab.onclick=()=>{
      document.querySelectorAll('.result-tab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.result-content').forEach(p=>p.classList.remove('active'));
      tab.classList.add('active');
      const el=document.getElementById('panel'+tab.dataset.panel.charAt(0).toUpperCase()+tab.dataset.panel.slice(1));
      if(el)el.classList.add('active');
    };
  });
}

// ── ANALYZE (main logic) ──
function setupAnalyzeBtn(){document.getElementById('analyzeBtn').onclick=handleAnalyze;}

async function handleAnalyze(){
  const activeTab=document.querySelector('.input-tab.active')?.dataset?.tab;
  let transcript='';
  try{
    if(activeTab==='text'){
      transcript=document.getElementById('textInput').value.trim();
      if(!transcript){showToast('Vui lòng nhập transcript.','error');return;}
    }else if(activeTab==='voice'){
      transcript=document.getElementById('voiceTranscript').textContent.trim();
      if(!transcript||transcript==='Transcript sẽ xuất hiện ở đây...'){showToast('Vui lòng ghi âm trước.','error');return;}
    }else if(activeTab==='file'){
      if(!appState.selectedFile){showToast('Vui lòng chọn file.','error');return;}
    }

    const context=document.getElementById('contextInput').value.trim();
    setAnalyzeLoading(true);showLoadingOverlay(true,'Đang chuẩn bị...','',5);

    if(appState.isDemoMode||!isApiKeySet()){await simulateDemoAnalysis();return;}

    const provider=getProvider();
    let result;

    if(activeTab==='file'&&appState.selectedFile){
      const ext=appState.selectedFile.name.split('.').pop().toLowerCase();
      if(['txt','srt','md'].includes(ext)){
        showLoadingOverlay(true,'Đọc file văn bản...','',30);
        transcript=await readFileAsText(appState.selectedFile);
        if(ext==='srt')transcript=parseSRT(transcript);
        // Analyze as text
        if(provider==='gemini'){
          result=await geminiAnalyzeText(transcript,context,showLoadingOverlay.bind(null,true));
        }else{
          result=await openaiAnalyze(transcript,context,(p,m)=>showLoadingOverlay(true,m,'',p));
        }
      }else{
        // Audio / Video file
        if(provider==='gemini'){
          // Gemini does it all in one shot!
          showLoadingOverlay(true,'Đang gửi audio lên Gemini...','Gemini sẽ transcribe + phân tích cùng lúc',15);
          const lang=document.getElementById('fileLang').value;
          result=await geminiAnalyzeAudio(appState.selectedFile,context,lang,(p,m)=>showLoadingOverlay(true,m,'',p));
        }else{
          // OpenAI: Whisper then GPT-4o
          showLoadingOverlay(true,'Transcribing với Whisper...','Có thể mất vài phút với file dài',10);
          const lang=document.getElementById('fileLang').value;
          const tr=await openaiTranscribe(appState.selectedFile,lang,(p,m)=>showLoadingOverlay(true,m,'',p));
          transcript=tr.segments.length?tr.segments.map(s=>`[${fmt(s.start)} – ${fmt(s.end)}] ${s.text}`).join('\n'):tr.text;
          result=await openaiAnalyze(transcript,context,(p,m)=>showLoadingOverlay(true,m,'',p));
        }
      }
    }else{
      // Text or Voice → analyze
      if(provider==='gemini'){
        result=await geminiAnalyzeText(transcript,context,(p,m)=>showLoadingOverlay(true,m,'',p));
      }else{
        result=await openaiAnalyze(transcript,context,(p,m)=>showLoadingOverlay(true,m,'',p));
      }
    }

    showLoadingOverlay(true,'Hiển thị kết quả...','',95);
    await sleep(300);displayResult(result);
  }catch(err){
    console.error(err);showToast(err.message||'Đã xảy ra lỗi. Vui lòng thử lại.','error');
  }finally{setAnalyzeLoading(false);showLoadingOverlay(false);}
}

async function simulateDemoAnalysis(){
  const steps=[[10,'Đang transcribe audio...','Demo mode'],[40,'Nhận dạng người nói...','Speaker diarization'],[60,'Phân tích chủ đề...','Topic clustering'],[80,'Tạo PM Summary...','AI analysis'],[95,'Trích xuất hành động...','Action extraction']];
  for(const[p,s,sub]of steps){showLoadingOverlay(true,s,sub,p);await sleep(600);}
  displayResult(getDemoResult());
}

function fmt(sec){const m=Math.floor(sec/60).toString().padStart(2,'0');const s=Math.floor(sec%60).toString().padStart(2,'0');return`${m}:${s}`;}

function parseSRT(txt){
  const lines=txt.split('\n');const out=[];let i=0;
  while(i<lines.length){if(/^\d+$/.test(lines[i]?.trim())){const ts=lines[i+1]||'';const m=ts.match(/(\d{2}:\d{2}:\d{2})/);const start=m?m[1].slice(3):'';const texts=[];i+=2;while(i<lines.length&&lines[i].trim()!==''){texts.push(lines[i]);i++;}if(texts.length)out.push(`[${start}] ${texts.join(' ')}`);}i++;}
  return out.join('\n')||txt;
}

function readFileAsText(f){return new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=rej;r.readAsText(f,'utf-8');});}

// ── Display Result ──
function displayResult(result){
  appState.currentResult=result;saveToHistory(result);
  document.getElementById('emptyState').style.display='none';
  document.getElementById('resultsPanel').classList.remove('hidden');
  renderResultMeta(result);
  renderSpeakers(result.speakers||[],document.getElementById('speakersList'));
  renderTopics(result.topics||[],result.speakers||[],document.getElementById('topicsList'));
  renderSummary(result.pmSummary,document.getElementById('summaryContent'));
  renderActions(result.actions||[],document.getElementById('actionsList'));
  document.querySelector('.result-tab[data-panel="speakers"]').click();
}

// ── Demo ──
function setupDemoBtn(){
  document.getElementById('demoBtn').onclick=()=>{
    document.querySelector('.input-tab[data-tab="text"]').click();
    document.getElementById('textInput').value=`[00:00] John: Chào buổi sáng mọi người, hôm nay chúng ta họp về dự án XYZ.
[00:30] Mary: Tôi thấy sprint này cần hoàn thành module payment trước.
[01:00] John: Đồng ý. John sẽ review code payment vào thứ 4.
[02:00] Tom: Về phía design, tôi cần feedback về mockup màn hình dashboard.
[02:30] Mary: Tôi sẽ review mockup và gửi feedback trước thứ 6.
[03:00] John: Chúng ta cũng cần discuss về budget. Tom, bạn có thể chuẩn bị báo cáo?
[04:00] Tom: OK, tôi sẽ chuẩn bị báo cáo budget vào thứ 5.`;
    document.getElementById('contextInput').value='Sprint planning dự án XYZ, Q1 2026';
  };
}

// ── Export ──
function setupExportBtns(){
  document.getElementById('copyResultBtn').onclick=()=>{if(!appState.currentResult)return;navigator.clipboard.writeText(toMarkdown(appState.currentResult)).then(()=>showToast('Đã copy!'));};
  document.getElementById('exportMdBtn').onclick=()=>{if(!appState.currentResult)return;const blob=new Blob([toMarkdown(appState.currentResult)],{type:'text/markdown'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`meetingmind-${Date.now()}.md`;a.click();URL.revokeObjectURL(url);};
  document.getElementById('exportPdfBtn').onclick=()=>window.print();
}

function toMarkdown(r){
  const l=[];
  l.push(`# ${r.meetingTitle||'Biên bản cuộc họp'}`);l.push(`**Ngày:** ${new Date().toLocaleDateString('vi-VN')} | **Thời lượng:** ${r.duration||'–'}`);
  l.push('');l.push('## 👤 Người Tham Dự');(r.speakers||[]).forEach(sp=>{l.push(`### ${sp.name} (${sp.role||'–'})`);(sp.keyContributions||[]).forEach(c=>l.push(`- ${c}`));});
  l.push('');l.push('## 🏷️ Chủ Đề');(r.topics||[]).forEach(t=>{l.push(`### ${t.title}`);l.push(t.description||'');});
  const pm=r.pmSummary||{};l.push('');l.push('## 📋 Tóm Tắt PM');if(pm.objective)l.push(`**Mục tiêu:** ${pm.objective}`);if(pm.keyDecisions?.length){l.push('\n### Quyết định');pm.keyDecisions.forEach(d=>l.push(`- ${d}`));}if(pm.blockers?.length){l.push('\n### Trở ngại');pm.blockers.forEach(b=>l.push(`- ${b}`));}
  l.push('');l.push('## ✅ Hành Động');(r.actions||[]).filter(a=>a.type==='agreed').forEach(a=>l.push(`- [ ] **${a.text}** | 👤 ${a.assignee||'–'} | ⏰ ${a.deadline||'–'}`));l.push('\n### AI Gợi Ý');(r.actions||[]).filter(a=>a.type==='suggested').forEach(a=>l.push(`- [ ] ${a.text}`));
  return l.join('\n');
}

// ── History ──
function saveToHistory(result){
  const item={id:Date.now(),title:result.meetingTitle||'Phân tích cuộc họp',date:new Date().toISOString(),result};
  appState.history.unshift(item);if(appState.history.length>20)appState.history=appState.history.slice(0,20);
  try{localStorage.setItem('mm_history',JSON.stringify(appState.history));}catch{}
  renderHistoryList();
}
function loadHistory(){try{appState.history=JSON.parse(localStorage.getItem('mm_history')||'[]');}catch{appState.history=[];}renderHistoryList();}
function renderHistoryList(){
  const c=document.getElementById('historyList');
  if(!appState.history.length){c.innerHTML='<div class="history-empty">Chưa có phân tích nào</div>';return;}
  c.innerHTML='';
  appState.history.forEach(item=>{const el=document.createElement('div');el.className='history-item';el.innerHTML=`<div class="history-item-icon">📋</div><div class="history-item-title" title="${item.title}">${item.title}</div><div class="history-item-date">${new Date(item.date).toLocaleDateString('vi-VN')}</div>`;el.onclick=()=>displayResult(item.result);c.appendChild(el);});
}

// ── Bootstrap ──
document.addEventListener('DOMContentLoaded',()=>{
  loadHistory();
  setupApiKeyModal();
  setupInputTabs();
  setupVoiceInput();
  setupFileUpload();
  setupResultTabs();
  setupAnalyzeBtn();
  setupDemoBtn();
  setupExportBtns();
  document.getElementById('clearHistoryBtn').onclick=()=>{appState.history=[];try{localStorage.removeItem('mm_history');}catch{}renderHistoryList();};
  checkApiStatus();
});
