const MAX_CHUNK = 96;
const FIRST_CHUNK_MIN = 24;

/** Splits streamed text into short speakable pieces so audio can start before the reply finishes. */
export function createChunker() {
  let buffer = '';
  let emitted = 0;

  function take(final:boolean):string[] {
    const out:string[] = [];
    for (;;) {
      const sentence = buffer.match(/[.!?;:]\s/);
      const comma = emitted === 0 ? buffer.match(/,\s/) : null;
      if (sentence?.index !== undefined && sentence.index + 1 <= MAX_CHUNK) { out.push(cut(sentence.index + 1)); continue; }
      if (comma?.index !== undefined && comma.index + 1 >= FIRST_CHUNK_MIN && comma.index + 1 <= MAX_CHUNK) { out.push(cut(comma.index + 1)); continue; }
      if (buffer.length > MAX_CHUNK) {
        const window = buffer.slice(0, MAX_CHUNK);
        const at = Math.max(window.lastIndexOf(', '), window.lastIndexOf(' '));
        out.push(cut(at > 0 ? at : MAX_CHUNK)); continue;
      }
      break;
    }
    if (final && buffer.trim()) { out.push(buffer.trim()); buffer = ''; }
    return out.filter(Boolean);
  }

  function cut(end:number):string {
    const piece = buffer.slice(0, end).trim();
    buffer = buffer.slice(end).trimStart();
    emitted++;
    return piece;
  }

  return {
    push(text:string) { buffer += text; return take(false); },
    flush() { return take(true); }
  };
}
