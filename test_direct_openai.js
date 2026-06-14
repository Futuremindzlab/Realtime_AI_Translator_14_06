// Quick test to verify direct OpenAI translation works
// This uses very few tokens and won't waste credits
// Run with: node test_direct_openai.js

const OPENAI_API_KEY = 'sk-proj-xxxxxxxx;

async function testDirectTranslation() {
  console.log('🧪 Testing Direct OpenAI Translation (saves credits!)\n');

  const test = {
    text: 'Hello',
    sourceLanguage: 'en',
    targetLanguage: 'ta'
  };

  console.log(`📝 Translating: "${test.text}" (${test.sourceLanguage} → ${test.targetLanguage})`);

  try {
    const systemPrompt = `You are a professional translator. Translate the following text from ${test.sourceLanguage} to ${test.targetLanguage}. Provide ONLY the translation, no explanations.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: test.text }
        ],
        temperature: 0.1,
        max_tokens: 50, // Very small to save credits
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ OpenAI Error:', errorData);
      return;
    }

    const data = await response.json();
    const translation = data.choices[0]?.message?.content || '';

    console.log('✅ Translation:', translation);
    console.log('📏 Length:', translation.length, 'chars');
    console.log('💰 Tokens used:', data.usage.total_tokens);
    console.log('\n✅ Direct OpenAI translation works!\n');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testDirectTranslation();
