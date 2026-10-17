import { extractJson } from '@/lib/scanResultParsing';

describe('extractJson', () => {
  it('parses a bare JSON object', () => {
    const result = extractJson('{"found": true, "detected_text": "ಧನ್ಯವಾದಗಳು"}');
    expect(result).toEqual({ found: true, detected_text: 'ಧನ್ಯವಾದಗಳು' });
  });

  it('strips a ```json code fence', () => {
    const raw = '```json\n{"found": true, "translation": "நன்றி"}\n```';
    expect(extractJson(raw)).toEqual({ found: true, translation: 'நன்றி' });
  });

  it('strips a bare ``` fence with no language tag', () => {
    const raw = '```\n{"found": false}\n```';
    expect(extractJson(raw)).toEqual({ found: false });
  });

  it('pulls the JSON object out of a stray lead-in sentence', () => {
    const raw = 'Here is the result:\n{"found": true, "detected_language": "Kannada"}';
    expect(extractJson(raw)).toEqual({ found: true, detected_language: 'Kannada' });
  });

  it('throws when no JSON object is present', () => {
    expect(() => extractJson('Sorry, I cannot help with that.')).toThrow();
  });

  it('throws on malformed JSON rather than returning a partial object', () => {
    expect(() => extractJson('{"found": true, "detected_text": }')).toThrow();
  });
});
