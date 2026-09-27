import { describe, it, expect, vi, beforeEach } from "vitest";
import { WhatsAppLink } from "../src/whatsapp-link.js";
import { EchoTracker } from "../src/echo-tracker.js";
import { EventEmitter } from "events";
import pino from "pino";

describe("WhatsAppLink message handling", () => {
  let echoTracker: EchoTracker;
  let mockSocket: any;
  let events: EventEmitter;
  let receivedMessages: any[];

  beforeEach(() => {
    echoTracker = new EchoTracker(60_000);
    events = new EventEmitter();
    receivedMessages = [];

    mockSocket = {
      ev: events,
      user: { id: "1234567890:1@s.whatsapp.net" },
      sendMessage: vi.fn().mockResolvedValue({}),
      sendPresenceUpdate: vi.fn().mockResolvedValue({}),
    };
  });

  it("drops outbound echoed messages tracked in EchoTracker", async () => {
    const link = new WhatsAppLink({
      authDir: "./test-auth",
      echoTracker,
      logger: pino({ level: "silent" }),
      onMessage: async (msg) => {
        receivedMessages.push(msg);
      },
    });

    link.attachSocketEvents(mockSocket);

    // Track a message ID
    echoTracker.track("sent-by-me-123");

    // Simulate incoming upsert with echoed message
    events.emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: {
            remoteJid: "chat-1@s.whatsapp.net",
            id: "sent-by-me-123",
            fromMe: true,
          },
          message: {
            conversation: "Hello",
          },
        },
      ],
    });

    expect(receivedMessages).toHaveLength(0);
  });

  it("forwards legitimate non-echo messages to onMessage callback", async () => {
    const link = new WhatsAppLink({
      authDir: "./test-auth",
      echoTracker,
      logger: pino({ level: "silent" }),
      onMessage: async (msg) => {
        receivedMessages.push(msg);
      },
    });

    link.attachSocketEvents(mockSocket);

    events.emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: {
            remoteJid: "chat-1@s.whatsapp.net",
            id: "other-msg-456",
            fromMe: false,
          },
          message: {
            conversation: "Hello from someone else",
          },
        },
      ],
    });

    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0].text).toBe("Hello from someone else");
    expect(receivedMessages[0].chatJid).toBe("chat-1@s.whatsapp.net");
  });

  it("sends message with tracked message ID so it won't echo back", async () => {
    const link = new WhatsAppLink({
      authDir: "./test-auth",
      echoTracker,
      logger: pino({ level: "silent" }),
      onMessage: vi.fn(),
    });

    link.attachSocketEvents(mockSocket);

    const sentId = await link.sendMessage("chat-1@s.whatsapp.net", "Assistant reply");

    expect(mockSocket.sendMessage).toHaveBeenCalledWith(
      "chat-1@s.whatsapp.net",
      { text: "Assistant reply" },
      { messageId: sentId }
    );
    expect(echoTracker.isSelfEcho(sentId)).toBe(true);
  });

  it("fires onGroupUpdate callback on group-participants.update and groups.update events", () => {
    const onGroupUpdate = vi.fn();
    const link = new WhatsAppLink({
      authDir: "./test-auth",
      echoTracker,
      logger: pino({ level: "silent" }),
      onMessage: vi.fn(),
      onGroupUpdate,
    });

    link.attachSocketEvents(mockSocket);

    events.emit("group-participants.update", {
      id: "group-123@g.us",
      participants: ["user-new@s.whatsapp.net"],
      action: "add",
    });
    expect(onGroupUpdate).toHaveBeenCalledWith("group-123@g.us");

    events.emit("groups.update", [{ id: "group-456@g.us", subject: "New Name" }]);
    expect(onGroupUpdate).toHaveBeenCalledWith("group-456@g.us");
  });
});
