import path from "node:path";
import { profileDir } from "@/lib/crust/saves";
import { readStats } from "@/lib/crust/stats";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return Response.json(await readStats(path.join(profileDir(id), "Stats.bin")));
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 404 });
  }
}
