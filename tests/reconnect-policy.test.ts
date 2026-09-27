import { describe, it, expect } from "vitest";
import { getDisconnectAction, DisconnectAction } from "../src/reconnect-policy.js";
import { DisconnectReason } from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";

function makeBoom(statusCode: number): Boom {
  return new Boom("Test error", { statusCode });
}

describe("getDisconnectAction", () => {
  it("reconnects immediately for restartRequired (515)", () => {
    const error = makeBoom(DisconnectReason.restartRequired);
    const result = getDisconnectAction(error);
    expect(result.action).toBe(DisconnectAction.Reconnect);
    expect(result.backoffMs).toBe(0);
  });

  it("reconnects with backoff for connectionClosed (428), connectionLost (408), timedOut", () => {
    const error = makeBoom(DisconnectReason.connectionClosed);
    const result = getDisconnectAction(error, 1);
    expect(result.action).toBe(DisconnectAction.Reconnect);
    expect(result.backoffMs).toBeGreaterThan(0);
    expect(result.backoffMs).toBeLessThanOrEqual(30000);
  });

  it("backs off longer for connectionReplaced (440)", () => {
    const error = makeBoom(DisconnectReason.connectionReplaced);
    const result = getDisconnectAction(error);
    expect(result.action).toBe(DisconnectAction.Reconnect);
    expect(result.backoffMs).toBeGreaterThanOrEqual(60000);
  });

  it("wipes auth and returns Logout for loggedOut (401)", () => {
    const error = makeBoom(DisconnectReason.loggedOut);
    const result = getDisconnectAction(error);
    expect(result.action).toBe(DisconnectAction.WipeAndRepair);
  });

  it("wipes auth and returns Logout for badSession (500)", () => {
    const error = makeBoom(DisconnectReason.badSession);
    const result = getDisconnectAction(error);
    expect(result.action).toBe(DisconnectAction.WipeAndRepair);
  });

  it("defaults to reconnect with backoff for unexpected errors", () => {
    const error = new Error("Socket exploded");
    const result = getDisconnectAction(error, 2);
    expect(result.action).toBe(DisconnectAction.Reconnect);
    expect(result.backoffMs).toBeGreaterThan(0);
  });
});
