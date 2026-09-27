export function chunkMessage(text: string, maxChunkLength: number = 4000): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }

  if (trimmed.length <= maxChunkLength) {
    return [trimmed];
  }

  const chunks: string[] = [];
  const paragraphs = trimmed.split("\n\n");
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    const p = paragraph.trim();
    if (p.length === 0) continue;

    if (p.length > maxChunkLength) {
      // If we already have accumulated text in currentChunk, flush it
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
      }

      // Split the oversized paragraph by lines or words
      const subChunks = splitLongParagraph(p, maxChunkLength);
      chunks.push(...subChunks);
      continue;
    }

    if (currentChunk.length === 0) {
      currentChunk = p;
    } else if (currentChunk.length + 2 + p.length <= maxChunkLength) {
      currentChunk += "\n\n" + p;
    } else {
      chunks.push(currentChunk.trim());
      currentChunk = p;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

function splitLongParagraph(paragraph: string, maxChunkLength: number): string[] {
  const lines = paragraph.split("\n");
  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
    const l = line.trim();
    if (l.length === 0) continue;

    if (l.length > maxChunkLength) {
      if (current.length > 0) {
        chunks.push(current.trim());
        current = "";
      }
      // Split on words
      const words = l.split(/\s+/);
      let wordChunk = "";
      for (const word of words) {
        if (word.length > maxChunkLength) {
          // Hard split if a single word is absurdly long
          if (wordChunk.length > 0) {
            chunks.push(wordChunk.trim());
            wordChunk = "";
          }
          let remaining = word;
          while (remaining.length > maxChunkLength) {
            chunks.push(remaining.slice(0, maxChunkLength));
            remaining = remaining.slice(maxChunkLength);
          }
          wordChunk = remaining;
        } else if (wordChunk.length === 0) {
          wordChunk = word;
        } else if (wordChunk.length + 1 + word.length <= maxChunkLength) {
          wordChunk += " " + word;
        } else {
          chunks.push(wordChunk.trim());
          wordChunk = word;
        }
      }
      if (wordChunk.trim().length > 0) {
        chunks.push(wordChunk.trim());
      }
      continue;
    }

    if (current.length === 0) {
      current = l;
    } else if (current.length + 1 + l.length <= maxChunkLength) {
      current += "\n" + l;
    } else {
      chunks.push(current.trim());
      current = l;
    }
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  return chunks;
}
