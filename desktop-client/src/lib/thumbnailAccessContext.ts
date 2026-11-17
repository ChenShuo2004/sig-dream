/**
 * 缩略图接口 `GET .../thumbnail-url` 的访问上下文。
 * HTTPS 下若使用 internal，后端常返回 http:// 局域网 URL，混合内容会拦截 <img>；public 可走同域/ECS。
 */
export function thumbnailAccessContextHeaders(): Record<string, string> {
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    return { "X-Access-Context": "public" };
  }
  return { "X-Access-Context": "internal" };
}
