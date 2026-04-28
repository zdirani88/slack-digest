import { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { DigestData, TimeWindow } from "@/types";

export async function fetchDigest({
  timeWindow,
  router,
}: {
  timeWindow: TimeWindow;
  router: AppRouterInstance;
}): Promise<DigestData> {
  const token = localStorage.getItem("glean_token");
  const backendUrl = localStorage.getItem("glean_backend_url");

  if (!token || !backendUrl) {
    router.replace("/setup");
    throw new Error("Missing Glean setup.");
  }

  const res = await fetch("/api/digest/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-glean-token": token,
      "x-glean-backend": backendUrl,
    },
    body: JSON.stringify({ timeWindow }),
  });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(formatErrorMessage(data.error));
  }

  return data;
}

export function formatErrorMessage(error: unknown) {
  if (typeof error !== "string" || error.trim().length === 0) {
    return "Failed to generate digest.";
  }

  if (error === "fetch failed") {
    return "Could not reach Glean. Check your network connection or backend URL and try again.";
  }

  return error;
}
