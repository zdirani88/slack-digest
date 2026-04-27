"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("glean_token");
    const backendUrl = localStorage.getItem("glean_backend_url");
    if (token && backendUrl) {
      router.replace("/digest");
    } else {
      router.replace("/setup");
    }
  }, [router]);

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
    </div>
  );
}
