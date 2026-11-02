import ZAI from "z-ai-web-dev-sdk";

/**
 * Reuse a single ZAI instance across requests (cached on globalThis
 * so Next.js dev-mode HMR does not create a new instance every time).
 */
export async function getZAI(): Promise<ZAI> {
  const g = globalThis as unknown as {
    __araZaiPromise?: Promise<ZAI>;
  };
  if (!g.__araZaiPromise) {
    g.__araZaiPromise = ZAI.create().catch((err) => {
      // Do not cache failed creations so the next request can retry
      g.__araZaiPromise = undefined;
      throw err;
    });
  }
  return g.__araZaiPromise;
}
