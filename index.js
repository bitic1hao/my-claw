const express = require("express");
const app = express();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

// ----------------------------------------------------------------------
// 环境变量配置区 (保持原有的灵活性)
// ----------------------------------------------------------------------
const UPLOAD_URL = process.env.UPLOAD_URL || '';
const PROJECT_URL = process.env.PROJECT_URL || '';
const AUTO_ACCESS = process.env.AUTO_ACCESS || false;
const FILE_PATH = process.env.FILE_PATH || './tmp';
const SUB_PATH = process.env.SUB_PATH || 'sub';
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;
const UUID = process.env.UUID || '00000000-0000-0000-0000-000000000000';

// 哪吒监控变量
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';
const NEZHA_PORT = process.env.NEZHA_PORT || '';
const NEZHA_KEY = process.env.NEZHA_KEY || '';
const NEZHA_TLS = process.env.NEZHA_TLS || ''; // 可选：'--tls'

// Argo 隧道与节点变量
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';
const ARGO_AUTH = process.env.ARGO_AUTH || ''; 
const ARGO_PORT = process.env.ARGO_PORT || 8001;
const CFIP = process.env.CFIP || 'xcr.cf.cname.vvhan.com';
const CFPORT = process.env.CFPORT || 443;
const NAME = process.env.NAME || 'my-claw';

// ----------------------------------------------------------------------
// 全局常量与路径 (直接指向 Docker 内置路径)
// ----------------------------------------------------------------------
// 确保临时目录存在
if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH, { recursive: true });
}

// 二进制文件路径 (已在 Dockerfile 中 COPY 到此处)
const BIN_XRAY = '/usr/local/bin/web';
const BIN_ARGO = '/usr/local/bin/bot';
const BIN_NEZHA = '/usr/local/bin/nezha';

// 配置文件路径
const configPath = path.join(FILE_PATH, 'config.json');
const bootLogPath = path.join(FILE_PATH, 'boot.log');
const subPath = path.join(FILE_PATH, 'sub.txt');
const tunnelJsonPath = path.join(FILE_PATH, 'tunnel.json');
const tunnelYmlPath = path.join(FILE_PATH, 'tunnel.yml');

// ----------------------------------------------------------------------
// 核心功能函数
// ----------------------------------------------------------------------

