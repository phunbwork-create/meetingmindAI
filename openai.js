/**
 * openai.js — OpenAI API Integration
 * Whisper (transcription) + GPT-4o (analysis)
 */

export const OPENAI_BASE = 'https://api.openai.com/v1';

export function getApiKey() {
  return localStorage.getItem('mm_openai_key') || '';
}

export function setApiKey(key) {
  localStorage.setItem('mm_openai_key', key.trim());
}

export function isApiKeySet() {
  const k = getApiKey();
  return k && k.startsWith('sk-') && k.length > 20;
}

/**
 * Transcribe audio/video file with Whisper API
 * Returns { text, segments: [{start, end, text}] }
 */
export async function transcribeAudio(file, language = 'vi', onProgress) {
  const key = getApiKey();
  if (!key) throw new Error('API key chưa được cài đặt');

  const formData = new FormData();
  formData.append('file', file, file.name);
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');
  if (language && language !== 'auto') {
    formData.append('language', language);
  }

  onProgress && onProgress(10, 'Đang gửi file lên Whisper API...');

  const response = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}` },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Whisper API lỗi: ${response.status}`);
  }

  onProgress && onProgress(60, 'Đã transcribe xong, đang xử lý...');
  const data = await response.json();

  return {
    text: data.text,
    language: data.language,
    duration: data.duration,
    segments: (data.segments || []).map(s => ({
      start: s.start,
      end: s.end,
      text: s.text.trim(),
    })),
  };
}

/**
 * Analyze transcript with GPT-4o
 * Returns structured AnalysisResult
 */
export async function analyzeTranscript(transcript, context = '', onProgress) {
  const key = getApiKey();
  if (!key) throw new Error('API key chưa được cài đặt');

  onProgress && onProgress(65, 'Đang phân tích với GPT-4o...');

  const systemPrompt = `Bạn là một AI chuyên phân tích cuộc hội thoại/cuộc họp theo phong cách quản trị dự án chuyên nghiệp. Hãy phân tích transcript được cung cấp và trả về kết quả dưới dạng JSON hợp lệ CHÍNH XÁC theo schema sau. KHÔNG thêm text ngoài JSON.

Schema JSON:
{
  "meetingTitle": "string - tiêu đề ngắn gọn cho cuộc họp",
  "duration": "string - ước tính thời lượng (VD: 45 phút)",
  "language": "string - ngôn ngữ chính",
  
  "speakers": [
    {
      "id": "string",
      "name": "string - tên người nói (hoặc 'Người A' nếu không rõ)",
      "role": "string - vai trò ước đoán (VD: Trưởng nhóm, Developer...)",
      "segments": [
        { "start": "string - timestamp dạng MM:SS hoặc HH:MM:SS", "end": "string", "text": "string - nội dung nói" }
      ],
      "totalTalkTime": "string - tổng thời gian nói ước tính",
      "keyContributions": ["string"] 
    }
  ],
  
  "topics": [
    {
      "id": "string",
      "title": "string - tên chủ đề",
      "description": "string - mô tả ngắn gọn nội dung thảo luận",
      "speakerIds": ["string - id của speakers tham gia"],
      "timestamps": [{ "start": "string", "end": "string", "summary": "string" }],
      "keywords": ["string"],
      "priority": "high|medium|low"
    }
  ],
  
  "pmSummary": {
    "objective": "string - mục tiêu/mục đích cuộc họp",
    "keyDecisions": ["string - các quyết định đã được đưa ra"],
    "blockers": ["string - các vấn đề, trở ngại được nhắc đến"],
    "achievements": ["string - những gì đã đạt được, thống nhất"],
    "risks": ["string - rủi ro được đề cập"],
    "nextMeeting": "string - đề xuất agenda/thời gian họp tiếp theo nếu có",
    "overallSentiment": "positive|neutral|negative",
    "meetingEfficiency": "high|medium|low",
    "notes": "string - ghi chú quan trọng khác"
  },
  
  "actions": [
    {
      "id": "string",
      "text": "string - mô tả hành động cần thực hiện",
      "type": "agreed|suggested",
      "assignee": "string - người chịu trách nhiệm (hoặc 'Chưa xác định')",
      "deadline": "string - deadline nếu có (hoặc null)",
      "priority": "high|medium|low",
      "source": "string - trích dẫn ngắn từ transcript (nếu type=agreed)",
      "reason": "string - lý do gợi ý (nếu type=suggested)"
    }
  ]
}

Quy tắc:
- type="agreed": actions được nói ra rõ ràng, có người đồng ý/cam kết trong transcript
- type="suggested": actions bạn (AI) gợi ý dựa trên nội dung thảo luận nhưng chưa được cam kết
- Timestamps phải được suy ra từ ngữ cảnh nếu không có sẵn
- Với speakers không rõ tên, dùng "Người A", "Người B"...
- Ưu tiên trả về tiếng Việt cho tất cả các trường nếu transcript là tiếng Việt`;

  const userPrompt = `${context ? `Ngữ cảnh: ${context}\n\n` : ''}Transcript cần phân tích:\n\n${transcript}`;

  const response = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `GPT-4o API lỗi: ${response.status}`);
  }

  onProgress && onProgress(90, 'Đang xử lý kết quả...');
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  try {
    return JSON.parse(content);
  } catch {
    throw new Error('Không thể parse kết quả từ GPT-4o. Vui lòng thử lại.');
  }
}

