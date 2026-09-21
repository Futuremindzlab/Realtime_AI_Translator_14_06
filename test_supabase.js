// Test Supabase Translation Function (legacy — the app now uses the AWS backend)
// Run with: EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... node test_supabase.js

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY before running');
  process.exit(1);
}

async function testTranslation() {
  console.log('🧪 Testing Supabase Translation Function...\n');

  const testCases = [
    { text: 'Hello world', sourceLanguage: 'en', targetLanguage: 'es' },
    { text: 'Good morning', sourceLanguage: 'en', targetLanguage: 'ta' },
  ];

  for (const testCase of testCases) {
    console.log(`\n📝 Testing: "${testCase.text}" (${testCase.sourceLanguage} → ${testCase.targetLanguage})`);

    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/translate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: testCase.text,
          sourceLanguage: testCase.sourceLanguage,
          targetLanguage: testCase.targetLanguage,
          stream: false,
        }),
      });

      console.log(`Status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Error:', errorText);
        continue;
      }

      const data = await response.json();
      console.log('✅ Result:', data);
      console.log(`   Translation length: ${data.translatedText?.length || 0} chars`);

      if (data.translatedText && data.translatedText.length > 500) {
        console.warn('⚠️  Translation too long! Should be < 200 chars');
      }

    } catch (error) {
      console.error('❌ Request failed:', error.message);
    }
  }

  console.log('\n✅ Test complete!\n');
}

testTranslation();