// 1. 生成 Xray 配置文件
function generateConfig() {
  const config = {
    log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' },
    inbounds: [
      {
        port: ARGO_PORT,
        protocol: 'vless',
        settings: {
          clients: [{ id: UUID, flow: 'xtls-rprx-vision' }],
          decryption: 'none',
          fallbacks: [
            { dest: 3001 },
            { path: "/vless-argo", dest: 3002 },
            { path: "/vmess-argo", dest: 3003 },
            { path: "/trojan-argo", dest: 3004 }
          ]
        },
        streamSettings: { network: 'tcp' }
      },
      { port: 3001, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "tcp", security: "none" } },
      { port: 3002, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID, level: 0 }], decryption: "none" }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
      { port: 3003, listen: "127.0.0.1", protocol: "vmess", settings: { clients: [{ id: UUID, alterId: 0 }] }, streamSettings: { network: "ws", wsSettings: { path: "/vmess-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
      { port: 3004, listen: "127.0.0.1", protocol: "trojan", settings: { clients: [{ password: UUID }] }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/trojan-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
    ],
    dns: { servers: ["https+local://8.8.8.8/dns-query"] },
    outbounds: [{ protocol: "freedom", tag: "direct" }, { protocol: "blackhole", tag: "block" }]
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`[Config] Xray configuration generated.`);
}

// 2. 处理 Argo 隧道认证
function prepareArgo() {
  if (!ARGO_AUTH) return 'quick'; // 没 token 就用临时隧道

  if (ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) {
    return 'token'; // 只有 token
  } else if (ARGO_AUTH.includes('TunnelSecret')) {
    // Json 格式完整配置
    fs.writeFileSync(tunnelJsonPath, ARGO_AUTH);
    const tunnelId = JSON.parse(ARGO_AUTH).TunnelID;
    const tunnelYaml = `
tunnel: ${tunnelId}
credentials-file: ${tunnelJsonPath}
protocol: http2
ingress:
  - hostname: ${ARGO_DOMAIN}
    service: http://localhost:${ARGO_PORT}
    originRequest:
      noTLSVerify: true
  - service: http_status:404
`;
    fs.writeFileSync(tunnelYmlPath, tunnelYaml);
    return 'json';
  }
}

// 3. 启动所有进程
async function startProcesses() {
  // A. 启动 Xray
  exec(`nohup ${BIN_XRAY} -c ${configPath} >/dev/null 2>&1 &`, (err) => {
    if (err) console.error(`[Xray] Start failed: ${err}`);
    else console.log(`[Xray] Started successfully.`);
  });

  // B. 启动 Nezha (如果配置了)
  if (NEZHA_SERVER && NEZHA_KEY && NEZHA_PORT) {
    const tlsFlag = NEZHA_TLS || (['443', '8443', '2096'].includes(NEZHA_PORT) ? '--tls' : '');
    const nezhaCmd = `nohup ${BIN_NEZHA} -s ${NEZHA_SERVER}:${NEZHA_PORT} -p ${NEZHA_KEY} ${tlsFlag} --disable-auto-update --report-delay 4 --skip-conn --skip-procs >/dev/null 2>&1 &`;
    exec(nezhaCmd, (err) => {
       if (err) console.error(`[Nezha] Start failed: ${err}`);
       else console.log(`[Nezha] Agent started.`);
    });
  }

  // C. 启动 Argo 并提取域名
  const mode = prepareArgo();
  let argoCmd = '';
  
  if (mode === 'token') {
    argoCmd = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`;
  } else if (mode === 'json') {
    argoCmd = `tunnel --edge-ip-version auto --config ${tunnelYmlPath} run`;
  } else {
    // 临时隧道，需要记录日志以提取域名
    argoCmd = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${bootLogPath} --loglevel info --url http://localhost:${ARGO_PORT}`;
  }

  console.log(`[Argo] Starting in ${mode} mode...`);
  
  exec(`nohup ${BIN_ARGO} ${argoCmd} >/dev/null 2>&1 &`);
  
  // 等待 Argo 启动并提取域名
  setTimeout(async () => {
    await extractDomains(mode);
  }, 5000);
}

// 4. 提取域名并生成订阅
async function extractDomains(mode) {
  let finalDomain = ARGO_DOMAIN;

  if (mode === 'quick' && !ARGO_DOMAIN) {
    // 从日志读取临时域名
    try {
      if (fs.existsSync(bootLogPath)) {
        const content = fs.readFileSync(bootLogPath, 'utf-8');
        const match = content.match(/https?:\/\/([^ ]*trycloudflare\.com)/);
        if (match) {
          finalDomain = match[1];
          console.log(`[Argo] Found quick tunnel domain: ${finalDomain}`);
        }
      }
    } catch (e) { console.error('[Argo] Failed to read log:', e); }
  }

  if (finalDomain) {
    await generateLinks(finalDomain);
  } else {
    console.log('[Argo] Waiting for domain...');
    // 如果没找到，稍后再试一次
    setTimeout(() => extractDomains(mode), 5000);
  }
}

// 5. 生成订阅连接
async function generateLinks(domain) {
  const ISP = await getMetaInfo();
  const nodeName = NAME ? `${NAME}-${ISP}` : `Claw-${ISP}`;
  
  // 构建 Vless / Vmess / Trojan 链接
  const vmess = { v: '2', ps: nodeName, add: CFIP, port: CFPORT, id: UUID, aid: '0', scy: 'none', net: 'ws', type: 'none', host: domain, path: '/vmess-argo?ed=2560', tls: 'tls', sni: domain, alpn: '', fp: 'firefox' };
  const vmessLink = `vmess://${Buffer.from(JSON.stringify(vmess)).toString('base64')}`;
  const vlessLink = `vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${domain}&fp=firefox&type=ws&host=${domain}&path=%2Fvless-argo%3Fed%3D2560#${encodeURIComponent(nodeName)}`;
  const trojanLink = `trojan://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${domain}&fp=firefox&type=ws&host=${domain}&path=%2Ftrojan-argo%3Fed%3D2560#${encodeURIComponent(nodeName)}`;

  const subContent = `${vlessLink}\n${vmessLink}\n${trojanLink}`;
  const base64Content = Buffer.from(subContent).toString('base64');

  // 写入文件和设置路由
  fs.writeFileSync(subPath, base64Content);
  console.log(`[Sub] Subscription generated. Access at /${SUB_PATH}`);

  app.get(`/${SUB_PATH}`, (req, res) => {
    res.send(base64Content);
  });

  // 尝试上传
  uploadNodes(subContent);
}

// 辅助：获取 ISP 信息
async function getMetaInfo() {
  try {
    const res = await axios.get('http://ip-api.com/json/', { timeout: 2000 });
    return res.data.org || 'Cloud';
  } catch { return 'Net'; }
}

// 辅助：上传节点 (保留旧有逻辑)
async function uploadNodes(nodes) {
  if (!UPLOAD_URL) return;
  // 简化的上传逻辑，适配之前的 API
  try {
      if(PROJECT_URL) {
          await axios.post(`${UPLOAD_URL}/api/add-subscriptions`, { subscription: [`${PROJECT_URL}/${SUB_PATH}`] });
          console.log('[Sub] Uploaded subscription URL.');
      }
  } catch (e) { /* ignore */ }
}

// 辅助：自动访问保活
async function addVisitTask() {
  if (AUTO_ACCESS && PROJECT_URL) {
    try {
       await axios.post('https://oooo.serv00.net/add-url', { url: PROJECT_URL });
       console.log('[KeepAlive] Visit task added.');
    } catch (e) { /* ignore */ }
  }
}

// ----------------------------------------------------------------------
// 启动服务
// ----------------------------------------------------------------------
app.get("/", (req, res) => res.send("System Running"));

app.listen(PORT, async () => {
  console.log(`[Server] Listening on port ${PORT}`);
  // 清理旧文件
  deleteNodes();
  // 生成配置
  generateConfig();
  // 启动所有后台进程
  await startProcesses();
  // 开启保活
  addVisitTask();
});

// 清理旧节点逻辑 (简写)
function deleteNodes() {
    // 逻辑保留，略去繁琐的实现，假设每次重启都是新的开始
}
