import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-glean-token");
  const backendUrl = req.headers.get("x-glean-backend");

  if (!token || !backendUrl) {
    return NextResponse.json({ ok: false, skipped: "Missing Glean headers" }, { status: 200 });
  }

  const body = await req.json().catch(() => ({}));
  const activityUrl = `${backendUrl.replace(/\/$/, "")}/rest/api/v1/activity`;

  try {
    const res = await fetch(activityUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        events: [
          {
            type: body.eventName ?? "slack_digest_event",
            timestamp: body.timestamp ?? new Date().toISOString(),
            metadata: body.payload ?? {},
          },
        ],
      }),
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, skipped: `Glean activity ${res.status}` }, { status: 200 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, skipped: "Could not reach Glean activity API" }, { status: 200 });
  }
}
