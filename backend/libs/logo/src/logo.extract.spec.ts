import { fetchImage, IMAGE_BYTES_CAP } from './logo.extract';

// Minimal Response stub — only the bits fetchImage reads.
function imgRes(bytes: Uint8Array, headers: Record<string, string> = {}): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Response;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('fetchImage oversize handling (#131)', () => {
  let fetchSpy: jest.SpyInstance;
  afterEach(() => fetchSpy?.mockRestore());

  it('rejects (and skips the download) when content-length exceeds the cap', async () => {
    const arrayBuffer = jest.fn();
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-length' ? String(IMAGE_BYTES_CAP + 1) : null) },
      arrayBuffer,
    } as unknown as Response);
    expect(await fetchImage('https://x/logo.png')).toBeNull();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('rejects an oversized body rather than truncating it', async () => {
    const big = new Uint8Array(IMAGE_BYTES_CAP + 16);
    big.set(PNG_MAGIC);
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(imgRes(big, { 'content-type': 'image/png' }));
    expect(await fetchImage('https://x/logo.png')).toBeNull();
  });

  it('accepts a small valid image', async () => {
    const png = new Uint8Array([...PNG_MAGIC, ...new Array(32).fill(0)]);
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(imgRes(png, { 'content-type': 'image/png' }));
    const out = await fetchImage('https://x/logo.png');
    expect(out).not.toBeNull();
    expect(out?.[0].length).toBe(png.length);
    expect(out?.[1]).toBe('image/png');
  });
});
