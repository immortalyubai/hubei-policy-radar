import { getPolicyItems } from "@/lib/policy-data";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const verification = url.searchParams.get("verification");
  const region = url.searchParams.get("region");
  const query = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 100);

  const items = (await getPolicyItems())
    .filter((item) => !type || type === "all" || item.itemType === type)
    .filter((item) => !verification || verification === "all" || item.verificationStatus === verification)
    .filter((item) => !region || item.regionName.includes(region) || item.cityName?.includes(region))
    .filter((item) => !query || `${item.title} ${item.summary} ${item.publisherName} ${item.topics.join(" ")}`.toLowerCase().includes(query))
    .slice(0, limit);

  return Response.json({ items, count: items.length });
}
