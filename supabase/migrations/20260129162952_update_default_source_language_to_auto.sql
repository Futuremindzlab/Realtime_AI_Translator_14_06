/*
  # Update Default Source Language to Autodetect

  1. Changes
    - Update default_source_language default value from 'en' to 'auto'
    - Update existing user settings to use 'auto' if they're using 'en'
  
  2. Purpose
    - Enable automatic language detection as the default behavior
    - Provide better user experience by detecting the spoken language automatically
*/

-- Update the default value for new users
ALTER TABLE user_settings 
ALTER COLUMN default_source_language SET DEFAULT 'auto';

-- Update existing users who have 'en' to use 'auto'
UPDATE user_settings 
SET default_source_language = 'auto' 
WHERE default_source_language = 'en';
