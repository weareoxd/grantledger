import { describe, expect, it } from "vitest";

import { pageKind } from "./scope";

describe("a page's kind, from its path", () => {
  it.each([
    ["/", "organizations"],
    ["/organization/12", "organization"],
    ["/organization/12/award", "awards"],
    ["/organization/12/ministry", "ministries"],
    ["/organization/12/recipient", "recipients"],
    ["/organization/12/ministry/3", "ministry"],
    ["/organization/12/ministry/3/award", "awards"],
    ["/organization/12/ministry/3/program", "programs"],
    ["/organization/12/ministry/3/recipient", "recipients"],
    // A ministry's or program's recipient shows that recipient's awards there
    ["/organization/12/ministry/3/recipient/9", "awards"],
    ["/organization/12/ministry/3/program/4", "program"],
    ["/organization/12/ministry/3/program/4/award", "awards"],
    ["/organization/12/ministry/3/program/4/recipient", "recipients"],
    ["/organization/12/ministry/3/program/4/recipient/9", "awards"],
    ["/organization/12/recipient/9", "recipient"],
    ["/organization/12/recipient/9/awards", "awards"],
    ["/organization/12/recipient/9/ministries", "ministries"],
    ["/organization/12/ministry/3/", "ministry"],
    ["/worker", "worker"],
    ["/admin/users", "admin"],
    ["/sign-in", "other"],
    ["/organization/12/elsewhere", "other"],
  ])("%s is %s", (path, kind) => {
    expect(pageKind(path)).toBe(kind);
  });
});
