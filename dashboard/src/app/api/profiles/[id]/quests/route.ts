import { readQuests } from "@/lib/crust/quests";
import type { QuestReport } from "@/lib/crust/questTypes";

export const dynamic = "force-dynamic";

/** Missions in progress in this profile's last save. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return Response.json(await readQuests(id));
  } catch (err) {
    const report: QuestReport = { savedAt: null, quests: [], titles: [], error: String(err) };
    return Response.json(report);
  }
}
