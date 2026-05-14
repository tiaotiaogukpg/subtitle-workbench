import type { SubtitleLine } from '../types'

export const mockSubtitles: SubtitleLine[] = [
  {
    id: 'sub-001',
    index: 1,
    startMs: 1200,
    endMs: 3400,
    zh: 'Drew。',
    en: 'Drew.',
    confidence: 96,
    status: 'confirmed',
    candidates: ['Drew.', 'Hi, Drew.', 'This is Drew.']
  },
  {
    id: 'sub-002',
    index: 2,
    startMs: 4500,
    endMs: 7200,
    zh: '你还好吗？',
    en: 'Are you OK?',
    confidence: 94,
    status: 'confirmed',
    candidates: ['Are you OK?', 'Are you all right?', 'How are you feeling?']
  },
  {
    id: 'sub-003',
    index: 3,
    startMs: 7100,
    endMs: 11000,
    zh: '如果可以的话，你会永久禁止乐队成员做什么事情？',
    en: "What's one thing you'd permanently ban one of your band members from doing if you could?",
    confidence: 72,
    status: 'lowConfidence',
    candidates: [
      "What's one thing you'd permanently ban one of your band members from doing if you could?",
      'What would you stop your band members from doing forever?',
      'Is there anything forbidden in the band if you could decide?'
    ]
  },
  {
    id: 'sub-004',
    index: 4,
    startMs: 11000,
    endMs: 15300,
    zh: '我不想让这个乐队成员……',
    en: 'I would not want one of the band members to...',
    confidence: 81,
    status: 'manuallyEdited',
    candidates: [
      'I would not want one of the band members to...',
      'I would keep my bandmates from...',
      'The thing I would ban is...'
    ]
  },
  {
    id: 'sub-005',
    index: 5,
    startMs: 15300,
    endMs: 19600,
    zh: '自由是很重要的。',
    en: '',
    confidence: 18,
    status: 'unmatched',
    candidates: ['Freedom matters a lot.', 'Being free is important.', 'It is important to have freedom.']
  }
]
