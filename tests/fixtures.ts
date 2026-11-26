import type { Research, Strategy } from '@/lib/engine/schemas'

export const SOURCES = [
  { title: 'Rival pricing', url: 'https://rival.test/pricing' },
  { title: 'r/jobs thread', url: 'https://reddit.com/r/jobs/comments/xyz' },
]

export const RESEARCH: Research = {
  product: {
    what_it_does: 'Turns real work into verified proof of skill.',
    who_its_for: 'Job seekers in India',
    key_features: ['Skill verification', 'Proof portfolio'],
    pricing: null,
    proof_points: [],
  },
  market: { category: 'Career tech', summary: 'Crowded with job boards.', trends: [{ point: 'Skills-based hiring is rising', source: 'https://rival.test/pricing' }] },
  competitors: [{
    name: 'Rival', url: 'https://rival.test', positioning: 'Job board', pricing: '₹999/mo',
    strengths: ['Big audience'], weaknesses: ['No verification'], source: 'https://rival.test/pricing',
  }],
  audience: {
    pain_points: [
      { point: 'Resumes are ignored', source: 'https://reddit.com/r/jobs/comments/xyz' },
      { point: 'Invented claim', source: 'https://invented.example/page' },
    ],
    language_they_use: ['ghosted after applying'],
    where_they_gather: [{ name: 'r/jobs', platform: 'Reddit', url: 'https://reddit.com/r/jobs', why: 'Active job seekers', source: 'https://reddit.com/r/jobs/comments/xyz' }],
  },
  questions_people_ask: [{ question: 'How do I prove my skills?', source: null }],
  positioning_gaps: ['Nobody verifies skills'],
  unknowns: ['Market size'],
}

export const STRATEGY: Strategy = {
  positioning_statement: 'For job seekers who get ignored, a way to prove skill with real work.',
  tagline: 'Proof, not promises.',
  unique_value: 'Verified evidence of skill.',
  audience: { summary: 'Early-career job seekers', segments: [{ name: 'Graduates', description: 'Recent grads', pains: ['Ignored'], motivations: ['First job'], objections: ['Cost'] }] },
  voice: { tone: ['direct', 'warm'], do: ['Use plain words'], dont: ['Hype'], sample_phrases: ['Show, don\'t tell'] },
  messaging: { core_message: 'Your work is your proof.', pillars: [{ title: 'Evidence', message: 'Real work', proof: 'Verification' }] },
  channels: [{ channel: 'LinkedIn', priority: 'primary', why: 'Where recruiters are', target_metric: 'Profile views' }],
  hero_move: { title: 'Launch proof challenge', description: '30-day challenge', why_now: 'Hiring season' },
  plan: [{ phase: 'Foundation', weeks: 'Weeks 1–4', theme: 'Set up', weekly_goals: [{ week: 1, goal: 'Publish 3 posts' }] }],
  objections: [{ objection: 'Is it free?', response: 'Yes, to start.' }],
}

import type { ContentPlatform, Creative, Distribution, Search } from '@/lib/engine/schemas'

export function contentFor(platform: ContentPlatform['platform']): ContentPlatform {
  return {
    platform,
    cadence: 'Twice a week',
    pieces: [
      { day: 1, time: '09:30', format: 'text post', title: `${platform} one`, hook: 'Hook one', body: 'Your work is your proof.', hashtags: ['#proof'], cta: 'Try it', goal: 'Awareness', visual_idea: null },
      { day: 4, time: '18:00', format: 'text post', title: `${platform} two`, hook: 'Hook two', body: 'Stop getting ghosted.', hashtags: [], cta: 'Sign up', goal: 'Signups', visual_idea: 'A resume in a bin' },
    ],
  }
}

export const SEARCH: Search = {
  keyword_clusters: [{
    theme: 'Proving skills', intent: 'informational',
    keywords: [
      { keyword: 'how to prove skills to employers', volume: '1K–10K/month', difficulty: 'medium', source: 'https://rival.test/pricing' },
      { keyword: 'skills portfolio', volume: null, difficulty: null, source: null },
    ],
  }],
  questions: [{ question: 'How do I prove my skills?', answer_outline: 'Show real work', source: null }],
  articles: [{ title: 'How to prove your skills', target_keyword: 'how to prove skills to employers', outline: ['Intro'], why: 'High intent' }],
  ai_visibility: { current_state: 'AI answers cite job boards', actions: [{ action: 'Publish guides', why: 'Get cited' }] },
  quick_wins: ['Add FAQ schema'],
}

export const DISTRIBUTION: Distribution = {
  targets: [
    { type: 'community', name: 'r/jobs', platform: 'Reddit', url: 'https://reddit.com/r/jobs', audience_size: null, why_fit: 'Job seekers', contact: null, source: 'https://reddit.com/r/jobs/comments/xyz', approach: 'Answer questions', draft_subject: null, draft_message: 'Happy to share what worked for proving skills.' },
    { type: 'creator', name: 'Career coach', platform: 'LinkedIn', url: 'https://linkedin.test/coach', audience_size: '20K', why_fit: 'Coaches grads', contact: 'coach@invented.example', source: 'https://made-up.example/x', approach: 'Comment first', draft_subject: 'Idea for your audience', draft_message: 'Hi [Name], loved your post.' },
  ],
  community_posts: [{ community: 'r/jobs', title: 'What finally got me interviews', body: 'Real work samples.', rules_to_respect: 'No self-promo' }],
}

export const CREATIVE: Creative = {
  palette: [{ name: 'Indigo', hex: '#6C63FF', use: 'Primary' }],
  typography: 'Inter',
  image_style: 'Clean, bright',
  image_prompts: [{ for_content: 'linkedin one', platform: 'linkedin', prompt: 'A clean desk with a portfolio', aspect_ratio: '4:5' }],
}
