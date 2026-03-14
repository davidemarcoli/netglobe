import { isIP } from 'net';

const SERVICES = [
  'https://api.ipify.org',
  'https://checkip.amazonaws.com',
  'https://ifconfig.me/ip',
  'https://icanhazip.com',
];

export async function detectPublicIp(): Promise<string | null> {
  for (const url of SERVICES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'NetGlobe/1.0' },
      });
      clearTimeout(timeout);

      if (!res.ok) continue;
      const text = (await res.text()).trim();
      if (isIP(text)) return text;
    } catch {
      continue;
    }
  }
  return null;
}
