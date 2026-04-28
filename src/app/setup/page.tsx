"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ExternalLink } from "lucide-react";

export default function SetupPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [backendUrl, setBackendUrl] = useState(process.env.NEXT_PUBLIC_GLEAN_BACKEND_URL ?? "https://scio-prod-be.glean.com");
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setTesting(true);

    try {
      const res = await fetch("/api/glean/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-glean-token": token.trim(),
          "x-glean-backend": backendUrl.trim(),
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Connection failed (${res.status}). Check your token and URL.`);
        return;
      }

      localStorage.setItem("glean_token", token.trim());
      localStorage.setItem("glean_backend_url", backendUrl.trim());
      router.push("/digest");
    } catch {
      setError("Network error. Make sure the backend URL is correct.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-3 text-4xl">⚡</div>
          <h1 className="text-2xl font-semibold text-gray-900">Slack Digest</h1>
          <p className="mt-1 text-sm text-gray-500">Connect your Glean account to get started</p>
        </div>

        <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Glean API Token
              </label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste your Glean API token"
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              <p className="mt-1.5 text-xs text-gray-400">
                In Glean: Settings → Your profile → API tokens → Create token
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Glean Backend URL
              </label>
              <input
                type="url"
                value={backendUrl}
                onChange={(e) => setBackendUrl(e.target.value)}
                placeholder="https://your-instance-be.glean.com"
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={testing || !token || !backendUrl}
              className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {testing ? "Verifying…" : "Connect to Glean"}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">
          Need help?{" "}
          <a
            href="https://support.glean.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-blue-500 hover:underline"
          >
            Glean support <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </div>
    </div>
  );
}
