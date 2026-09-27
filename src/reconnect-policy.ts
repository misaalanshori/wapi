import { DisconnectReason } from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";

export enum DisconnectAction {
  Reconnect = "reconnect",
  WipeAndRepair = "wipe_and_repair",
}

export interface DisconnectDecision {
  action: DisconnectAction;
  backoffMs: number;
}

export function getDisconnectAction(
  error: Error | Boom | undefined,
  retryCount: number = 0
): DisconnectDecision {
  const statusCode = (error as Boom)?.output?.statusCode;

  if (statusCode === DisconnectReason.restartRequired) {
    return {
      action: DisconnectAction.Reconnect,
      backoffMs: 0,
    };
  }

  if (statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.badSession) {
    return {
      action: DisconnectAction.WipeAndRepair,
      backoffMs: 0,
    };
  }

  if (statusCode === DisconnectReason.connectionReplaced) {
    return {
      action: DisconnectAction.Reconnect,
      backoffMs: 60_000,
    };
  }

  // connectionClosed (428), timedOut (408), connectionLost, or other transient
  // Exponential backoff capped at 30s with jitter
  const base = Math.min(1000 * Math.pow(2, Math.min(retryCount, 5)), 30_000);
  const jitter = Math.floor(Math.random() * 1000);
  const backoffMs = Math.min(base + jitter, 30_000);

  return {
    action: DisconnectAction.Reconnect,
    backoffMs,
  };
}
