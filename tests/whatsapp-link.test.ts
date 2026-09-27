import { describe, it, expect, vi, beforeEach } from "vitest";
import { WhatsAppLink, createMemoryCacheStore } from "../src/whatsapp-link.js";
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
      { text: "Assistant reply", mentions: undefined },
      { messageId: sentId }
    );
    expect(echoTracker.isSelfEcho(sentId)).toBe(true);
  });

  it("automatically extracts @phone numbers and passes them to mentions array in sendMessage", async () => {
    const link = new WhatsAppLink({
      authDir: "./test-auth",
      echoTracker,
      logger: pino({ level: "silent" }),
      onMessage: vi.fn(),
    });

    link.attachSocketEvents(mockSocket);

    const sentId = await link.sendMessage(
      "group-1@g.us",
      "Hello @6283820039330 and @1234567890 please check this out"
    );

    expect(mockSocket.sendMessage).toHaveBeenCalledWith(
      "group-1@g.us",
      {
        text: "Hello @6283820039330 and @1234567890 please check this out",
        mentions: ["6283820039330@s.whatsapp.net", "1234567890@s.whatsapp.net"],
      },
      { messageId: sentId }
    );
  });

  it("resolves mentions to @lid when participant is known to be an @lid user", async () => {
    const link = new WhatsAppLink({
      authDir: "./test-auth",
      echoTracker,
      logger: pino({ level: "silent" }),
      onMessage: vi.fn(),
    });

    link.attachSocketEvents(mockSocket);

    // Track an inbound message from an @lid user in the group
    events.emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: {
            remoteJid: "group-1@g.us",
            participant: "82003911291129:1@lid",
            id: "msg-lid-1",
            fromMe: false,
          },
          message: { conversation: "Hello" },
        },
      ],
    });

    // Assistant sends message tagging the @lid user
    await link.sendMessage("group-1@g.us", "Calling @82003911291129 for help");

    expect(mockSocket.sendMessage).toHaveBeenCalledWith(
      "group-1@g.us",
      {
        text: "Calling @82003911291129 for help",
        mentions: ["82003911291129@lid"],
      },
      expect.anything()
    );
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

  it("createMemoryCacheStore supports get, set, del, and flushAll", () => {
    const cache = createMemoryCacheStore();
    expect(cache.get("k1")).toBeUndefined();
    cache.set("k1", 42);
    expect(cache.get("k1")).toBe(42);
    cache.del("k1");
    expect(cache.get("k1")).toBeUndefined();
    cache.set("k2", "val2");
    cache.flushAll();
    expect(cache.get("k2")).toBeUndefined();
  });

  it("starts and stops QR HTTP server when qrHttpPort is provided", async () => {
    const link = new WhatsAppLink({
      authDir: "./test-auth",
      echoTracker,
      logger: pino({ level: "silent" }),
      onMessage: vi.fn(),
      qrHttpPort: 18999,
    });

    // Verify stop shuts down HTTP server cleanly
    await link.stop();
  });

  it("sends image file via sendFile with image payload", async () => {
    const link = new WhatsAppLink({
      authDir: "./test-auth",
      echoTracker,
      logger: pino({ level: "silent" }),
      onMessage: vi.fn(),
    });

    link.attachSocketEvents(mockSocket);

    // Create a temp file to send
    const tmpFile = "./test-auth-temp-img.png";
    await import("fs/promises").then((fs) => fs.writeFile(tmpFile, "png-bytes"));

    try {
      const msgId = await link.sendFile("chat-1@s.whatsapp.net", {
        filePath: tmpFile,
        caption: "Check this picture",
      });

      expect(mockSocket.sendMessage).toHaveBeenCalledWith(
        "chat-1@s.whatsapp.net",
        expect.objectContaining({
          image: expect.any(Buffer),
          caption: "Check this picture",
        }),
        { messageId: msgId }
      );
      expect(echoTracker.isSelfEcho(msgId)).toBe(true);
    } finally {
      await import("fs/promises").then((fs) => fs.unlink(tmpFile).catch(() => {}));
    }
  });

  it("sends document file via sendFile with document payload", async () => {
    const link = new WhatsAppLink({
      authDir: "./test-auth",
      echoTracker,
      logger: pino({ level: "silent" }),
      onMessage: vi.fn(),
    });

    link.attachSocketEvents(mockSocket);

    const tmpFile = "./test-auth-temp-doc.pdf";
    await import("fs/promises").then((fs) => fs.writeFile(tmpFile, "pdf-bytes"));

    try {
      const msgId = await link.sendFile("chat-1@s.whatsapp.net", {
        filePath: tmpFile,
        caption: "Here is your report",
        fileName: "annual-report.pdf",
      });

      expect(mockSocket.sendMessage).toHaveBeenCalledWith(
        "chat-1@s.whatsapp.net",
        expect.objectContaining({
          document: expect.any(Buffer),
          fileName: "annual-report.pdf",
          mimetype: "application/pdf",
        }),
        { messageId: msgId }
      );
    } finally {
      await import("fs/promises").then((fs) => fs.unlink(tmpFile).catch(() => {}));
    }
  });
});
