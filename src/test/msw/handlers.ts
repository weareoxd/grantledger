import { HttpResponse } from "msw/http";

import { envelope, organizations, session, summary } from "../fixtures";
import { api } from "./api";

/** Default responses; tests override them with `server.use(...)` */
export const handlers = [
  // Signed in
  api.get("/api/auth/get-session", () => HttpResponse.json(session)),
  // Both organizations, with what they publish and how
  api.get("/api/organization", () =>
    HttpResponse.json(
      envelope(organizations, {
        footer_totals: {
          award_count: organizations.reduce(
            (total, { award_count }) => total + (award_count ?? 0),
            0,
          ),
        },
      }),
    ),
  ),
  // The overviews' figures: none
  api.get("/api/organization/:organization_id/summary", () => HttpResponse.json(summary())),
  api.get("/api/organization/:organization_id/ministry/:ministry_id/summary", () =>
    HttpResponse.json(summary({ scope: "ministry" })),
  ),
  api.get(
    "/api/organization/:organization_id/ministry/:ministry_id/program/:program_id/summary",
    () => HttpResponse.json(summary({ scope: "program" })),
  ),
  api.get("/api/organization/:organization_id/recipient/:recipient_id/summary", () =>
    HttpResponse.json(summary({ scope: "recipient", counterpart: "ministry" })),
  ),
];
