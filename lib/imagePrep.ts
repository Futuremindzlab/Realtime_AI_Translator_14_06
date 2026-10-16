import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// OpenAI's vision models don't need more than ~1280px to read printed text,
// and a raw phone-camera photo can be 3000-4000px wide and several MB — the
// backend Lambda proxying this call has a payload ceiling (see
// MAX_AUDIO_BYTES in backend/src/handlers/aiProxy.mjs, same limit applies to
// every route it proxies), so downscaling and compressing client-side keeps
// the request comfortably under that and speeds up upload on mobile data.
const MAX_WIDTH = 1280;
const JPEG_QUALITY = 0.6;

/** Downscales, compresses, and base64-encodes a photo before it's sent to
 *  the scan/translate API. Accepts a local file URI from either the camera
 *  or the photo library. */
export async function prepareImageForScan(uri: string): Promise<{ uri: string; base64: string }> {
  const rendered = await ImageManipulator.manipulate(uri).resize({ width: MAX_WIDTH }).renderAsync();
  const result = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG, base64: true });
  if (!result.base64) throw new Error('Failed to prepare image for scanning');
  return { uri: result.uri, base64: result.base64 };
}
