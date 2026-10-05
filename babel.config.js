module.exports = function (api) {
  api.cache(true);
  // Not api.env('production') — that method itself calls api.cache.using()
  // internally, which throws ("Caching has already been configured with
  // .never or .forever()") when combined with the api.cache(true) above.
  const isProduction = process.env.NODE_ENV === 'production' || process.env.BABEL_ENV === 'production';
  return {
    presets: [
      [
        'babel-preset-expo',
        {
          unstable_transformImportMeta: true,
        },
      ],
    ],
    plugins: [
      // services/RealtimeTranslationService.ts and others console.log the
      // actual transcribed/translated text for local debugging — fine in
      // dev, but it has no business shipping to a release build: it's
      // customer speech content, and once native crash reporting is wired
      // up (see lib/sentry.ts) Sentry's console breadcrumbs would start
      // carrying it too. Strips console.log/info/debug from production
      // bundles only; console.error/warn survive so real failures are
      // still visible (e.g. via "Share Diagnostics" in Settings, which
      // reads lib/logger.ts's own buffer, not the console directly, and is
      // unaffected either way).
      isProduction && ['transform-remove-console', { exclude: ['error', 'warn'] }],
    ].filter(Boolean),
  };
};
