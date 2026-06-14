/*
  # Create Realtime AI Translator Tables

  ## Overview
  Sets up the database schema for the Realtime Modern AI Translator app,
  including conversation history and user settings.

  ## New Tables
  
  ### `conversation_history`
  Stores all translation conversations with audio and text data.
  - `id` (uuid, primary key) - Unique identifier for each conversation
  - `user_id` (uuid, foreign key) - References auth.users
  - `timestamp` (timestamptz) - When the translation occurred
  - `source_language` (text) - Source language code (e.g., 'en', 'es')
  - `target_language` (text) - Target language code
  - `source_text` (text) - Original transcribed text
  - `translated_text` (text) - Translated text
  - `source_audio_url` (text, nullable) - URL to source audio in storage
  - `translated_audio_url` (text, nullable) - URL to translated audio in storage
  - `conversation_mode` (boolean) - Whether conversation mode was active
  - `created_at` (timestamptz) - Record creation timestamp

  ### `user_settings`
  Stores user preferences and API configurations.
  - `user_id` (uuid, primary key) - References auth.users
  - `default_source_language` (text) - User's preferred source language
  - `default_target_language` (text) - User's preferred target language
  - `openai_api_key` (text, nullable) - Encrypted OpenAI API key
  - `inworld_api_key` (text, nullable) - Encrypted Inworld API key
  - `elevenlabs_api_key` (text, nullable) - Encrypted ElevenLabs API key
  - `tts_provider` (text) - Preferred TTS provider ('inworld' or 'elevenlabs')
  - `conversation_mode_default` (boolean) - Default conversation mode setting
  - `updated_at` (timestamptz) - Last update timestamp

  ## Security
  - Enable RLS on all tables
  - Users can only access their own data
  - Policies for SELECT, INSERT, UPDATE, DELETE operations
*/

-- Create conversation_history table
CREATE TABLE IF NOT EXISTS conversation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  timestamp timestamptz DEFAULT now() NOT NULL,
  source_language text NOT NULL,
  target_language text NOT NULL,
  source_text text NOT NULL,
  translated_text text NOT NULL,
  source_audio_url text,
  translated_audio_url text,
  conversation_mode boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS conversation_history_user_id_idx ON conversation_history(user_id);
CREATE INDEX IF NOT EXISTS conversation_history_timestamp_idx ON conversation_history(timestamp DESC);

-- Enable RLS
ALTER TABLE conversation_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies for conversation_history
CREATE POLICY "Users can view own conversation history"
  ON conversation_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own conversation history"
  ON conversation_history FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own conversation history"
  ON conversation_history FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own conversation history"
  ON conversation_history FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create user_settings table
CREATE TABLE IF NOT EXISTS user_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  default_source_language text DEFAULT 'en',
  default_target_language text DEFAULT 'es',
  openai_api_key text,
  inworld_api_key text,
  elevenlabs_api_key text,
  tts_provider text DEFAULT 'inworld',
  conversation_mode_default boolean DEFAULT true,
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_settings
CREATE POLICY "Users can view own settings"
  ON user_settings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings"
  ON user_settings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
  ON user_settings FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own settings"
  ON user_settings FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create storage bucket for audio files
INSERT INTO storage.buckets (id, name, public)
VALUES ('audio-files', 'audio-files', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for audio files
CREATE POLICY "Users can upload own audio files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'audio-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can view own audio files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'audio-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own audio files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'audio-files' AND auth.uid()::text = (storage.foldername(name))[1]);