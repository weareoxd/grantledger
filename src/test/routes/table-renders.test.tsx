import { act, screen } from "@testing-library/react";
import { HttpResponse } from "msw/http";
import { beforeEach, expect, it, vi } from "vitest";

import { award, envelope } from "@/test/fixtures";
import { api } from "@/test/msw/api";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/next-router";

// Each cell drawn, counted
const drawn = vi.hoisted(() => ({ cells: 0 }));
vi.mock("@/features/table/cells", async (original) => {
  const cells = await original<typeof import("@/features/table/cells")>();
  return {
    ...cells,
    Cell: (props: Parameters<typeof cells.Cell>[0]) => {
      drawn.cells++;
      return cells.Cell(props);
    },
  };
});

beforeEach(() => {
  server.use(
    api.get("/api/organization/:organization_id/award", () =>
      HttpResponse.json(
        envelope([award(1), award(2)], {
          organization: "Government of Canada",
          footer_totals: { value: 3000 },
        }),
      ),
    ),
  );
});

it("doesn't draw the rows again when the page is, with nothing changed", async () => {
  const { queryClient } = renderApp("/organization/2/award");
  await screen.findByText("RECIPIENT 1");
  const before = drawn.cells;
  // (Cells are counted: the test would pass trivially otherwise)
  expect(before).toBeGreaterThan(0);

  // Fetched again, the same
  await act(() => queryClient.refetchQueries());
  expect(drawn.cells).toBe(before);
});
