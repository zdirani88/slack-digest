import { NextRequest, NextResponse } from "next/server";
import { enrichDigestItemsViaGleanChat } from "@/lib/glean";
import { DigestItem } from "@/types";

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-glean-token");
  const backendUrl = req.headers.get("x-glean-backend");

  if (!token || !backendUrl) {
    return NextResponse.json({ error: "Missing x-glean-token or x-glean-backend headers" }, { status: 400 });
  }

  if (!isAllowedGleanBackend(backendUrl)) {
    return NextResponse.json({ error: "Unsupported Glean backend URL." }, { status: 400 });
  }

  let items: DigestItem[] = [];
  try {
    const body = await req.json();
    items = Array.isArray(body.items) ? body.items : [];
  } catch {
    return NextResponse.json({ error: "Invalid enrichment request body" }, { status: 400 });
  }

  if (items.length === 0) {
    return NextResponse.json({ items: [] });
  }

  try {
    const enrichments = await enrichDigestItemsViaGleanChat(items.slice(0, 4), token, backendUrl, {
      timeoutMs: 8000,
    });
    return NextResponse.json({
      items: Array.from(enrichments.entries()).map(([id, enrichment]) => ({
        id,
        ...enrichment,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown enrichment error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function isAllowedGleanBackend(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "glean.com" || url.hostname.endsWith(".glean.com"));
  } catch {
    return false;
  }
}
