// Test Supabase Translation Function
// Run with: node test_supabase.js

const SUPABASE_URL = 'https://aantlckqmrrddvjykjwz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhbnRsY2txbXJyZGR2anlrand6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE2OTcsImV4cCI6MjA4NTM4NzY5N30.h5LYafYEOg03Yj47WCZNqgUhgiWwrGe3Cr5Zhxa27h4';

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
