const CROMA_BASE_URL = "https://api.croma.run";

function getApiKey() {
  const apiKey = process.env.CROMA_API_KEY;
  if (!apiKey) throw new Error("MISSING_CROMA_KEY");
  return apiKey;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function cromaFetch<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const apiKey = getApiKey();
  const response = await fetch(`${CROMA_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Prefer: "wait=10",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok && response.status !== 202) {
    throw new Error(`CROMA_${response.status}`);
  }

  const payload = (await response.json()) as
    | T
    | { data: T | null; job?: { id?: string } | null };
  const wrapped = payload && typeof payload === "object" && "data" in payload;
  if (!wrapped) return payload as T;
  if (payload.data !== null && payload.data !== undefined) return payload.data;

  const jobId = payload.job?.id ?? response.headers.get("x-job-id");
  if (!jobId) throw new Error("CROMA_EMPTY_RESPONSE");

  for (let attempt = 0; attempt < 25; attempt += 1) {
    await sleep(1800);
    const jobResponse = await fetch(`${CROMA_BASE_URL}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!jobResponse.ok) throw new Error(`CROMA_JOB_${jobResponse.status}`);

    const jobPayload = (await jobResponse.json()) as {
      job?: { status?: string };
      data?: T | null;
      error?: unknown;
    };
    if (jobPayload.job?.status === "completed" && jobPayload.data != null) {
      return jobPayload.data;
    }
    if (["failed", "cancelled"].includes(jobPayload.job?.status ?? "")) {
      throw new Error("CROMA_JOB_FAILED");
    }
  }

  throw new Error("CROMA_TIMEOUT");
}
