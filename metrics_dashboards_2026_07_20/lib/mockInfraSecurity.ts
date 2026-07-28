export const apiKeys = [
  { provider: "OpenAI", label: "Production key", plan: "Pay-as-you-go", renewsOrChecked: "Auto-renew", status: "active" },
  { provider: "ElevenLabs", label: "Production key", plan: "Creator", renewsOrChecked: "Renews in 12 days", status: "active" },
  { provider: "Azure Speech", label: "Central India key", plan: "Pay-as-you-go", renewsOrChecked: "Quota 85% used", status: "warning" },
  { provider: "Razorpay", label: "Live key", plan: "Standard", renewsOrChecked: "N/A", status: "active" },
];

export const awsResources = [
  { service: "Lambda", metric: "1.2M invocations", costUsd: 4.12 },
  { service: "API Gateway", metric: "1.4M requests", costUsd: 4.9 },
  { service: "DynamoDB", metric: "2.1M WCU / 6.4M RCU", costUsd: 4.25 },
  { service: "Cognito", metric: "8,430 MAU", costUsd: 0 },
  { service: "CloudWatch Logs", metric: "3.1 GB stored", costUsd: 0.09 },
];

export const sslCertificates = [
  { domain: "app.example.com", issuer: "Let's Encrypt", expiresIn: "72 days", status: "ok" },
  { domain: "api.example.com", issuer: "Amazon", expiresIn: "9 days", status: "warning" },
  { domain: "admin.example.com", issuer: "Let's Encrypt", expiresIn: "-2 days", status: "critical" },
];

export const rateLimits = [
  { endpoint: "/v1/proxy/openai/chat", limit: "500 req/min", current: 210, pct: 42 },
  { endpoint: "/v1/proxy/openai/transcribe", limit: "120 req/min", current: 96, pct: 80 },
  { endpoint: "/v1/proxy/elevenlabs/tts", limit: "100 req/min", current: 88, pct: 88 },
  { endpoint: "/v1/translations", limit: "1000 req/min", current: 140, pct: 14 },
];

export const cveTracking = [
  { package: "next", version: "14.2.3", cve: "CVE-2026-11291", severity: "medium", status: "patched" },
  { package: "axios", version: "1.6.2", cve: "CVE-2026-08820", severity: "high", status: "pending" },
  { package: "expo-av", version: "15.1.4", cve: "CVE-2025-44012", severity: "low", status: "ignored" },
  { package: "amazon-cognito-identity-js", version: "6.3.16", cve: "CVE-2026-01187", severity: "medium", status: "pending" },
];
