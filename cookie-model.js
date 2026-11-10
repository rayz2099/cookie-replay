export const FORMAT = "cookie-relay";
export const VERSION = 1;

const FIELDS = [
  "name", "value", "domain", "path", "secure", "httpOnly", "sameSite",
  "hostOnly", "session", "expirationDate", "partitionKey"
];

// 只保存迁移所需字段，避免把浏览器内部状态混入可复用快照。
export function createSnapshot(cookies, sourceUrl, name = "") {
  const url = new URL(sourceUrl);
  return {
    format: FORMAT,
    version: VERSION,
    name,
    source: url.hostname,
    createdAt: new Date().toISOString(),
    cookies: cookies.map((cookie) => Object.fromEntries(
      FIELDS.filter((field) => cookie[field] !== undefined)
        .map((field) => [field, cookie[field]])
    ))
  };
}

// 导入前检查结构，避免把任意 JSON 当作 Cookie 写入浏览器。
export function parseSnapshot(text) {
  let snapshot;
  try {
    snapshot = JSON.parse(text);
  } catch {
    throw new Error("JSON 格式无效");
  }
  if (snapshot?.format !== FORMAT || snapshot.version !== VERSION || !Array.isArray(snapshot.cookies)) {
    throw new Error("仅支持 Cookie Relay v1 快照");
  }
  if (snapshot.cookies.some((cookie) =>
    !cookie || typeof cookie.name !== "string" || typeof cookie.value !== "string" ||
    typeof cookie.domain !== "string" || typeof cookie.path !== "string" || !cookie.path.startsWith("/")
  )) {
    throw new Error("快照包含无效 Cookie 字段");
  }
  return snapshot;
}

// 同一站点可能同时拥有主域和子域 Cookie，需按浏览器作用域筛选。
export function cookieAppliesToHost(cookie, host, protocol) {
  const domain = cookie.domain.replace(/^\./, "").toLowerCase();
  const sameHost = host === domain;
  const domainMatch = !cookie.hostOnly && host.endsWith(`.${domain}`);
  return (sameHost || domainMatch) && !(protocol === "http:" && cookie.secure);
}

export function cookieKey(cookie) {
  return `${cookie.name}\u0000${cookie.domain.replace(/^\./, "").toLowerCase()}\u0000${cookie.path}`;
}

// JWT 只用于展示过期声明；payload 未经签名校验，不参与导入决策。
export function jwtExpiration(value) {
  if (typeof value !== "string") return null;
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  const parts = decoded.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return Number.isFinite(payload.exp) && payload.exp >= 0 ? payload.exp : null;
  } catch {
    return null;
  }
}

export function formatExpiration(seconds, now = Date.now()) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  const distance = Math.abs(date.getTime() - now) / 1000;
  const [amount, unit] = distance < 60 ? [Math.ceil(distance), "秒"]
    : distance < 3600 ? [Math.ceil(distance / 60), "分钟"]
      : distance < 86400 ? [Math.ceil(distance / 3600), "小时"]
        : [Math.ceil(distance / 86400), "天"];
  const relative = date.getTime() <= now ? `已过期 ${amount} ${unit}` : `剩余 ${amount} ${unit}`;
  const absolute = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(date);
  return { relative, absolute };
}

// 删除 API 通过 URL 定位作用域，使用 Cookie 自身域名和路径避免命中同名邻居。
export function cookieUrl(cookie, tabUrl) {
  const scheme = cookie.secure ? "https:" : new URL(tabUrl).protocol;
  const domain = cookie.domain.replace(/^\./, "");
  return `${scheme}//${domain}${cookie.path}`;
}

export function renameDetails(cookie, name, tabUrl, storeId) {
  const details = {
    url: cookieUrl(cookie, tabUrl), name, value: cookie.value, path: cookie.path,
    secure: cookie.secure, httpOnly: cookie.httpOnly, storeId
  };
  if (!cookie.hostOnly) details.domain = cookie.domain;
  if (cookie.sameSite && cookie.sameSite !== "unspecified") details.sameSite = cookie.sameSite;
  if (!cookie.session && Number.isFinite(cookie.expirationDate)) details.expirationDate = cookie.expirationDate;
  return details;
}

// HTTP 开发环境无法接收 Secure / SameSite=None；转换结果会在预览中明示。
export function planCookie(cookie, targetUrl, storeId) {
  const target = new URL(targetUrl);
  const host = target.hostname.toLowerCase();
  const changes = [];
  if (cookie.partitionKey) {
    return { status: "unsupported", reason: "分区 Cookie 暂不支持跨站迁移", cookie };
  }
  if (target.protocol === "http:" && (cookie.name.startsWith("__Secure-") || cookie.name.startsWith("__Host-"))) {
    return { status: "unsupported", reason: "此前缀要求 HTTPS，无法导入当前 HTTP 站点", cookie };
  }
  const sameSite = target.protocol === "http:" && cookie.sameSite === "no_restriction"
    ? "lax" : cookie.sameSite;
  const secure = target.protocol === "https:" &&
    (Boolean(cookie.secure) || sameSite === "no_restriction" || cookie.name.startsWith("__Secure-") || cookie.name.startsWith("__Host-"));
  if (cookie.secure && !secure) changes.push("Secure → 关闭");
  if (!cookie.secure && secure) changes.push("Secure → 开启");
  if (cookie.sameSite !== sameSite) changes.push("SameSite=None → Lax");
  if (cookie.domain.replace(/^\./, "") !== host) changes.push(`域名 → ${host}`);
  if (cookie.name.startsWith("__Host-") && (cookie.path !== "/" || !cookie.hostOnly)) {
    return { status: "unsupported", reason: "__Host- Cookie 必须为根路径且仅限当前主机", cookie };
  }

  const details = {
    url: `${target.protocol}//${target.host}/`,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure,
    httpOnly: Boolean(cookie.httpOnly),
    storeId
  };
  if (!cookie.hostOnly && host !== "localhost" && !/^[\d.]+$/.test(host)) {
    details.domain = host;
  }
  if (sameSite && sameSite !== "unspecified") details.sameSite = sameSite;
  if (!cookie.session && Number.isFinite(cookie.expirationDate)) {
    if (cookie.expirationDate <= Date.now() / 1000) {
      return { status: "unsupported", reason: "Cookie 已过期", cookie };
    }
    details.expirationDate = cookie.expirationDate;
  }
  return {
    status: "ready",
    cookie,
    details,
    changes,
    identity: cookieKey({ name: cookie.name, domain: host, path: cookie.path })
  };
}

export function summarizePlan(plan, existing, policy, selected = new Set(plan.map((_, index) => index))) {
  const keys = new Set(existing.map(cookieKey));
  return plan.map((item, index) => {
    if (item.status !== "ready") return item;
    const conflict = keys.has(item.identity);
    const action = conflict && policy === "skip" ? "skip" : "write";
    if (selected.has(index) && action === "write") keys.add(item.identity);
    return { ...item, conflict, action };
  });
}
