import { stat } from "node:fs/promises";
import { newestSessionFile } from "@/lib/crust/live";
import { DATA_DIR, LIVE_DIR } from "@/lib/crust/paths";

export const dynamic = "force-dynamic";

/**
 * For the launcher and tray icon: proves this is CrustDash serving a given data folder (not another program on the
 * port), and how long ago the game's mod last wrote live data.
 */
export async function GET() {
  let liveAgeSeconds: number | null = null;
  const file = await newestSessionFile();
  if (file) {
    try {
      liveAgeSeconds = Math.round((Date.now() - (await stat(file)).mtimeMs) / 1000);
    } catch {
      // the file was rotated between listing and reading
    }
  }
  return Response.json({ app: "CrustDash", dataDir: DATA_DIR, liveDir: LIVE_DIR, liveAgeSeconds });
}
