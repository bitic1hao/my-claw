# --------------------------------------------------------
# 阶段 1: 获取 Cloudflared (Argo) 官方文件
# --------------------------------------------------------
FROM cloudflare/cloudflared:latest AS argo-source

# --------------------------------------------------------
# 阶段 2: 获取 Xray 官方文件
# --------------------------------------------------------
FROM teddysun/xray:latest AS xray-source

# --------------------------------------------------------
# 阶段 3: 获取 Nezha Agent (哪吒监控)
# --------------------------------------------------------
FROM ghcr.io/nezhahq/agent:latest AS nezha-source

# --------------------------------------------------------
# 阶段 4: 构建最终运行环境
# --------------------------------------------------------
FROM node:alpine3.20

WORKDIR /app

# 关键：安装 gcompat (解决 libc 兼容性) 和必要的网络工具
# 这就是之前精简版“连不通”的根本解药
RUN apk update && \
    apk add --no-cache gcompat ca-certificates bash iproute2 coreutils curl && \
    rm -rf /var/cache/apk/*

# 从各阶段镜像中复制二进制文件到系统路径
COPY --from=argo-source /usr/local/bin/cloudflared /usr/local/bin/bot
COPY --from=xray-source /usr/bin/xray /usr/local/bin/web
COPY --from=nezha-source /usr/local/bin/agent /usr/local/bin/nezha

# 赋予执行权限
RUN chmod +x /usr/local/bin/bot /usr/local/bin/web /usr/local/bin/nezha

# 复制项目文件
COPY package.json .
COPY index.js .

# 安装依赖
RUN npm install

# 暴露端口 (虽然 Argo 隧道不需要入站端口，但保留以防万一)
EXPOSE 3000

CMD ["node", "index.js"]
