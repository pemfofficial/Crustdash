import { readLiveSeries } from "@/lib/crust/liveSeries";

// Always read the latest session log; never prerender or cache
export const dynamic = "force-dynamic";

/** GET /api/live/series?names=TitanPlate,Steel — session credits plus prices for the named resources. */
export async function GET(request: Request) {
  const names = (new URL(request.url).searchParams.get("names") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return Response.json(await readLiveSeries(360, names), { headers: { "Cache-Control": "no-store" } });
}
