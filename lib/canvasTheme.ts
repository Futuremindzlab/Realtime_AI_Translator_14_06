/**
 * "Four-Stop" palette — the light, gradient-accented visual language approved
 * from the UI-direction comparison (two mockups: a vibrant full-gradient
 * background vs. this one, a warm neutral base with the brand gradient
 * reserved for signature moments — mic button, logo mark, accent icons).
 * Replaces the earlier dark "Conversation Canvas" palette app-wide: this
 * app has one shared theme now, not a per-tab split.
 *
 * The gradient itself (gold → orange → hot pink → magenta → purple) is the
 * same one baked into assets/images/icon.svg — these tokens exist so the
 * in-app UI reads as the same brand as the app icon, which it didn't before.
 */
export const canvasTheme = {
  bg: '#FFFCF8',
  bgElevated: '#FFFFFF',
  card: '#FFFFFF',
  cardBorder: 'rgba(33,26,43,0.08)',
  cardBorderStrong: 'rgba(33,26,43,0.14)',

  text: '#211A2B',
  textMuted: '#8A8296',
  textFaint: '#B9B2C4',

  // Person A — warm pink/rose (first stop of the brand gradient's back half)
  personA: '#FF2E63',
  personABg: 'rgba(255,46,99,0.1)',
  personABorder: 'rgba(255,46,99,0.28)',
  personAGradient: ['#FF7A00', '#FF2E63'] as const,
  personAHalfGradient: ['#FFF4EA', '#FFE9EF'] as const,

  // Person B — deep purple (far stop of the brand gradient)
  personB: '#8A2BE2',
  personBBg: 'rgba(138,43,226,0.1)',
  personBBorder: 'rgba(138,43,226,0.28)',
  personBGradient: ['#E619B0', '#8A2BE2'] as const,
  personBHalfGradient: ['#F6ECFC', '#F1E5FA'] as const,

  // Mic / record state — idle shows the full brand gradient (the one
  // signature "loud" moment in an otherwise quiet UI); recording switches to
  // a clear, unambiguous red so Stop never reads as just another accent.
  idleGradient: ['#FF7A00', '#FF2E63', '#8A2BE2'] as const,
  recordGradient: ['#FB7185', '#E11D48'] as const,

  // Full 5-stop brand gradient — assets/images/icon.svg's own stops, for
  // anywhere that wants the complete gradient rather than the 2-3 stop
  // excerpts above (e.g. a hero banner or the welcome screen).
  brandGradient: ['#FFC700', '#FF7A00', '#FF2E63', '#E619B0', '#8A2BE2'] as const,

  danger: '#E11D48',
  success: '#15803D',
  warning: '#B45309',
} as const;
