import { summaryHandler } from "@/lib/rest/handlers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const { GET, POST, PUT, PATCH, DELETE } = summaryHandler();
