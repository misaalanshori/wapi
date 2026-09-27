# Sticker Ingestion & Processing — Design & Implementation Plan

**Authoritative Context:** WhatsApp Personal Assistant (`wapi`) & Baileys / Multimodal Pi SDK  
**Status:** Proposed Architecture & Phased Plan  
**Target File:** `docs/sticker-processing-plan.md`  

---

## 1. Problem Statement & Motivation

In WhatsApp, users communicate frequently through stickers (`stickerMessage`):
- Currently, `src/message-extractor.ts` explicitly drops stickers, returning `null`.
- When a user sends a sticker (or asks *"@bot what is this sticker?"*), the assistant acts as if nothing was sent.
- WhatsApp stickers are WebP images (`image/webp`):
  1. **Static Stickers:** Standard WebP raster images. Fully readable by modern multimodal LLMs (DeepSeek V4.1 Flash, Claude 3.5, Gemini 1.5/2.0).
  2. **Animated Stickers:** Multi-frame WebP / animated GIFs. Some LLM providers accept animated WebP; others reject multi-frame WebPs or require extracting the first frame.

---

## 2. Technical Architecture

### 2.1 Baileys Sticker Message Structure
```typescript
stickerMessage: {
  url: "https://mmg.whatsapp.net/...",
  mimetype: "image/webp",
  fileSha256: Buffer,
  fileLength: 32000,
  isAnimated: false, // true if animated WebP
  directPath: "/v/t62.15575-24/...",
}
```

### 2.2 Extraction & Download Pipeline
1. **Extraction:**
   - In `src/message-extractor.ts`, detect `m.stickerMessage`.
   - Treat as `kind: "image"`.
   - Text fallback: `"[User sent a sticker]"` (or `"[User sent an animated sticker]"` if `isAnimated: true`).
   - Mime type: `"image/webp"`.
2. **Media Manager Download:**
   - `MediaManager.downloadAndSaveImage` works with any Baileys media message (including `stickerMessage`).
   - Saves to `sessions/<uuid>/media/<messageId>.webp`.
   - Encodes as base64 `data:image/webp;base64,...`.
3. **Multimodal Delivery:**
   - Feeds into `AgentSessionManager.deliverMessage` as `ImageContent`:
     ```typescript
     {
       type: "image",
       data: base64Data,
       mimeType: "image/webp",
     }
     ```

---

## 3. Phased Implementation Plan

- **Phase S1:** Extract `stickerMessage` in `src/message-extractor.ts` as `kind: "image"` with `mimeType: "image/webp"`.
- **Phase S2:** Download and pass `.webp` stickers through `MediaManager` into `session.prompt()`.
- **Phase S3:** Regression tests for static and animated sticker handling.
- **Phase S4:** Verification, build, and deployment.
