// Shared by the browser reader and the private sample-evaluation command.
export function pageTextAnchors(
  textContent,
  viewport,
  width,
  height,
  pageId,
  pageNumber,
  transformMatrix,
) {
  const lines = [];
  for (const item of textContent.items) {
    if (!item.str?.trim()) continue;
    const transform = transformMatrix(viewport.transform, item.transform);
    const itemHeight = Math.max(5, Math.hypot(transform[2], transform[3]));
    const x = Math.max(0, transform[4]),
      y = Math.max(0, transform[5] - itemHeight),
      right = Math.min(width, x + Math.max(item.width * viewport.scale, 3)),
      bottom = Math.min(height, y + itemHeight * 1.25);
    let line = lines.find(
      (l) => Math.abs(l.baseline - transform[5]) < itemHeight * 0.35,
    );
    if (!line) {
      line = { baseline: transform[5], chunks: [] };
      lines.push(line);
    }
    line.chunks.push({ text: item.str, x, y, right, bottom });
  }
  lines.sort((a, b) => a.baseline - b.baseline);
  return lines.map((line, index) => {
    const chunks = line.chunks.sort((a, b) => a.x - b.x);
    return {
      id: `${pageId}:r${index + 1}`,
      kind: "text",
      page: pageNumber,
      text: chunks.map((c) => c.text).join(" "),
      bbox: [
        Math.min(...chunks.map((c) => c.x)) / width,
        Math.min(...chunks.map((c) => c.y)) / height,
        Math.max(...chunks.map((c) => c.right)) / width,
        Math.max(...chunks.map((c) => c.bottom)) / height,
      ],
      label: `Page ${pageNumber}, text row ${index + 1}`,
    };
  });
}
