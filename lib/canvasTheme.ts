/**
 * "Conversation Canvas" palette — the dark, two-speaker visual language chosen
 * from the four design directions reviewed in design-previews/03-conversation-canvas.html
 * (see PR #5). Scoped to the Talk and Phrases tabs for now; History, Dashboard
 * and Settings keep their existing light theme until/unless a follow-up extends
 * this palette to the rest of the app.
 */
export const canvasTheme = {
  bg: '#0f1117',
  bgElevated: '#151824',
  card: 'rgba(255,255,255,0.06)',
  cardBorder: 'rgba(255,255,255,0.1)',
  cardBorderStrong: 'rgba(255,255,255,0.14)',

  text: '#f4f6fb',
  textMuted: '#8b98b8',
  textFaint: '#7b88a8',

  // Person A — violet/purple
  personA: '#a855f7',
  personABg: 'rgba(168,85,247,0.14)',
  personABorder: 'rgba(168,85,247,0.28)',
  personAGradient: ['#7e22ce', '#a855f7'] as const,
  personAHalfGradient: ['#1a1226', '#150f21'] as const,

  // Person B — sky blue
  personB: '#38bdf8',
  personBBg: 'rgba(56,189,248,0.12)',
  personBBorder: 'rgba(56,189,248,0.28)',
  personBGradient: ['#0369a1', '#38bdf8'] as const,
  personBHalfGradient: ['#10233a', '#0d1a2b'] as const,

  // Mic / record state
  recordGradient: ['#ef4444', '#f97316'] as const,
  idleGradient: ['#38bdf8', '#6366f1'] as const,

  danger: '#fca5a5',
  success: '#6ee7b7',
  warning: '#fbbf24',
} as const;
