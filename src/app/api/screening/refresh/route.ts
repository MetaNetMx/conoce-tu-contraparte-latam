import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { screeningCacheTags, warmDirectUsLists } from "@/lib/us-screening";

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    for (const tag of screeningCacheTags) revalidateTag(tag, "max");
    const sources = await warmDirectUsLists();
    const globalHealthy = sources.global.every((source) => !("error" in source) && source.status !== "unavailable");
    const healthy = !("error" in sources.ofac) && !("error" in sources.fbi) && globalHealthy;
    return NextResponse.json({
      ok: healthy,
      refreshedAt: new Date().toISOString(),
      sources,
    }, { status: healthy ? 200 : 207 });
  } catch {
    return NextResponse.json(
      { error: "La actualización semanal no pudo completarse." },
      { status: 502 },
    );
  }
}
