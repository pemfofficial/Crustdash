import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { TASKS_FILE } from "@/lib/crust/paths";

export const dynamic = "force-dynamic";

// The task list lives in data/tasks.json, so it survives browser resets until you delete tasks.
const MAX_TASKS = 2000;

export async function GET() {
  try {
    const parsed = JSON.parse(await readFile(TASKS_FILE, "utf8"));
    return Response.json({ tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] });
  } catch {
    return Response.json({ tasks: [] });
  }
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON: { tasks: [...] }" }, { status: 400 });
  }
  const tasks = (body as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks) || tasks.length > MAX_TASKS || !tasks.every((t) => t && typeof t === "object" && typeof t.id === "string" && typeof t.title === "string")) {
    return Response.json({ error: "Each task needs an id and a title." }, { status: 400 });
  }
  await mkdir(path.dirname(TASKS_FILE), { recursive: true });
  const tmp = `${TASKS_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), tasks }, null, 2), "utf8");
  await rename(tmp, TASKS_FILE);
  return Response.json({ ok: true, count: tasks.length });
}
