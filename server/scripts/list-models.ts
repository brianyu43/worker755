// Prints language model ids and per-million-token prices from the gateway catalogue.
import { createGateway } from 'ai';

try {
  const gw = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY || undefined });
  const res = await gw.getAvailableModels();
  for (const m of res.models) {
    if (m.modelType && m.modelType !== 'language') continue;
    const p = m.pricing;
    const fmt = (v?: string) => (v ? (Number(v) * 1e6).toFixed(2) : '-');
    console.log(`${m.id}\tin=${fmt(p?.input)}\tout=${fmt(p?.output)}\t${m.name}`);
  }
} catch (err) {
  const status = (err as { statusCode?: unknown })?.statusCode;
  console.error(`model catalogue request failed${typeof status === 'number' ? ` (HTTP ${status})` : ''}`);
  process.exit(1);
}
