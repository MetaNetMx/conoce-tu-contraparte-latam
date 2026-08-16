import { NextResponse } from "next/server";
import { screenDirectUsLists } from "@/lib/us-screening";

export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json()) as { subject?: string; identifyingDetail?: string };
  const subject = body.subject?.trim().slice(0, 180) ?? "";
  const identifyingDetail = body.identifyingDetail?.trim().slice(0, 400) ?? "";
  if (subject.length < 3) {
    return NextResponse.json(
      { error: "Escribe el nombre completo de la persona o empresa." },
      { status: 400 },
    );
  }
  try {
    const result = await screenDirectUsLists(subject, identifyingDetail);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "No fue posible consultar los registros oficiales de Estados Unidos." },
      { status: 502 },
    );
  }
}
