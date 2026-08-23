import { describe, expect, it, vi } from "vitest";
import { resolveSecret } from "../../src/secrets/resolve.js";

describe("resolveSecret", () => {
    it("returns string secret", async () => {
        expect(await resolveSecret("  abc  ")).toBe("abc");
    });

    it("returns undefined for empty string", async () => {
        expect(await resolveSecret("")).toBeUndefined();
    });

    it("resolves Secrets Store binding", async () => {
        const binding = { get: async () => "from-store" };
        expect(await resolveSecret(binding)).toBe("from-store");
    });

    it("returns undefined when Secrets Store get throws", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const binding = {
            get: async () => {
                throw new Error("Secrets Worker: Failed to fetch secret");
            },
        };
        expect(await resolveSecret(binding)).toBeUndefined();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
