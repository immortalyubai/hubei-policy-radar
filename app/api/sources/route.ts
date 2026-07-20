import { getPolicySources } from "@/lib/policy-data";

export async function GET() {
  const sources = await getPolicySources();
  return Response.json(
    { sources, count: sources.length },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
