// Logic behind the fixes from the B8 code review.
import { describe, expect, it } from "vitest";
import { leftRunning, type Running } from "../../src/app/toolSwitch";

describe("leaving a tool", () => {
  const idle: Running = { tool: null, markup: null, mode: "default", stamp: null, flyer: null };

  it("stops nothing while the open tool stays the same", () => {
    const on = { ...idle, tool: "comment", markup: "square" };
    expect(leftRunning(on, on)).toEqual({ markup: false, mode: false });
  });

  it("stops what was already running when the tool changes", () => {
    const was = { ...idle, tool: "comment", markup: "square", mode: "stamp", stamp: {} };
    expect(leftRunning(was, { ...was, tool: null })).toEqual({ markup: true, mode: true });
  });

  it("keeps what the same click started", () => {
    // Redact > Draw box from the top bar: opens Redact and turns the box mode on at once.
    const now = { ...idle, tool: "redact", mode: "redact" };
    expect(leftRunning(idle, now)).toEqual({ markup: false, mode: false });
    // A different markup tool or a newly picked stamp is new too.
    const stampA = {};
    const was = { ...idle, tool: "comment", markup: "square", mode: "stamp", stamp: stampA };
    expect(leftRunning(was, { ...was, tool: "stamp", markup: "circle", stamp: {} })).toEqual({
      markup: false,
      mode: false,
    });
  });
});
