import { listProfiles } from "@/lib/crust/saves";

export async function GET() {
  return Response.json(await listProfiles());
}
