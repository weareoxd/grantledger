import { describe, expect, it } from "vitest";

import { href } from "./routes";

describe("a page's URL", () => {
  it("fills in the path's params", () => {
    expect(href({ to: "/" })).toBe("/");
    expect(
      href({
        to: "/organization/$organization_id/ministry/$ministry_id/recipient/$recipient_id",
        params: { organization_id: "2", ministry_id: "16", recipient_id: "42" },
      }),
    ).toBe("/organization/2/ministry/16/recipient/42");
  });

  it("writes the table state as the lists' URLs hold it", () => {
    expect(
      href({
        to: "/organization/$organization_id/award",
        params: { organization_id: "2" },
        search: {
          sort: "-value",
          fy: 2024,
          filters: {
            recipient: { operator: "or", constraints: [{ matchMode: "contains", value: "a,b" }] },
          },
          hide_placeholders: undefined,
        },
      }),
    ).toBe("/organization/2/award?sort=-value&fy=2024&f=recipient:contains:a,b");
  });

  it("needs every param", () => {
    expect(() => href({ to: "/organization/$organization_id", params: {} })).toThrow();
  });
});
