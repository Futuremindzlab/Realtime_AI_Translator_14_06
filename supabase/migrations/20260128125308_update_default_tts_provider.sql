/*
  # Update Default TTS Provider to OpenAI

  1. Changes
    - Change default TTS provider from 'inworld' to 'openai'
    - Update existing user settings that have 'inworld' as TTS provider to 'openai'
  
  2. Reason
    - Inworld AI is not a TTS provider, causing fallback errors
    - OpenAI TTS is reliable and works with existing API keys
    - Users without Inworld API keys experience automatic fallback to OpenAI
  
  3. Impact
    - All new users will default to OpenAI TTS
    - Existing users with 'inworld' TTS will be switched to 'openai'
    - Users who explicitly set ElevenLabs will remain unchanged
*/

-- Update the default value for new records
ALTER TABLE user_settings 
  ALTER COLUMN tts_provider SET DEFAULT 'openai';

-- Update existing records that have 'inworld' as TTS provider
UPDATE user_settings 
SET tts_provider = 'openai' 
WHERE tts_provider = 'inworld';
