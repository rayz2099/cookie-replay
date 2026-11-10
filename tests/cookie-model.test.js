import test from "node:test";
import assert from "node:assert/strict";
import {
  cookieAppliesToHost, cookieUrl, createSnapshot, formatExpiration, jwtExpiration,
  parseSnapshot, planCookie, renameDetails, summarizePlan
} from "../cookie-model.js";

const source = {
  name: "session",
  value: "abc",
  domain: ".dev.example.com",
  path: "/",
  hostOnly: false,
  secure: true,
  httpOnly: true,
  sameSite: "no_restriction",
  session: true
};

test("快照只包含可迁移数据并可解析", () => {
  const snapshot = createSnapshot([{ ...source, storeId: "0", size: 20 }], "https://dev.example.com/page", "调试登录态");
  assert.equal(snapshot.source, "dev.example.com");
  assert.equal(snapshot.cookies[0].storeId, undefined);
  assert.deepEqual(parseSnapshot(JSON.stringify(snapshot)).cookies, snapshot.cookies);
  assert.throws(() => parseSnapshot('{"cookies":[]}'), /Cookie Relay v1/);
});

test("主域 Cookie 可用于子域，hostOnly 仅限精确域名", () => {
  assert.equal(cookieAppliesToHost(source, "api.dev.example.com", "https:"), true);
  assert.equal(cookieAppliesToHost({ ...source, hostOnly: true }, "api.dev.example.com", "https:"), false);
  assert.equal(cookieAppliesToHost(source, "dev.example.com", "http:"), false);
});

test("导入 localhost 时显式转换 Secure 与 SameSite", () => {
  const item = planCookie(source, "http://localhost:3000/", "0");
  assert.equal(item.status, "ready");
  assert.equal(item.details.url, "http://localhost:3000/");
  assert.equal(item.details.domain, undefined);
  assert.equal(item.details.secure, false);
  assert.equal(item.details.sameSite, "lax");
  assert.deepEqual(item.changes, ["Secure → 关闭", "SameSite=None → Lax", "域名 → localhost"]);
});

test("HTTPS 目标上 SameSite=None 必须同时开启 Secure", () => {
  const item = planCookie({ ...source, secure: false }, "https://stage.example.com/", "0");
  assert.equal(item.details.secure, true);
  assert.ok(item.changes.includes("Secure → 开启"));
});

test("带安全前缀或分区属性的 Cookie 不会误写入", () => {
  assert.equal(planCookie({ ...source, name: "__Host-session" }, "http://localhost/", "0").status, "unsupported");
  assert.equal(planCookie({ ...source, partitionKey: { topLevelSite: "https://example.com" } }, "https://stage.example.com/", "0").status, "unsupported");
});

test("冲突策略同时处理目标站点和快照内部的同名条目", () => {
  const first = planCookie(source, "https://local.example.com/", "0");
  const second = planCookie({ ...source, domain: ".example.com", value: "other" }, "https://local.example.com/", "0");
  assert.deepEqual(summarizePlan([first, second], [], "skip").map((item) => item.action), ["write", "skip"]);
  assert.deepEqual(summarizePlan([first, second], [], "skip", new Set([1])).map((item) => item.action), ["write", "write"]);
  assert.deepEqual(summarizePlan([first], [{ name: "session", domain: "local.example.com", path: "/" }], "overwrite").map((item) => item.action), ["write"]);
  assert.deepEqual(summarizePlan([first], [{ name: "session", domain: "local.example.com", path: "/" }], "skip").map((item) => item.action), ["skip"]);
});

test("JWT 仅解析合法数字 exp，普通 Cookie 值不误判", () => {
  const payload = Buffer.from(JSON.stringify({ exp: 1893456000 })).toString("base64url");
  const token = `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
  assert.equal(jwtExpiration(token), 1893456000);
  assert.equal(jwtExpiration(encodeURIComponent(token)), 1893456000);
  assert.equal(jwtExpiration("ordinary-session-value"), null);
  const invalid = Buffer.from(JSON.stringify({ exp: "1893456000" })).toString("base64url");
  assert.equal(jwtExpiration(`header.${invalid}.signature`), null);
});

test("到期时间同时提供相对与本地日期", () => {
  const future = formatExpiration(1893456000, 1893452400000);
  assert.equal(future.relative, "剩余 1 小时");
  assert.match(future.absolute, /2030/);
  const past = formatExpiration(1893456000, 1893459600000);
  assert.equal(past.relative, "已过期 1 小时");
});

test("重命名保持原 Cookie 作用域与属性", () => {
  const cookie = { ...source, path: "/app", session: false, expirationDate: 1893456000 };
  const details = renameDetails(cookie, "new-session", "https://dev.example.com/", "0");
  assert.equal(cookieUrl(cookie, "https://dev.example.com/"), "https://dev.example.com/app");
  assert.equal(details.name, "new-session");
  assert.equal(details.domain, cookie.domain);
  assert.equal(details.expirationDate, cookie.expirationDate);
  assert.equal(details.httpOnly, true);
});
