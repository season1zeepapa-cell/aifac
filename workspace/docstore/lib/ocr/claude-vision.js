// Claude Vision OCR 플러그인
module.exports = {
  id: 'claude-vision',
  name: 'Claude Vision',
  provider: 'anthropic',
  envKey: 'ANTHROPIC_API_KEY',
  free: false,
  bestFor: ['general', 'quiz', 'complex'],
  description: '문맥 분석 최강, 토큰 과금',

  isAvailable() {
    return !!(process.env.ANTHROPIC_API_KEY || '').trim();
  },

  async execute(base64, mediaType, prompt) {
    const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
    const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: prompt },
        ],
      }],
    });
    return response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  },
};
