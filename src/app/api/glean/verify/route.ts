import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-glean-token");
  const backendUrl = req.headers.get("x-glean-backend");

  if (!token || !backendUrl) {
    return NextResponse.json({ error: "Missing headers" }, { status: 400 });
  }

  const searchUrl = `${backendUrl.replace(/\/$/, "")}/rest/api/v1/search`;

  try {
    const res = await fetch(searchUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "test", pageSize: 1 }),
    });

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ error: "Invalid token or unauthorized." }, { status: 401 });
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: `Glean returned ${res.status}. Check your backend URL.` },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not reach Glean. Check the backend URL." }, { status: 502 });
  }
}
