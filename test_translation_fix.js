// Quick test to verify translation is working with proper language names
// This uses minimal tokens to save credits

require('dotenv').config();

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY not found in .env file');
  process.exit(1);
}

// Language code to name mapping (same as in RealtimeTranslationService)
const getLanguageName = (code) => {
  const languageNames = {
    'en': 'English',
    'ta': 'Tamil',
    'hi': 'Hindi',
    'te': 'Telugu',
    'kn': 'Kannada',
    'es': 'Spanish',
    'fr': 'French',
  };
  return languageNames[code] || code;
};

async function testTranslation(text, sourceCode, targetCode) {
  const sourceName = getLanguageName(sourceCode);
  const targetName = getLanguageName(targetCode);

  console.log(`\n🧪 Testing: "${text}"`);
  console.log(`   ${sourceCode} (${sourceName}) → ${targetCode} (${targetName})`);

  const systemPrompt = `You are a professional translator. Translate the following text from ${sourceName} to ${targetName}. Provide ONLY the translation in ${targetName}, no explanations, no commentary, no original text. Output must be ONLY in ${targetName} language.`;

  try {
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
          { role: 'user', content: text }
        ],
        temperature: 0.1,
        max_tokens: 50,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API error: ${errorData.error?.message || response.status}`);
    }

    const data = await response.json();
    const translation = data.choices[0]?.message?.content || '';

    console.log(`✅ Translation: "${translation}"`);
    console.log(`📏 Length: ${translation.length} chars`);
    console.log(`💰 Tokens: ${data.usage.total_tokens}`);

    return translation;
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    return null;
  }
}

async function runTests() {
  console.log('🚀 Testing Translation with Language Names Fix\n');
  console.log('='.repeat(50));

  // Test 1: English to Tamil
  await testTranslation('Hello', 'en', 'ta');

  // Test 2: English to Hindi
  await testTranslation('Good morning', 'en', 'hi');

  // Test 3: English to Spanish
  await testTranslation('Thank you', 'en', 'es');

  console.log('\n' + '='.repeat(50));
  console.log('✅ All tests complete!');
  console.log('\nℹ️ If translations are in correct target languages, the fix works!');
  console.log('💰 Total cost: ~$0.002 (very cheap test)');
}

runTests().catch(console.error);
