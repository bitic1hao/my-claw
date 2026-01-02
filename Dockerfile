# --------------------------------------------------------
# 阶段 1: 获取 Cloudflared (Argo) 官方文件
# --------------------------------------------------------
FROM cloudflare/cloudflared:latest AS argo-source

# --------------------------------------------------------
# 阶段 2: 获取 Xray 官方文件
# --------------------------------------------------------
FROM teddysun/xray:latest AS xray-source

# --------------------------------------------------------
# 阶段 3: 获取 Nezha Agent (手动下载二进制)
# --------------------------------------------------------
FROM alpine:latest AS nezha-source
ARG TARGETARCH

WORKDIR /tmp

# 安装下载工具
RUN apk add --no-cache curl unzip

# 自动判断架构并下载最新版 Nezha Agent
# 注意：这里使用 GitHub Releases 的 latest 链接
RUN if [ "$TARGETARCH" = "amd64" ]; then ARCH="amd64"; \
    elif [ "$TARGETARCH" = "arm64" ]; then ARCH="arm64"; \
    else ARCH="amd64"; fi && \
    curl -L -o agent.zip "https://github.com/nezhahq/agent/releases/latest/download/nezha-agent_linux_${ARCH}.zip" && \
    unzip agent.zip && \
    mv nezha-agent /usr/local/bin/agent && \
    chmod +x /usr/local/bin/agent

# --------------------------------------------------------
# 阶段 4: 构建最终运行环境
# --------------------------------------------------------
FROM node:alpine3.20

WORKDIR /app

# 关键：安装 gcompat (解决 libc 兼容性) 和必要的网络工具
RUN apk update && \
    apk add --no-cache gcompat ca-certificates bash iproute2 coreutils curl && \
    rm -rf /var/cache/apk/*

# 从各阶段镜像中复制二进制文件到系统路径
COPY --from=argo-source /usr/local/bin/cloudflared /usr/local/bin/bot
COPY --from=xray-source /usr/bin/xray /usr/local/bin/web
# 注意：这里是从我们自定义的 nezha-source 阶段复制
COPY --from=nezha-source /usr/local/bin/agent /usr/local/bin/nezha

# 赋予执行权限
RUN chmod +x /usr/local/bin/bot /usr/local/bin/web /usr/local/bin/nezha

# 复制项目文件
COPY package.json .
COPY index.js .

# 安装依赖
RUN npm install

EXPOSE 3000

CMD ["node", "index.js"]
