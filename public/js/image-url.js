const CDN_BASE =
  (typeof window !== "undefined" && window.CDN_BASE_URL) || "";

export function toImageUrl(src, opts = {}) {
  if (!src) return "";
  if (/^https?:\/\//i.test(src) || src.startsWith("data:")) return src;
  if (src.startsWith("/uploads/")) return src;

  if (src.startsWith("users/")) {
    const params = new URLSearchParams();
    if (opts.w) params.set("w", opts.w);
    if (opts.h) params.set("h", opts.h);
    const query = params.toString();
    return `${CDN_BASE}/${src}${query ? `?${query}` : ""}`;
  }

  return `${CDN_BASE}${src}`;
}
