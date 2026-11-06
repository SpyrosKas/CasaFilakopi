import { describe, expect, it } from "vitest";
import { parsePublicEnv } from "@/lib/env";

const valid = {
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "key",
};

describe("parsePublicEnv", () => {
  it("accepts a complete environment", () => {
    expect(parsePublicEnv(valid)).toEqual(valid);
  });

  it("rejects a missing key", () => {
    expect(() =>
      parsePublicEnv({
        ...valid,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
      }),
    ).toThrow();
  });

  it("rejects an invalid URL", () => {
    expect(() =>
      parsePublicEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "nope" }),
    ).toThrow();
  });
});
