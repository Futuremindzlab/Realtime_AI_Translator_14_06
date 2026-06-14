Device Translation (on-device) — Setup
=====================================

Summary
-------
This project includes a best-effort integration point for on-device translation using `@xenova/transformers` (transformers.js). The app will lazy-load the library and any model you prewarm via `translationProvider.initializeDeviceModel(modelId)`.

Install
-------
From the repo root run:

```bash
npm install @xenova/transformers
```

Notes
-----
- Transformers.js is heavy — prefer bundling only the small Marian/Opus-MT models you need.
- Example model IDs: `Helsinki-NLP/opus-mt-en-es`, `Helsinki-NLP/opus-mt-en-fr`, `Helsinki-NLP/opus-mt-hi-en`.
- For mobile production builds consider converting models to ONNX and using `onnxruntime-react-native` for better performance.

How to prewarm
--------------
Call the initializer early (app startup). Example (already added to `app/_layout.tsx`):

```ts
import { translationProvider } from '@/services/translationProvider';

// Preload English→Spanish model
translationProvider.initializeDeviceModel('Helsinki-NLP/opus-mt-en-es')
  .then(ok => console.log('Device model preloaded:', ok))
  .catch(console.warn);
```

How to use
----------
In Settings you can choose the translation provider (OpenAI or Device). When `device` is selected the app will call the on-device translation path and use any preloaded models.

If a model or the library is missing the provider will return a descriptive error and fallback to the cloud provider.

Advanced
--------
- To stream partial results you can implement incremental decode in the model generate loop and call the provided `onChunk()` callback.
- For production mobile performance, convert the model to ONNX and call via `onnxruntime-react-native` or a native bridge.
