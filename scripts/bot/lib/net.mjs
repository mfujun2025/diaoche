// 网络层：本机需要代理（Node fetch 不自动读 HTTPS_PROXY），CI 里直连。
// ⚠️ Watt Toolkit / Steam++ 的 MITM 证书会打断 Node 的 TLS ——
//    那种情况下要把请求设为不校验证书，否则报 UNABLE_TO_VERIFY_LEAF_SIGNATURE。

export async function setupProxy() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || '';
  if (!proxy) return null;
  const { ProxyAgent, setGlobalDispatcher } = await import('undici');
  setGlobalDispatcher(
    new ProxyAgent({
      uri: proxy,
      requestTls: { rejectUnauthorized: false },
      proxyTls: { rejectUnauthorized: false },
    })
  );
  return proxy;
}