/**
 * Demo mode: simulate analysis with a sample result
 */
export function getDemoResult() {
  return {
    meetingTitle: 'Sprint Planning Q1 2026 – Dự án XYZ',
    duration: '15 phút',
    language: 'Tiếng Việt',
    speakers: [
      {
        id: 'sp1',
        name: 'John',
        role: 'Project Manager',
        segments: [
          { start: '00:00', end: '00:28', text: 'Chào buổi sáng mọi người, hôm nay chúng ta họp về dự án XYZ.' },
          { start: '01:00', end: '01:55', text: 'Đồng ý. Action: John sẽ review code payment vào thứ 4.' },
          { start: '03:00', end: '03:58', text: 'Chúng ta cũng cần discuss về budget. Tom, bạn có thể chuẩn bị báo cáo?' },
        ],
        totalTalkTime: '~3 phút',
        keyContributions: ['Điều phối cuộc họp', 'Đồng ý review code payment', 'Yêu cầu báo cáo budget'],
      },
      {
        id: 'sp2',
        name: 'Mary',
        role: 'Tech Lead',
        segments: [
          { start: '00:30', end: '00:58', text: 'Tôi thấy sprint này cần hoàn thành module payment trước.' },
          { start: '02:30', end: '02:58', text: 'Tôi sẽ review mockup và gửi feedback trước thứ 6.' },
        ],
        totalTalkTime: '~1 phút',
        keyContributions: ['Đề xuất ưu tiên module payment', 'Cam kết review mockup design'],
      },
      {
        id: 'sp3',
        name: 'Tom',
        role: 'Designer / Finance',
        segments: [
          { start: '02:00', end: '02:28', text: 'Về phía design, tôi cần feedback về mockup màn hình dashboard.' },
          { start: '04:00', end: '04:45', text: 'OK, tôi sẽ chuẩn bị báo cáo budget vào thứ 5.' },
        ],
        totalTalkTime: '~1.5 phút',
        keyContributions: ['Yêu cầu feedback design', 'Cam kết chuẩn bị báo cáo budget'],
      },
    ],
    topics: [
      {
        id: 't1',
        title: 'Module Payment',
        description: 'Thảo luận về việc ưu tiên hoàn thành module payment trong sprint này và plan review code.',
        speakerIds: ['sp1', 'sp2'],
        timestamps: [
          { start: '00:30', end: '01:55', summary: 'Mary đề xuất ưu tiên, John đồng ý và cam kết review' },
        ],
        keywords: ['payment', 'module', 'review', 'sprint', 'code'],
        priority: 'high',
      },
      {
        id: 't2',
        title: 'Design & UI Dashboard',
        description: 'Tom cần feedback về mockup màn hình dashboard, Mary sẽ review và phản hồi.',
        speakerIds: ['sp2', 'sp3'],
        timestamps: [
          { start: '02:00', end: '02:58', summary: 'Tom yêu cầu feedback, Mary cam kết gửi trước thứ 6' },
        ],
        keywords: ['design', 'mockup', 'dashboard', 'feedback', 'UI'],
        priority: 'medium',
      },
      {
        id: 't3',
        title: 'Budget & Tài chính',
        description: 'John yêu cầu Tom chuẩn bị báo cáo budget cho dự án.',
        speakerIds: ['sp1', 'sp3'],
        timestamps: [
          { start: '03:00', end: '04:45', summary: 'John yêu cầu, Tom đồng ý chuẩn bị báo cáo vào thứ 5' },
        ],
        keywords: ['budget', 'báo cáo', 'tài chính', 'chi phí'],
        priority: 'medium',
      },
    ],
    pmSummary: {
      objective: 'Sprint planning cho Q1 2026, phân công tasks và xác định ưu tiên trong sprint hiện tại.',
      keyDecisions: [
        'Module payment được xác định là ưu tiên cao nhất trong sprint này',
        'John phụ trách code review, Mary phụ trách design review',
        'Báo cáo budget được yêu cầu chuẩn bị cho tuần này',
      ],
      blockers: [
        'Mockup dashboard chưa có feedback, có thể ảnh hưởng tiến độ Tom',
        'Budget cần được clarify, Tom chưa có đủ dữ liệu để báo cáo',
      ],
      achievements: [
        'Sprint backlog được rà soát và ưu tiên hóa',
        'Phân công rõ ràng cho 3 items: code review, design review, budget report',
      ],
      risks: [
        'Rủi ro deadline nếu code review kéo dài hơn dự kiến',
        'Budget report cần hoàn thiện trước khi có quyết định về resource',
      ],
      nextMeeting: 'Daily standup tiếp theo — cập nhật tiến độ payment module và design feedback',
      overallSentiment: 'positive',
      meetingEfficiency: 'high',
      notes: 'Cuộc họp ngắn gọn, tập trung, đã ra quyết định rõ ràng cho tất cả 3 chủ đề.',
    },
    actions: [
      {
        id: 'a1',
        text: 'John review code module payment',
        type: 'agreed',
        assignee: 'John',
        deadline: 'Thứ 4',
        priority: 'high',
        source: '"John sẽ review code payment vào thứ 4"',
        reason: null,
      },
      {
        id: 'a2',
        text: 'Mary review mockup dashboard và gửi feedback cho Tom',
        type: 'agreed',
        assignee: 'Mary',
        deadline: 'Thứ 6',
        priority: 'medium',
        source: '"Tôi sẽ review mockup và gửi feedback trước thứ 6"',
        reason: null,
      },
      {
        id: 'a3',
        text: 'Tom chuẩn bị báo cáo budget dự án',
        type: 'agreed',
        assignee: 'Tom',
        deadline: 'Thứ 5',
        priority: 'medium',
        source: '"OK, tôi sẽ chuẩn bị báo cáo budget vào thứ 5"',
        reason: null,
      },
      {
        id: 'a4',
        text: 'Lên kế hoạch risk mitigation cho module payment trong trường hợp review bị trễ',
        type: 'suggested',
        assignee: 'John',
        deadline: null,
        priority: 'medium',
        source: null,
        reason: 'Module payment có priority cao nhưng không có backup plan được nhắc đến nếu review bị trễ deadline.',
      },
      {
        id: 'a5',
        text: 'Chia sẻ tài liệu thiết kế database budget với Tom trước khi Tom làm báo cáo',
        type: 'suggested',
        assignee: 'John',
        deadline: null,
        priority: 'low',
        source: null,
        reason: 'Tom cần đủ dữ liệu để làm báo cáo budget chính xác, nhưng nguồn dữ liệu chưa được đề cập.',
      },
    ],
  };
}
