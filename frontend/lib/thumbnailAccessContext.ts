/**
 * 缩略图接口 `GET .../thumbnail-url` 的访问上下文。
 * HTTPS 站点（如公网域名）下若使用 internal，后端常返回 http:// 局域网文件机 URL，
 * 浏览器对 <img> 会拦截混合内容；使用 public 可走 ECS 缓存/同域相对路径。
 */
export function thumbnailAccessContextHeaders(): Record<string, string> {
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    return { "X-Access-Context": "public" };
  }
  return { "X-Access-Context": "internal" };
}
