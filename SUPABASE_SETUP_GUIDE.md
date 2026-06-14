# 🚀 Supabase Setup Guide for AI Translator

## Step 1: Deploy Edge Functions

### A. Install Supabase CLI
```bash
npm install -g supabase
```

### B. Login to Supabase
```bash
supabase login
```

### C. Link Your Project
```bash
cd "C:\Users\mohan\Realtime_AI_Translator_01_28_v1\Realtime_AI_Translator_01_28_v1"
supabase link --project-ref aantlckqmrrddvjykjwz
```

### D. Set OpenAI API Key in Supabase
```bash
supabase secrets set OPENAI_API_KEY=sk-proj-xxxxxx
```

### E. Deploy Translate Function
```bash
supabase functions deploy translate
```

### F. Test the Function
```bash
curl -X POST https://aantlckqmrrddvjykjwz.supabase.co/functions/v1/translate \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhbnRsY2txbXJyZGR2anlrand6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE2OTcsImV4cCI6MjA4NTM4NzY5N30.h5LYafYEOg03Yj47WCZNqgUhgiWwrGe3Cr5Zhxa27h4" \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello world","sourceLanguage":"en","targetLanguage":"es"}'
```

Expected output:
```json
{"translatedText":"Hola mundo"}
```

---

## Step 2: Set Up Database Tables

### A. Open Supabase SQL Editor
1. Go to https://supabase.com/dashboard/project/aantlckqmrrddvjykjwz
2. Click **SQL Editor** in left sidebar
3. Click **New Query**

### B. Run Setup SQL
Copy all content from `supabase/setup_database.sql` and paste into SQL Editor, then click **RUN**

This will create:
- ✅ `user_settings` table
- ✅ `conversation_history` table
- ✅ `audio-files` storage bucket
- ✅ Row Level Security policies
- ✅ Indexes for performance

### C. Verify Tables
Go to **Table Editor** and you should see:
- `user_settings`
- `conversation_history`

---

## Step 3: Verify Storage Bucket

1. Go to **Storage** in Supabase dashboard
2. You should see `audio-files` bucket
3. Click on it to verify it's created

---

## Step 4: Test Database Connection

### A. Create a Test User
1. Go to **Authentication** → **Users**
2. Click **Add user** → **Create new user**
3. Enter test email and password
4. Click **Create user**

### B. Test in SQL Editor
```sql
-- Check if tables exist
SELECT * FROM user_settings LIMIT 1;
SELECT * FROM conversation_history LIMIT 1;
```

Should return empty results (no errors).

---

## Step 5: Check Function Logs

1. Go to **Edge Functions** in Supabase dashboard
2. Click on `translate` function
3. Click **Logs** tab
4. You should see recent requests and any errors

---

## Common Issues & Solutions

### Issue 1: "Function not found"
**Solution:** Redeploy the function
```bash
supabase functions deploy translate
```

### Issue 2: "OPENAI_API_KEY not set"
**Solution:** Set the secret
```bash
supabase secrets set OPENAI_API_KEY=your-key-here
```

### Issue 3: "Permission denied" on database
**Solution:** Check RLS policies are created
```sql
SELECT * FROM pg_policies WHERE tablename IN ('user_settings', 'conversation_history');
```

### Issue 4: 500 Error from Function
**Solution:** Check function logs in Supabase dashboard → Edge Functions → translate → Logs

---

## Testing Checklist

After setup, test these:

- [ ] Edge function responds (curl test above)
- [ ] Translation returns JSON with `translatedText`
- [ ] Translation length < 300 chars
- [ ] Tables exist in database
- [ ] Storage bucket exists
- [ ] Can create user in Auth
- [ ] App can connect to Supabase

---

## Environment Variables Check

Your `.env` file should have:
```env
EXPO_PUBLIC_SUPABASE_URL=https://aantlckqmrrddvjykjwz.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhbnRsY2txbXJyZGR2anlrand6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE2OTcsImV4cCI6MjA4NTM4NzY5N30.h5LYafYEOg03Yj47WCZNqgUhgiWwrGe3Cr5Zhxa27h4
EXPO_PUBLIC_TRANSLATE_URL=https://aantlckqmrrddvjykjwz.supabase.co/functions/v1/translate
```

---

## Next Steps After Setup

1. Restart your app: `npx expo start --clear`
2. Test translation
3. Check Supabase Function Logs for errors
4. Check app logs for successful translation

---

## Support

If you still get errors, check:
1. Supabase Function Logs (Edge Functions → translate → Logs)
2. App console logs (look for 📊, ✅, ❌ emojis)
3. Share both logs for debugging
