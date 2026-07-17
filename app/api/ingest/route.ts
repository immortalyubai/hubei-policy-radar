import { getIngestKey, isIngestAuthorized, upsertCandidate, type IngestCandidate } from "@/lib/ingest";

export async function POST(request: Request) {
  if (!getIngestKey()) {
    return Response.json({ error: "ingest is not configured" }, { status: 503 });
  }
  if (!isIngestAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as IngestCandidate | IngestCandidate[];
    const candidates = Array.isArray(payload) ? payload : [payload];
    if (candidates.length === 0 || candidates.length > 100) {
      return Response.json({ error: "batch size must be between 1 and 100" }, { status: 400 });
    }

    const results = [];
    for (const candidate of candidates) {
      results.push(await upsertCandidate(candidate));
    }
    return Response.json({ ok: true, results }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid payload";
    return Response.json({ error: message }, { status: 400 });
  }
}
