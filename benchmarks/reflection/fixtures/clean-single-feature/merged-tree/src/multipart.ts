export type MultipartPart = { name: string; content: string };

export function parseMultipartStub(
  buffer: string,
  boundary: string,
): MultipartPart[] {
  const sections = buffer.split(`--${boundary}`).slice(1, -1);
  return sections
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const headerEnd = s.indexOf('\r\n\r\n');
      const header = headerEnd >= 0 ? s.slice(0, headerEnd) : '';
      const content = headerEnd >= 0 ? s.slice(headerEnd + 4) : '';
      const nameMatch = header.match(/name="([^"]+)"/);
      return { name: nameMatch ? nameMatch[1] : '', content };
    });
}
