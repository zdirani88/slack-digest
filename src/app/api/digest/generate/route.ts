import { NextRequest, NextResponse } from "next/server";
import { searchSlack, generateDigestViaGleanChat } from "@/lib/glean";
import { DigestPreferences, TimeWindow } from "@/types";

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-glean-token");
  const backendUrl = req.headers.get("x-glean-backend");

  if (!token || !backendUrl) {
    return NextResponse.json({ error: "Missing x-glean-token or x-glean-backend headers" }, { status: 400 });
  }

  let timeWindow: TimeWindow = "24h";
  let preferences: DigestPreferences = {};
  try {
    const body = await req.json();
    if (["24h", "3d", "7d"].includes(body.timeWindow)) {
      timeWindow = body.timeWindow;
    }
    if (body.preferences && typeof body.preferences === "object") {
      preferences = body.preferences;
    }
  } catch {
    // use default
  }

  try {
    const results = await searchSlack(timeWindow, token, backendUrl, preferences);

    if (results.length === 0) {
      return NextResponse.json({
        groups: [],
        generatedAt: new Date().toISOString(),
        timeWindow,
        totalItems: 0,
        message: "No Slack results found for this time window.",
      });
    }

    const digest = await generateDigestViaGleanChat(results, timeWindow, token, backendUrl);
    return NextResponse.json({
      ...digest,
      debug: {
        slackResults: results.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
