/** Called only after the session, tenant, message and retention checks. */
export function privateMediaResponse(media: { bytes: ArrayBuffer; contentType: string }, range: string | null) {
  const size = media.bytes.byteLength;
  const headers = new Headers({
    'Content-Type': media.contentType,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  });
  let start = 0, end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return invalidRange();
    if (!match[1]) start = Math.max(0, size - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return invalidRange();
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  headers.set('Content-Length', String(end - start + 1));
  const bytes = new Uint8Array(media.bytes);
  let offset = start;
  // Stream bounded chunks, including files above the serverless buffered-response limit.
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset > end) { controller.close(); return; }
      const next = Math.min(offset + 64 * 1024, end + 1);
      controller.enqueue(bytes.subarray(offset, next));
      offset = next;
    },
  });
  return new Response(stream, { status: range ? 206 : 200, headers });
  function invalidRange() {
    headers.set('Content-Range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
}
