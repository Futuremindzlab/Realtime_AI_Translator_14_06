/**
 * Scan & Translate — reads printed/handwritten text in a photo (a sign, a
 * menu, a bus board) and translates it into a target language, in one
 * GPT-4o vision call through the existing /v1/proxy/openai/chat backend
 * route. No backend change needed: that route already forwards `messages`
 * to OpenAI's chat/completions API untouched (see
 * backend/src/handlers/aiProxy.mjs), and `gpt-4o` is already allow-listed
 * there for translation (services/translationProvider.ts).
 */
import { proxyPost } from '@/lib/apiProxy';
import { SUPPORTED_LANGUAGES } from '@/lib/constants';
import { extractJson } from '@/lib/scanResultParsing';

export interface ScanTranslateResult {
  /** Whether any readable text was found in the photo. */
  found: boolean;
  /** The text as it appears in the photo, in its original script. */
  detectedText: string;
  /** Best-guess common English name of that language (e.g. "Kannada"). */
  detectedLanguage: string;
  /** detectedText translated into the requested target language. */
  translatedText: string;
}

function langName(code: string): string {
  const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
  return lang?.name ?? code.toUpperCase();
}

/**
 * @param imageBase64 raw base64 (no `data:` prefix) of a JPEG photo —
 *   already resized/compressed by the caller (see lib/imagePrep.ts).
 * @param targetLanguage an ISO code from SUPPORTED_LANGUAGES, e.g. 'ta'
 */
export async function scanAndTranslate(
  imageBase64: string,
  targetLanguage: string
): Promise<ScanTranslateResult> {
  const tgtName = langName(targetLanguage);

  const systemPrompt =
    `You read printed or handwritten text in photos (signs, boards, posters, menus, labels) and translate it. ` +
    `Look at the photo and find the main piece of text a traveler would want translated — ignore logos, ` +
    `watermarks, and background clutter. If there are several short unrelated labels, pick the most prominent one. ` +
    `Translate it into ${tgtName}, written entirely in ${tgtName}'s correct native script — no transliteration, ` +
    `no romanization, no Latin characters unless ${tgtName} is itself written in the Latin alphabet. ` +
    `Respond with ONLY a single JSON object, no markdown fence, no explanation, in exactly this shape: ` +
    `{"found": boolean, "detected_text": string, "detected_language": string, "translation": string}. ` +
    `"detected_text" is the text exactly as written in the photo, in its original script. "detected_language" ` +
    `is that language's common English name (e.g. "Kannada"). If no readable text is visible anywhere in the ` +
    `photo, respond with {"found": false, "detected_text": "", "detected_language": "", "translation": ""}.`;

  const response = await proxyPost('/v1/proxy/openai/chat', {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Read and translate the text in this photo.' },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        ],
      },
    ],
    temperature: 0.1,
    max_tokens: 600,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Scan API error ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json();
  const raw: string = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!raw) throw new Error('Scan API returned an empty result');

  let parsed: any;
  try {
    parsed = extractJson(raw);
  } catch {
    throw new Error("Couldn't read a clear result from that photo — try again with the text more in frame.");
  }

  return {
    found: Boolean(parsed.found),
    detectedText: typeof parsed.detected_text === 'string' ? parsed.detected_text : '',
    detectedLanguage: typeof parsed.detected_language === 'string' ? parsed.detected_language : '',
    translatedText: typeof parsed.translation === 'string' ? parsed.translation : '',
  };
}
