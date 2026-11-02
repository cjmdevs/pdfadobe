// open_in_app: "<path>|page=N" from the Rust launcher opens the file at page N.
import { describe, expect, it } from "vitest";
import { splitLaunchPage } from "../../src/app/launchPage";

describe("splitLaunchPage", () => {
  it("splits the page off a launch path", () => {
    expect(splitLaunchPage("\\srv\share\JD\Return.pdf|page=3")).toEqual({
      path: "\\srv\share\JD\Return.pdf",
      page: 3,
    });
  });

  it("leaves plain paths alone", () => {
    expect(splitLaunchPage("C:\a\b.pdf")).toEqual({ path: "C:\a\b.pdf", page: null });
    expect(splitLaunchPage("C:\a\b.pdf|page=0")).toEqual({ path: "C:\a\b.pdf", page: null });
  });
});
